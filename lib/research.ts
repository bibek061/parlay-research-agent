import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SPORTS, TIME_ZONE, type Game, type Slate, type Sport, type ProviderStatus } from './domain';
import { fetchApiGames, mergeBasketballGames, providerKey } from './api-sports';
import { fetchEspnGames } from './espn';
import { validateDate } from './time';

const pending = new Map<string, Promise<Slate>>();
const cache = new Map<string, Slate>();
export const fallbackEnabled = () => process.env.ESPN_FALLBACK_ENABLED !== 'false';
export async function loadSport(sport: Sport, date: string, api = fetchApiGames, espn = fetchEspnGames): Promise<{ games: Game[]; provider: ProviderStatus }> {
  let reason = 'API-Sports key is not configured.';
  if (providerKey(sport)) {
    try {
      const games = await api(sport, date);
      return { games, provider: { sport, status: games.length ? 'ready' : 'empty', games: games.length, message: 'API-Sports · daily schedule' } };
    } catch (error) { reason = error instanceof Error ? error.message : 'API-Sports is unavailable.'; }
  }
  if (fallbackEnabled()) {
    try {
      const games = await espn(sport, date);
      return { games, provider: { sport, status: 'fallback', games: games.length, message: `${reason} Using ESPN${sport === 'baseball' ? ' (MLB)' : sport === 'hockey' ? ' (NHL)' : sport === 'basketball' ? ' (WNBA and NCAA)' : ''}; coverage may be narrower.` } };
    } catch { reason += ' ESPN fallback is also unavailable.'; }
  }
  return { games: [], provider: { sport, status: 'error', games: 0, message: reason } };
}
export async function getSlate(date: string): Promise<Slate> {
  validateDate(date);
  const current = cache.get(date);
  if (current && Date.now() - Date.parse(current.fetchedAt) < 300000) return current;
  if (pending.has(date)) return pending.get(date)!;
  const work = (async () => {
    const results = await Promise.all(SPORTS.map(s => loadSport(s.id, date)));
    const slate: Slate = { date, timeZone: TIME_ZONE, fetchedAt: new Date().toISOString(),
      games: mergeBasketballGames(results.flatMap(r => r.games)).sort((a, b) => a.start.localeCompare(b.start)), providers: results.map(r => r.provider) };
    if (cache.size >= 14) cache.delete(cache.keys().next().value!);
    cache.set(date, slate);
    return slate;
  })();
  pending.set(date, work);
  try { return await work; } finally { pending.delete(date); }
}
export async function saveSnapshot(slate: Slate): Promise<Slate> {
  const directory = path.join(process.cwd(), '.data', 'research');
  const destination = path.join(directory, `${validateDate(slate.date)}.json`);
  try {
    await mkdir(directory, { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(slate, null, 2));
    await rename(temporary, destination);
    return slate;
  } catch { return { ...slate, storageWarning: 'The schedule loaded, but the local snapshot could not be saved.' }; }
}
export async function savedSnapshot(date: string): Promise<Slate | null> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), '.data', 'research', `${validateDate(date)}.json`), 'utf8')); } catch { return null; }
}
export async function findGame(date: string, id: string): Promise<Game> {
  if (!id || id.length > 120) throw Error('Choose a game from the daily board.');
  const game = (await getSlate(date)).games.find(g => g.id === id);
  if (!game) throw Error('Game is unavailable on this date. Refresh the board.');
  return game;
}
