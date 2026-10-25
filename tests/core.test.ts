import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateParlay, expectedValue } from '../lib/math';
import { easternDate, validateDate, addDay } from '../lib/time';
import { normalizeGame, mergeBasketballGames, normalizeMarkets } from '../lib/api-sports';
import { normalizeEspnGame, normalizeEspnOdds } from '../lib/espn';
import { normalizeOddsSnapshot, matchesOddsEvent, fetchOddsMarkets } from '../lib/odds-api';
import { normalizePlayerHistory } from '../lib/players';
import { loadSport } from '../lib/research';
import { providerJson, numberOrNull } from '../lib/http';
import { POST as parlayPost } from '../app/api/parlays/route';
import { POST as researchPost } from '../app/api/research/route';
import type { Game } from '../lib/domain';

const game: Game = { id: 'api:nba:1', providerId: 1, source: 'api-sports', sport: 'nba', league: 'NBA', season: '2026', home: 'Los Angeles Lakers', away: 'Boston Celtics', homeId: 1, awayId: 2, start: '2030-10-25T23:00:00Z', status: 'Not Started', phase: 'scheduled', homeScore: null, awayScore: null };

test('Eastern days handle midnight and both daylight saving transitions', () => {
  assert.equal(easternDate('2026-10-24T02:30:00Z'), '2026-10-23');
  assert.equal(easternDate('2026-03-08T04:59:00Z'), '2026-03-07');
  assert.equal(easternDate('2026-03-08T05:00:00Z'), '2026-03-08');
  assert.equal(easternDate('2026-11-01T06:30:00Z'), '2026-11-01');
  assert.equal(addDay('2028-02-28'), '2028-02-29');
  assert.throws(() => validateDate('2026-02-30'));
  assert.throws(() => validateDate('../../secret'));
});
test('mixed parlays accept 2–10 legs and do not invent probability estimates', () => {
  const result = evaluateParlay([{ decimalOdds: 2, gameId: 'nba:1' }, { decimalOdds: 1.5, gameId: 'soccer:1' }], 10);
  assert.equal(result.estimatedPayout, 30); assert.equal(result.estimatedNetProfit, 20);
  assert.equal(result.independentProbability, null); assert.equal(result.impliedBreakEvenProbability, 1 / 3);
  assert.equal(evaluateParlay([{ decimalOdds: 2, estimatedProbability: .5 }, { decimalOdds: 2, estimatedProbability: .5 }], 10).independentProbability, .25);
  assert.throws(() => evaluateParlay([{ decimalOdds: 2, gameId: 'a' }, { decimalOdds: 3, gameId: 'a' }], 10), /one leg per game/);
  for (const n of [0, 1, 11]) assert.throws(() => evaluateParlay(Array(n).fill({ decimalOdds: 2 }), 10));
  assert.throws(() => evaluateParlay([{ decimalOdds: 2 }, { decimalOdds: 2 }], NaN));
  assert.throws(() => expectedValue(2, NaN)); assert.throws(() => expectedValue(Infinity, .5));
});
test('API-Sports schemas retain zero scores and numeric NBA statuses', () => {
  const nba = normalizeGame('nba', { id: 1, date: { start: game.start }, status: { short: 3, long: 'Finished' }, teams: { home: { id: 1, name: 'Home' }, visitors: { id: 2, name: 'Away' } }, scores: { home: { points: 0 }, visitors: { points: 100 } } });
  assert.equal(nba?.phase, 'finished'); assert.equal(nba?.homeScore, 0); assert.equal(nba?.awayScore, 100);
  const soccer = normalizeGame('soccer', { fixture: { id: 2, date: game.start, status: { short: 'NS' } }, teams: { home: { name: 'A' }, away: { name: 'B' } }, goals: { home: null, away: null } });
  assert.equal(soccer?.homeScore, null); assert.equal(soccer?.oddsGameId, 2);
  assert.equal(normalizeGame('nba', {}), null);
  assert.equal(numberOrNull([]), null); assert.equal(numberOrNull(' '), null);
});
test('NBA overlaps map actual provider IDs and leave different games separate', () => {
  const basketball: Game = { ...game, id: 'api:basketball:500', sport: 'basketball', providerId: 500, home: 'LA Lakers' };
  const merged = mergeBasketballGames([game, basketball]);
  assert.equal(merged.length, 1); assert.equal(merged[0].oddsGameId, 500); assert.equal(merged[0].id, game.id);
  assert.equal(mergeBasketballGames([game, { ...basketball, start: '2030-10-26T23:00:00Z' }]).length, 2);
});

test('NFL uses the provider timestamp instead of interpreting a local date as UTC midnight', () => {
  const raw = { game: { id: 21607, date: { date: '2026-10-25', time: '09:30', timezone: 'America/New_York', timestamp: 1792935000 }, status: { short: 'FT', long: 'Finished' } }, league: { name: 'NFL', season: '2026' }, teams: { home: { name: 'New Orleans Saints', id: 27 }, away: { name: 'Pittsburgh Steelers', id: 22 } }, scores: { home: { total: 10 }, away: { total: 16 } } };
  const normalized = normalizeGame('nfl', raw);
  assert.equal(normalized?.start, '2026-10-25T13:30:00.000Z');
  assert.equal(easternDate(normalized!.start), '2026-10-25');
  assert.equal(normalized?.phase, 'finished'); assert.equal(normalized?.homeScore, 10); assert.equal(normalized?.awayScore, 16);
  assert.equal(normalizeGame('nfl', { ...raw, game: { ...raw.game, date: { date: '2026-10-25', time: '09:30' } } }), null);
  assert.equal(normalizeGame('nfl', { ...raw, game: { ...raw.game, date: { ...raw.game.date, timestamp: 1e100 } } }), null);
});
test('API-Sports odds skip mismatched events, malformed prices and missing fields', () => {
  const row = { game: { id: 500 }, bookmakers: [{ id: 1, name: 'Book', bets: [{ id: 3, name: 'Player Points', values: [{ value: 'A Over 20.5', odd: '1.91' }, { value: 'B', odd: 'NaN' }, { value: 'C', odd: '1' }] }] }] };
  assert.equal(normalizeMarkets([row], game).length, 0);
  const markets = normalizeMarkets([row], { ...game, oddsGameId: 500 });
  assert.equal(markets.length, 1); assert.equal(markets[0].kind, 'player'); assert.equal(markets[0].updatedAt, null);
});
test('ESPN scheduled games do not turn empty scores into zero; suspended games are unavailable', () => {
  const raw = { id: '9', date: game.start, status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { id: 1, displayName: 'A' }, score: '0' }, { homeAway: 'away', team: { id: 2, displayName: 'B' }, score: '0' }] }] };
  assert.equal(normalizeEspnGame(raw, 'nba', 'basketball/nba', 'NBA')?.homeScore, null);
  raw.status.type.name = 'STATUS_POSTPONED';
  assert.equal(normalizeEspnGame(raw, 'nba', 'basketball/nba', 'NBA')?.phase, 'unavailable');
  const odds = normalizeEspnOdds([{ provider: { name: 'Book', id: 1 }, moneyline: { home: { close: { odds: '+150' } }, away: { close: { odds: '-200' } } }, total: { over: { close: { line: 'o220.5', odds: '-110' } } } }], game);
  assert.equal(odds.length, 3); assert.equal(odds[0].decimalOdds, 2.5); assert.equal(odds[1].decimalOdds, 1.5);
  assert.equal(odds[2].selection, 'Over 220.5'); assert.equal(odds[2].updatedAt, null);
});
test('odds-api.net normalizes player names, periods, lines, availability and freshness', () => {
  const markets = normalizeOddsSnapshot({ event_id: 'e', as_of_ts_ms: 1760000000000, items: [
    { id: '1', event_id: 'e', bookmaker: 'book', market_key: 'player_points', period: 'full time', player_name: 'Player A', selection_name: 'Over', line: '24.5', odds: 1.95, is_available: true },
    { id: '2', event_id: 'e', bookmaker: 'book', market_key: 'moneyline', selection_name: 'Home', odds: 2, is_available: false },
    { id: '3', event_id: 'wrong', bookmaker: 'book', market_key: 'moneyline', selection_name: 'Home', odds: 2 },
  ] }, game);
  assert.equal(markets.length, 1); assert.equal(markets[0].kind, 'player'); assert.equal(markets[0].selection, 'Player A Over 24.5');
  assert.equal(markets[0].updatedAt, new Date(1760000000000).toISOString());
  assert.equal(matchesOddsEvent({ home_team: 'LA Lakers', away_team: game.away, start_time: Date.parse(game.start) / 1000 }, game), true);
  assert.equal(matchesOddsEvent({ home_team: game.away, away_team: game.home, start_time: Date.parse(game.start) / 1000 }, game), false);
});
test('player history excludes DNP, missing stats and future events and preserves real zeroes', () => {
  const result = normalizePlayerHistory({ names: ['points', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], displayNames: ['Points', '3PT'], events: { a: { gameDate: '2020-01-01T12:00Z' }, b: { gameDate: '2020-01-02T12:00Z' }, c: { gameDate: '2040-01-01T12:00Z' } }, seasonTypes: [{ categories: [{ events: [{ eventId: 'a', stats: ['0', '0-3'] }, { eventId: 'b', stats: ['DNP', ''] }, { eventId: 'c', stats: ['99', '9-9'] }] }] }] }, '2030-01-01T00:00Z');
  assert.equal(result.games.length, 1); assert.equal(result.games[0].stats.points, 0); assert.equal(result.games[0].stats.threePointFieldGoalsMade, 0);
});
test('fallback occurs on API failure but a valid empty schedule stays empty', async () => {
  const oldKey = process.env.API_SPORTS_KEY, oldFallback = process.env.ESPN_FALLBACK_ENABLED;
  process.env.API_SPORTS_KEY = 'test'; process.env.ESPN_FALLBACK_ENABLED = 'true';
  let calls = 0;
  try {
    const fallback = async () => { calls++; return [game]; };
    const failed = await loadSport('nba', '2030-10-25', async () => { throw Error('Quota reached.'); }, fallback);
    assert.equal(failed.provider.status, 'fallback'); assert.equal(failed.games.length, 1);
    const empty = await loadSport('nba', '2030-10-25', async () => [], fallback);
    assert.equal(empty.provider.status, 'empty'); assert.equal(calls, 1);
  } finally { if (oldKey === undefined) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = oldKey; if (oldFallback === undefined) delete process.env.ESPN_FALLBACK_ENABLED; else process.env.ESPN_FALLBACK_ENABLED = oldFallback; }
});
test('provider client deduplicates requests and redacts HTTP-200 credential errors', async t => {
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ response: [] }); });
  const url = new URL('https://example.test/cache-test');
  const [a, b] = await Promise.all([providerJson(url, 'test-key'), providerJson(url, 'test-key')]);
  assert.equal(calls, 1); assert.equal(a._fetchedAt, b._fetchedAt);
  mock.mock.mockImplementation(async () => Response.json({ errors: { token: 'secret-value' } }));
  await assert.rejects(providerJson(new URL('https://example.test/error-test')), e => e instanceof Error && !e.message.includes('secret-value'));
});
test('odds adapter uses X-API-Key and follows both pagination cursors', async t => {
  const old = process.env.ODDS_API_KEY; process.env.ODDS_API_KEY = 'mock-odds-key'; const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.host, 'api.odds-api.net'); assert.equal(new Headers(init?.headers).get('X-API-Key'), 'mock-odds-key');
    if (url.pathname.endsWith('/events')) return Response.json(url.searchParams.has('cursor') ? { items: [{ event_id: 'correct', home_team: game.home, away_team: game.away, start_time: Date.parse(game.start) / 1000 }], next_cursor: null } : { items: [], next_cursor: 'events-next' });
    return Response.json({ event_id: 'correct', items: [{ id: url.searchParams.has('cursor') ? 'b' : 'a', event_id: 'correct', bookmaker: 'Book', market_key: 'moneyline', selection_name: 'Home', odds: 2 }], complete: url.searchParams.has('cursor'), next_cursor: url.searchParams.has('cursor') ? null : 'odds-next' });
  });
  try { const result = await fetchOddsMarkets(game); assert.equal(result.markets.length, 2); assert.equal(requests.length, 4); }
  finally { if (old === undefined) delete process.env.ODDS_API_KEY; else process.env.ODDS_API_KEY = old; }
});
test('API routes reject malformed bodies and unauthorized scheduled runs', async () => {
  const bad = await parlayPost(new Request('http://localhost/api/parlays', { method: 'POST', body: 'null' })); assert.equal(bad.status, 400);
  const valid = await parlayPost(new Request('http://localhost/api/parlays', { method: 'POST', body: JSON.stringify({ legs: [{ decimalOdds: 2 }, { decimalOdds: 2 }], stake: 5 }) }));
  assert.equal(valid.status, 200); assert.equal((await valid.json()).estimatedPayout, 20);
  const unauthorized = await researchPost(new Request('http://localhost/api/research', { method: 'POST' })); assert.equal(unauthorized.status, 401);
});
