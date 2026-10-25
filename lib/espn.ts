import type { Game, Market, Sport } from './domain';
import { addDay, easternDate } from './time';
import { array, numberOrNull, providerJson, type Raw } from './http';
import { sameMatch } from './api-sports';
export const ESPN_PATHS: Record<Sport, string[]> = {
  soccer: ['soccer/all'], nba: ['basketball/nba'], baseball: ['baseball/mlb'], hockey: ['hockey/nhl'],
  basketball: ['basketball/wnba', 'basketball/mens-college-basketball', 'basketball/womens-college-basketball'],
  afl: ['australian-football/afl'], nfl: ['football/nfl'],
};
export async function espnRequest(path: string, resource: string, params: Record<string, string> = {}, web = false) {
  if (!Object.values(ESPN_PATHS).flat().includes(path)) throw Error('Unsupported ESPN league.');
  const url = new URL(`https://${web ? 'site.web.api.espn.com/apis/common/v3' : 'site.api.espn.com/apis/site/v2'}/sports/${path}/${resource}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return providerJson(url);
}
export function normalizeEspnGame(raw: Raw, sport: Sport, path: string, league: string): Game | null {
  const competition = raw?.competitions?.[0];
  const home = array(competition?.competitors).find(c => c.homeAway === 'home');
  const away = array(competition?.competitors).find(c => c.homeAway === 'away');
  if (!raw?.id || !home?.team?.displayName || !away?.team?.displayName || !Number.isFinite(Date.parse(raw.date))) return null;
  const status = competition.status?.type ?? raw.status?.type ?? {};
  const phase = status.completed ? 'finished' : status.name === 'STATUS_SCHEDULED' ? 'scheduled' : status.state === 'in' ? 'live' : 'unavailable';
  const slug = raw.season?.slug;
  return { id: `espn:${sport}:${raw.id}`, providerId: Number(raw.id), source: 'espn', espnPath: path, sport,
    league: sport === 'soccer' ? (typeof slug === 'string' && /league|liga|cup|serie|division|ligue|championship/i.test(slug) ? slug.replace(/^\d{4}(-\d{2})?-/, '').replace(/-/g, ' ') : 'Soccer') : league,
    season: String(raw.season?.year ?? ''), home: home.team.displayName, away: away.team.displayName,
    homeId: Number(home.team.id), awayId: Number(away.team.id), start: new Date(raw.date).toISOString(),
    status: String(status.shortDetail ?? status.description ?? 'Unknown'), phase,
    homeScore: phase === 'scheduled' ? null : numberOrNull(home.score), awayScore: phase === 'scheduled' ? null : numberOrNull(away.score) };
}
export async function espnScoreboards(sport: Sport, date: string) {
  return Promise.all(ESPN_PATHS[sport].flatMap(path => [date, addDay(date)].map(async day => {
    const body = await espnRequest(path, 'scoreboard', { dates: day.replaceAll('-', ''), limit: '1000' });
    if (!Array.isArray(body.events)) throw Error('ESPN returned an unexpected scoreboard format.');
    return { path, body };
  })));
}
export async function fetchEspnGames(sport: Sport, date: string): Promise<Game[]> {
  const boards = await espnScoreboards(sport, date);
  const games = boards.flatMap(({ path, body }) => array(body.events).map(r => normalizeEspnGame(r, sport, path, String(body.leagues?.[0]?.abbreviation ?? sport.toUpperCase()))))
    .filter((g): g is Game => !!g && easternDate(g.start) === date);
  return [...new Map(games.map(g => [g.id, g])).values()];
}
export async function espnMatch(game: Game): Promise<Game | undefined> {
  if (game.source === 'espn') return game;
  return (await fetchEspnGames(game.sport, easternDate(game.start))).find(other => sameMatch(game, other));
}
export function americanToDecimal(value: unknown): number | null {
  if (String(value).toUpperCase() === 'EVEN') return 2;
  const n = numberOrNull(value);
  if (n === null || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}
export function normalizeEspnOdds(odds: Raw[], game: Game): Market[] {
  const markets: Market[] = [];
  for (const book of odds) {
    const add = (key: string, name: string, selection: string, raw: unknown) => {
      const decimalOdds = americanToDecimal(raw);
      if (decimalOdds) markets.push({ id: `${game.id}:espn:${book.provider?.id}:${key}`, gameId: game.id, sport: game.sport,
        kind: 'game', name, selection, decimalOdds, bookmaker: `${book.provider?.name ?? 'Bookmaker'} · ESPN`, updatedAt: null, fetchedAt: new Date().toISOString() });
    };
    for (const side of ['home', 'away', 'draw'] as const) {
      const team = side === 'home' ? game.home : side === 'away' ? game.away : 'Draw';
      add(`ml:${side}`, 'Moneyline', team, book.moneyline?.[side]?.close?.odds ?? book[`${side}TeamOdds`]?.moneyLine);
      const spread = book.pointSpread?.[side]?.close;
      if (spread?.line !== undefined) add(`spread:${side}`, 'Spread', `${team} ${spread.line}`, spread.odds);
    }
    for (const side of ['over', 'under']) {
      const total = book.total?.[side]?.close;
      if (total?.line !== undefined) add(`total:${side}`, 'Total', `${side === 'over' ? 'Over' : 'Under'} ${String(total.line).replace(/^[ou]/i, '')}`, total.odds);
    }
  }
  return markets;
}
export async function fetchEspnMarkets(game: Game) {
  const match = await espnMatch(game);
  if (!match) return { markets: [] as Market[], notice: 'No matching ESPN event was found for fallback odds.' };
  const boards = await espnScoreboards(match.sport, easternDate(match.start));
  const raw = boards.flatMap(b => array(b.body.events)).find(event => String(event.id) === String(match.providerId));
  return { markets: normalizeEspnOdds(array(raw?.competitions?.[0]?.odds), game), notice: 'ESPN fallback game odds. Price update time is unavailable; confirm the line at the sportsbook. Player-prop prices require an odds provider or manual entry.' };
}
