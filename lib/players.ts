import type { Game, Player } from './domain';
import { espnMatch, espnRequest } from './espn';
import { array, numberOrNull, type Raw } from './http';

export interface StatGame { id: string; date: string; stats: Record<string, number>; }
export interface PlayerHistory { metrics: { key: string; label: string }[]; games: StatGame[]; notice: string; }
export function normalizeRoster(body: Raw): Player[] {
  const flat = array(body.athletes).flatMap(row => Array.isArray(row.items) ? row.items : [row]);
  return flat.filter(p => /^\d+$/.test(String(p.id)) && typeof p.displayName === 'string').map(p => ({ id: Number(p.id), name: p.displayName }));
}
export async function playerRoster(game: Game) {
  const match = await espnMatch(game);
  if (!match?.espnPath) throw Error('No matching ESPN roster is available for this game. Manual props are still available.');
  const bodies = await Promise.all([match.homeId, match.awayId].map(id => espnRequest(match.espnPath!, `teams/${id}/roster`)));
  const players = bodies.flatMap(normalizeRoster);
  return { players: [...new Map(players.map(p => [p.id, p])).values()].sort((a, b) => a.name.localeCompare(b.name)), source: 'ESPN', notice: 'Current roster; availability and game logs vary by league.' };
}
export function normalizePlayerHistory(body: Raw, before: string): PlayerHistory {
  const names: string[] = Array.isArray(body.names) ? body.names : [];
  const labels: string[] = Array.isArray(body.displayNames) ? body.displayNames : names;
  const events: Raw = body.events && typeof body.events === 'object' ? body.events : {};
  const games: StatGame[] = [];
  for (const season of array(body.seasonTypes)) for (const category of array(season.categories)) for (const row of array(category.events)) {
    const event = events[row.eventId];
    if (!event || !Number.isFinite(Date.parse(event.gameDate)) || Date.parse(event.gameDate) >= Math.min(Date.parse(before), Date.now())) continue;
    const stats: Record<string, number> = {};
    names.forEach((name, i) => {
      const raw = row.stats?.[i];
      // Made-attempted columns are split explicitly; DNP/empty entries are excluded.
      if (name.includes('Made-') && typeof raw === 'string' && /^\d+-\d+$/.test(raw)) stats[name.split('-')[0]] = Number(raw.split('-')[0]);
      else if (typeof raw === 'number' || typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw)) {
        const value = numberOrNull(raw); if (value !== null) stats[name] = value;
      }
    });
    if (Object.keys(stats).length) games.push({ id: String(row.eventId), date: new Date(event.gameDate).toISOString(), stats });
  }
  const unique = [...new Map(games.map(g => [g.id, g])).values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const keys = new Set(unique.flatMap(g => Object.keys(g.stats)));
  return { games: unique, metrics: [...keys].map(key => ({ key, label: labels[names.indexOf(key)] || key.replace(/([A-Z])/g, ' $1') })),
    notice: 'Up to 10 recorded games in the selected event’s season, before this matchup. Historical hit rates are descriptive, not win probabilities. DNP and missing values are excluded.' };
}
export async function playerHistory(game: Game, player: string) {
  if (!/^\d{1,12}$/.test(player)) throw Error('Choose a player from the roster.');
  const match = await espnMatch(game);
  if (!match?.espnPath || !/^\d{4}$/.test(match.season)) throw Error('Player game logs are unavailable for this event.');
  const body = await espnRequest(match.espnPath, `athletes/${player}/gamelog`, { season: match.season }, true);
  return normalizePlayerHistory(body, game.start);
}
