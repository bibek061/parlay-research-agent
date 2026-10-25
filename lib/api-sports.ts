import { SPORTS, TIME_ZONE, type Game, type Market, type Sport } from './domain';
import { addDay, easternDate } from './time';
import { array, numberOrNull, providerJson, type Raw } from './http';
export function providerKey(sport: Sport): string { return (process.env[`API_SPORTS_${sport.toUpperCase()}_KEY`] || process.env.API_SPORTS_KEY || '').trim(); }
export async function apiRequest(sport: Sport, path: string, params: Record<string, string | number>, ttl = 300000): Promise<Raw> {
  const key = providerKey(sport);
  if (!key) throw Error('API-Sports key is not configured.');
  const url = new URL(`https://${SPORTS.find(s => s.id === sport)!.host}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const body = await providerJson(url, key, ttl);
  if (!Array.isArray(body.response)) throw Error('Unexpected API-Sports response format.');
  return body;
}
export function normalizeGame(sport: Sport, raw: Raw): Game | null {
  if (!raw) return null;
  const fixture = sport === 'soccer' ? raw.fixture : sport === 'nfl' ? raw.game : raw;
  if (!fixture) return null;
  const id = numberOrNull(fixture.id);
  const rawStart = sport === 'nba' ? fixture.date?.start : typeof fixture.date === 'object' ? fixture.date?.date : fixture.date;
  // NFL's date is split into local date/time. Its Unix timestamp is unambiguous across time zones and DST.
  const timestamp = numberOrNull(fixture.timestamp ?? fixture.date?.timestamp);
  if (sport === 'nfl' && timestamp === null && (typeof rawStart !== 'string' || !rawStart.includes('T'))) return null;
  const start = timestamp !== null ? new Date(timestamp * 1000) : new Date(typeof rawStart === 'string' ? rawStart : NaN);
  const home = raw.teams?.home, away = sport === 'nba' ? raw.teams?.visitors : raw.teams?.away;
  if (!id || !Number.isFinite(start.getTime()) || typeof home?.name !== 'string' || typeof away?.name !== 'string') return null;
  const code = String(fixture.status?.short ?? '').toUpperCase();
  const scheduled = sport === 'nba' ? code === '1' : code === 'NS';
  const finished = sport === 'nba' ? code === '3' : ['FT', 'AET', 'PEN', 'AOT', 'AP'].includes(code);
  const live = sport === 'nba' ? code === '2' : /^(1H|2H|HT|ET|BT|P|LIVE|IN\d+|Q[1-4]|P[1-3]|OT|PT)$/.test(code);
  const score = (side: 'home' | 'away') => {
    const value = sport === 'soccer' ? raw.goals?.[side] : raw.scores?.[sport === 'nba' && side === 'away' ? 'visitors' : side];
    return numberOrNull(typeof value === 'object' && value !== null ? value.points ?? value.total ?? value.score : value);
  };
  return { id: `api:${sport}:${id}`, providerId: id, sport, source: 'api-sports',
    league: sport === 'nba' ? 'NBA' : String(raw.league?.name ?? 'League unavailable'), season: String(raw.league?.season ?? raw.season ?? ''),
    home: home.name, away: away.name, homeId: Number(home.id), awayId: Number(away.id), start: start.toISOString(),
    status: String(fixture.status?.long ?? code), phase: scheduled ? 'scheduled' : finished ? 'finished' : live ? 'live' : 'unavailable',
    homeScore: score('home'), awayScore: score('away'),
    ...(sport !== 'nba' && sport !== 'afl' ? { oddsSport: sport, oddsGameId: id } : {}) };
}
export async function fetchApiGames(sport: Sport, date: string): Promise<Game[]> {
  const params: Record<string, string>[] = sport === 'nba' ? [{ date }, { date: addDay(date) }] : [{ date, timezone: TIME_ZONE }];
  const rows = await Promise.all(params.map(p => apiRequest(sport, sport === 'soccer' ? '/fixtures' : '/games', p)));
  const games = rows.flatMap(r => r.response).map(r => normalizeGame(sport, r)).filter((g): g is Game => !!g && easternDate(g.start) === date);
  return [...new Map(games.map(g => [g.id, g])).values()];
}
export const teamKey = (name: string) => name.toLowerCase().replace(/^la /, 'los angeles ').replace(/[^a-z0-9]/g, '');
export function sameMatch(a: Game, b: Game): boolean {
  return teamKey(a.home) === teamKey(b.home) && teamKey(a.away) === teamKey(b.away) && Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= 300000;
}
export function mergeBasketballGames(games: Game[]): Game[] {
  const used = new Set<string>();
  const merged = games.map(game => {
    if (game.sport !== 'nba') return game;
    const match = games.find(other => other.sport === 'basketball' && !used.has(other.id) && sameMatch(other, game));
    if (!match) return game;
    used.add(match.id);
    return match.source === 'api-sports' ? { ...game, oddsSport: 'basketball' as const, oddsGameId: match.providerId } : game;
  });
  return merged.filter(g => !used.has(g.id));
}
export function normalizeMarkets(rows: Raw[], game: Game, fetchedAt = new Date().toISOString()): Market[] {
  const markets: Market[] = [];
  for (const row of rows) {
    if (numberOrNull(row?.fixture?.id ?? row?.game?.id ?? row?.game) !== game.oddsGameId) continue;
    for (const book of array(row.bookmakers)) for (const bet of array(book.bets)) {
      if (typeof bet.name !== 'string' || typeof book.name !== 'string') continue;
      for (const [i, value] of array(bet.values).entries()) {
        const odd = numberOrNull(value.odd);
        if (!odd || odd <= 1 || odd > 10000 || typeof value.value !== 'string') continue;
        markets.push({ id: `${game.id}:${book.id}:${bet.id}:${i}`, gameId: game.id, sport: game.sport,
          kind: /\bplayer\b|\bscorer\b|goalscorer/i.test(bet.name) ? 'player' : 'game', name: bet.name,
          selection: value.value, decimalOdds: odd, bookmaker: book.name,
          updatedAt: typeof row.update === 'string' && Number.isFinite(Date.parse(row.update)) ? new Date(row.update).toISOString() : null, fetchedAt });
      }
    }
  }
  return [...new Map(markets.map(m => [m.id, m])).values()];
}
export async function fetchApiMarkets(game: Game) {
  if (!game.oddsSport || !game.oddsGameId) return { markets: [] as Market[], notice: 'No verified odds mapping for this event. Enter a sportsbook line manually.' };
  const params: Record<string, number> = game.oddsSport === 'soccer' ? { fixture: game.oddsGameId } : { game: game.oddsGameId };
  const first = await apiRequest(game.oddsSport, '/odds', params, 600000);
  const rows = [...first.response];
  const total = Math.max(1, Number(first.paging?.total) || 1);
  if (game.oddsSport === 'soccer') for (let page = 2; page <= Math.min(total, 5); page++) rows.push(...(await apiRequest('soccer', '/odds', { ...params, page }, 600000)).response);
  return { markets: normalizeMarkets(rows, game), notice: total > 5 ? 'Showing five odds pages to limit API usage.' : 'Prices depend on provider coverage and can lag the sportsbook.' };
}
