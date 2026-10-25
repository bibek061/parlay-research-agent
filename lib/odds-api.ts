import type { Game, Market } from './domain';
import { teamKey } from './api-sports';
import { array, numberOrNull, providerJson, type Raw } from './http';

// Integrates github.com/odds-api/odds-api (odds-api.net), not the-odds-api.com.
async function oddsRequest(path: string, params: Record<string, string>, ttl = 120000) {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) throw Error('Add ODDS_API_KEY from odds-api.net to enable its game and player-prop markets.');
  const url = new URL(`https://api.odds-api.net/v1${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return providerJson(url, key, ttl, 'X-API-Key');
}
export function matchesOddsEvent(event: Raw, game: Game): boolean {
  return typeof event.home_team === 'string' && typeof event.away_team === 'string'
    && teamKey(event.home_team) === teamKey(game.home) && teamKey(event.away_team) === teamKey(game.away)
    && Math.abs(Number(event.start_time) * 1000 - Date.parse(game.start)) <= 300000;
}
export function normalizeOddsSnapshot(snapshot: Raw, game: Game): Market[] {
  const markets: Market[] = [];
  for (const row of array(snapshot.items)) {
    const decimalOdds = numberOrNull(row.odds);
    if (row.is_available === false || !decimalOdds || decimalOdds <= 1 || decimalOdds > 10000 || !row.id || row.event_id !== snapshot.event_id) continue;
    if (row.source_type && /exchange|prediction/i.test(row.source_type)) continue;
    const rawTime = numberOrNull(snapshot.bookmaker_as_of_ts_ms?.[row.bookmaker] ?? snapshot.as_of_ts_ms);
    const validTime = rawTime !== null && Number.isFinite(new Date(rawTime).getTime());
    const player = typeof row.player_name === 'string' ? row.player_name : '';
    const selection = typeof row.selection_name === 'string' ? row.selection_name : row.side === 'home' ? game.home : row.side === 'away' ? game.away : String(row.side ?? '');
    if (!selection) continue;
    const name = String(row.market_key ?? row.bet_type ?? 'Market').replaceAll('_', ' ');
    const period = String(row.period_str ?? row.period ?? '');
    markets.push({ id: `odds:${snapshot.event_id}:${row.id}`, gameId: game.id, sport: game.sport,
      kind: player || /player|scorer/i.test(name) ? 'player' : 'game', name: `${name}${period ? ` · ${period}` : ''}`,
      selection: [player && !selection.includes(player) ? player : '', selection, row.line ?? ''].filter(v => v !== '').join(' '),
      decimalOdds, bookmaker: String(row.bookmaker_name ?? row.bookmaker),
      updatedAt: validTime ? new Date(rawTime!).toISOString() : null, fetchedAt: snapshot._fetchedAt ?? new Date().toISOString() });
  }
  return markets;
}
export async function fetchOddsMarkets(game: Game) {
  const start = Math.floor(Date.parse(game.start) / 1000);
  const params = { start_from: String(start - 300), start_to: String(start + 300), limit: '200' };
  let cursor = ''; const events: Raw[] = [];
  for (let page = 0; page < 5; page++) {
    const body = await oddsRequest('/events', { ...params, ...(cursor ? { cursor } : {}) }, 300000);
    if (!Array.isArray(body.items)) throw Error('Odds API returned an invalid event list.');
    events.push(...body.items); cursor = typeof body.next_cursor === 'string' ? body.next_cursor : '';
    if (!cursor) break;
  }
  const matches = events.filter(e => matchesOddsEvent(e, game));
  if (matches.length !== 1) throw Error(cursor ? 'Odds event search reached its page limit; no unambiguous match.' : 'No unique matching event was found at odds-api.net.');
  const id = matches[0].event_id;
  const markets: Market[] = []; cursor = ''; let complete = false;
  for (let page = 0; page < 5; page++) {
    const body = await oddsRequest(`/events/${encodeURIComponent(id)}/odds/snapshot`, { limit: '2000', include_unavailable: 'false', ...(cursor ? { cursor } : {}) });
    if (body.event_id !== id || !Array.isArray(body.items)) throw Error('Odds API returned a mismatched snapshot.');
    markets.push(...normalizeOddsSnapshot(body, game));
    cursor = typeof body.next_cursor === 'string' ? body.next_cursor : '';
    complete = body.complete !== false && !cursor;
    if (!cursor || complete) break;
  }
  return { markets: [...new Map(markets.map(m => [m.id, m])).values()], notice: `odds-api.net · Game and player markets depend on event and subscription coverage.${complete ? '' : ' Partial results: five-page limit or incomplete provider snapshot.'}` };
}
