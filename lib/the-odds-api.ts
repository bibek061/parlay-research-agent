import type { Game, Market, Sport } from './domain';
import { teamKey } from './api-sports';
import { array, numberOrNull, providerJson, type Raw } from './http';

export type MarketKind = 'game' | 'player' | 'all';
const GAME_MARKETS = ['h2h', 'spreads', 'totals'];
const PROP_PRIORITY = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists', 'player_steals', 'player_blocks', 'player_points_rebounds', 'player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_anytime_td', 'player_shots_on_goal', 'player_goals', 'pitcher_strikeouts', 'batter_hits', 'batter_total_bases'];
const isProp = (key: string) => /^(player|batter|pitcher)_/.test(key);
const names: Record<string, string> = { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total', player_points: 'Player points', player_rebounds: 'Player rebounds', player_assists: 'Player assists', player_threes: 'Player made threes' };
const prefixes: Record<Sport, string> = { soccer: 'soccer_', nba: 'basketball_nba', baseball: 'baseball_', hockey: 'icehockey_', basketball: 'basketball_', afl: 'aussierules_', nfl: 'americanfootball_nfl' };
// Basketball books often use tip-off (~10 minutes after ESPN's scheduled broadcast time).
const matchWindow = (game: Game) => ['nba', 'basketball'].includes(game.sport) ? 900000 : 300000;

export function relevantTheOddsSports(rows: Raw[], sport: Sport): string[] {
  return [...new Set(rows.filter(row => typeof row.key === 'string' && row.active !== false && !row.has_outrights && row.key.startsWith(prefixes[sport])
    && (sport !== 'basketball' || !row.key.startsWith('basketball_nba'))).map(row => row.key as string))].sort();
}
export function matchesTheOddsEvent(event: Raw, game: Game): boolean {
  return typeof event.id === 'string' && typeof event.home_team === 'string' && typeof event.away_team === 'string'
    && teamKey(event.home_team) === teamKey(game.home) && teamKey(event.away_team) === teamKey(game.away)
    && Math.abs(Date.parse(event.commence_time) - Date.parse(game.start)) <= matchWindow(game);
}
async function request(path: string, params: Record<string, string> = {}, ttl = 300000) {
  const key = process.env.THE_ODDS_API_KEY?.trim();
  if (!key) throw Error('The Odds API key is not configured.');
  const url = new URL(`https://api.the-odds-api.com/v4${path}`);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
  return providerJson(url, key, ttl, 'query:apiKey', true);
}
function regions() {
  const values = (process.env.THE_ODDS_API_REGIONS || 'us').split(',').map(v => v.trim());
  if (values.some(v => !['us', 'us2', 'uk', 'eu', 'au'].includes(v))) throw Error('THE_ODDS_API_REGIONS must contain us, us2, uk, eu or au.');
  return [...new Set(values)].join(',');
}
async function findEvent(game: Game): Promise<Raw> {
  const catalog = await request('/sports', {}, 3600000);
  if (!Array.isArray(catalog)) throw Error('The Odds API returned an invalid sports list.');
  const sports = relevantTheOddsSports(array(catalog), game.sport);
  const params = {
    commenceTimeFrom: new Date(Date.parse(game.start) - matchWindow(game)).toISOString().replace('.000Z', 'Z'),
    commenceTimeTo: new Date(Date.parse(game.start) + matchWindow(game)).toISOString().replace('.000Z', 'Z'),
    dateFormat: 'iso',
  };
  const matches = new Map<string, Raw>();
  // Discovery is quota-free. Limit concurrency, and reject incomplete/ambiguous matches.
  for (let i = 0; i < sports.length; i += 4) {
    const batches = await Promise.all(sports.slice(i, i + 4).map(async sport => {
      const rows = await request(`/sports/${encodeURIComponent(sport)}/events`, params);
      if (!Array.isArray(rows)) throw Error('The Odds API returned an invalid event list.');
      return array(rows).filter(event => event.sport_key === sport && matchesTheOddsEvent(event, game));
    }));
    batches.flat().forEach(event => matches.set(`${event.sport_key}:${event.id}`, event));
  }
  if (matches.size !== 1) throw Error('The Odds API has no unique matching event for these teams and start time.');
  return [...matches.values()][0];
}
export function normalizeTheOddsMarkets(body: Raw, game: Game): Market[] {
  if (!matchesTheOddsEvent(body, game)) return [];
  const result: Market[] = [];
  for (const book of array(body.bookmakers)) {
    if (typeof book.key !== 'string' || typeof book.title !== 'string' || /betfair|matchbook|smarkets|betdaq|kalshi|polymarket/.test(book.key)) continue;
    for (const market of array(book.markets)) {
      if (typeof market.key !== 'string' || (!GAME_MARKETS.includes(market.key) && !isProp(market.key)) || market.key.endsWith('_lay')) continue;
      const player = isProp(market.key);
      const timestamp = market.last_update ?? book.last_update;
      for (const outcome of array(market.outcomes)) {
        const price = numberOrNull(outcome.price), point = numberOrNull(outcome.point);
        if (price === null || price <= 1 || price > 10000 || typeof outcome.name !== 'string' || !outcome.name.trim()) continue;
        if (player && (typeof outcome.description !== 'string' || !outcome.description.trim())) continue;
        if (outcome.point !== undefined && outcome.point !== null && point === null) continue;
        result.push({ id: `the-odds:${body.id}:${book.key}:${market.key}:${encodeURIComponent(JSON.stringify([outcome.description, outcome.name, point]))}`,
          gameId: game.id, sport: game.sport, kind: player ? 'player' : 'game',
          name: names[market.key] ?? market.key.replaceAll('_', ' '),
          selection: [player ? outcome.description : '', outcome.name, point ?? ''].filter(value => value !== '').join(' '),
          decimalOdds: price, bookmaker: book.title,
          updatedAt: typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null,
          fetchedAt: body._fetchedAt ?? new Date().toISOString(),
        });
      }
    }
  }
  return [...new Map(result.map(market => [market.id, market])).values()];
}
export async function fetchTheOddsMarkets(game: Game, kind: MarketKind = 'all') {
  const event = await findEvent(game);
  const path = `/sports/${encodeURIComponent(event.sport_key)}/events/${encodeURIComponent(event.id)}`;
  const region = regions();
  let props: string[] = [], totalProps = 0, propNotice = '';
  if (kind !== 'game') {
    try {
      const available = await request(`${path}/markets`, { regions: region, dateFormat: 'iso' });
      if (available.id !== event.id || available.sport_key !== event.sport_key || !matchesTheOddsEvent(available, game)) throw Error('The Odds API returned a mismatched market list.');
      props = [...new Set(array(available.bookmakers).flatMap(book => array(book.markets)).map(m => m.key).filter((key): key is string => typeof key === 'string' && isProp(key)))];
      totalProps = props.length;
      const rank = (key: string) => PROP_PRIORITY.includes(key) ? PROP_PRIORITY.indexOf(key) : PROP_PRIORITY.length;
      props.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      props = props.slice(0, 8);
    } catch (error) {
      if (kind === 'player') throw error;
      propNotice = ' Player-prop discovery is unavailable.';
    }
  }
  const keys = [...(kind !== 'player' ? GAME_MARKETS : []), ...props];
  if (!keys.length) return { markets: [] as Market[], notice: `The Odds API has no player-prop markets available for this event in ${region}.` };
  const body = await request(`${path}/odds`, { regions: region, markets: keys.join(','), oddsFormat: 'decimal', dateFormat: 'iso' });
  if (body.id !== event.id || body.sport_key !== event.sport_key || !matchesTheOddsEvent(body, game)) throw Error('The Odds API returned odds for a different event.');
  const markets = normalizeTheOddsMarkets(body, game).filter(m => kind === 'all' || m.kind === kind);
  const quota = numberOrNull(body._quotaRemaining);
  return { markets, notice: `The Odds API · ${region} bookmakers · cached for 5 minutes.${totalProps > props.length ? ` Showing ${props.length} of ${totalProps} available prop market types to limit credits.` : ''}${quota !== null ? ` Credits remaining at fetch: ${quota}.` : ''}${propNotice}` };
}
