import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTheOddsMarkets, normalizeTheOddsMarkets, relevantTheOddsSports, matchesTheOddsEvent } from '../lib/the-odds-api';
import { providerJson } from '../lib/http';
import { GET as marketsGet } from '../app/api/markets/route';
import type { Game } from '../lib/domain';

const game: Game = { id: 'espn:nba:50', providerId: 50, source: 'espn', sport: 'nba', league: 'NBA', season: '2030', home: 'Los Angeles Lakers', away: 'Boston Celtics', homeId: 1, awayId: 2, start: '2030-10-25T23:00:00Z', status: 'Scheduled', phase: 'scheduled', homeScore: null, awayScore: null };
const event = { id: 'matched', sport_key: 'basketball_nba', home_team: 'LA Lakers', away_team: game.away, commence_time: game.start };
const book = (markets: unknown[]) => ({ key: 'draftkings', title: 'DraftKings', markets });

test('The Odds API maps sport families and rejects reversed or late events', () => {
  const rows = ['basketball_nba', 'basketball_wnba', 'basketball_euroleague', 'soccer_epl', 'baseball_mlb', 'icehockey_nhl', 'aussierules_afl', 'americanfootball_nfl'].map(key => ({ key, active: true }));
  assert.deepEqual(relevantTheOddsSports(rows, 'basketball'), ['basketball_euroleague', 'basketball_wnba']);
  assert.deepEqual(relevantTheOddsSports([...rows, { key: 'basketball_nba_winner', has_outrights: true }], 'nba'), ['basketball_nba']);
  for (const sport of ['soccer', 'baseball', 'hockey', 'afl', 'nfl'] as const) assert.equal(relevantTheOddsSports(rows, sport).length, 1);
  assert.equal(matchesTheOddsEvent(event, game), true);
  assert.equal(matchesTheOddsEvent({ ...event, commence_time: '2030-10-25T23:10:00Z' }, game), true);
  assert.equal(matchesTheOddsEvent({ ...event, commence_time: '2030-10-25T23:16:00Z' }, game), false);
  assert.equal(matchesTheOddsEvent({ ...event, home_team: game.away, away_team: game.home }, game), false);
  assert.equal(matchesTheOddsEvent({ ...event, commence_time: '2030-10-26T23:00:00Z' }, game), false);
});

test('The Odds API keeps player identity, zero lines and market freshness; rejects exchanges and bad prices', () => {
  const timestamp = '2030-10-25T20:00:00Z';
  const body = { ...event, _fetchedAt: timestamp, bookmakers: [book([
    { key: 'player_points', last_update: timestamp, outcomes: [{ name: 'Over', description: 'Player One', price: 1.91, point: 0 }, { name: 'Over', price: 2, point: 5 }, { name: 'Under', description: 'Player One', price: 'NaN', point: 0 }] },
    { key: 'h2h', outcomes: [{ name: game.home, price: 2 }] },
    { key: 'h2h_lay', outcomes: [{ name: game.home, price: 3 }] },
  ]), { key: 'betfair_ex_eu', title: 'Betfair', markets: [{ key: 'h2h', outcomes: [{ name: game.home, price: 3 }] }] }] };
  const markets = normalizeTheOddsMarkets(body, game);
  assert.equal(markets.length, 2); assert.equal(markets[0].selection, 'Player One Over 0'); assert.equal(markets[0].updatedAt, new Date(timestamp).toISOString());
  assert.equal(markets[1].updatedAt, null); assert.equal(markets[0].kind, 'player');
  assert.equal(normalizeTheOddsMarkets({ ...body, away_team: 'Other' }, game).length, 0);
});

test('query authentication stays out of caller URLs and credential errors', async t => {
  const url = new URL('https://example.test/query-auth');
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    const outgoing = new URL(String(input));
    assert.equal(outgoing.searchParams.get('apiKey'), 'test-query-secret'); assert.equal(new Headers(init?.headers).has('X-API-Key'), false);
    return Response.json({ message: `Invalid ${outgoing}` }, { status: 401 });
  });
  await assert.rejects(providerJson(url, 'test-query-secret', 1, 'query:apiKey', true), error => error instanceof Error && !error.message.includes('test-query-secret'));
  assert.equal(url.searchParams.has('apiKey'), false);
});

test('The Odds API loads props on demand, caps markets, caches requests and never uses odds-api.net', async t => {
  const previous = process.env.THE_ODDS_API_KEY, previousRegion = process.env.THE_ODDS_API_REGIONS;
  process.env.THE_ODDS_API_KEY = 'mock-the-odds'; process.env.THE_ODDS_API_REGIONS = 'us';
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(url.host, 'api.the-odds-api.com'); assert.equal(url.searchParams.get('apiKey'), 'mock-the-odds');
    if (url.pathname === '/v4/sports') return Response.json([{ key: 'basketball_nba', active: true }]);
    if (url.pathname.endsWith('/events')) return Response.json([event]);
    if (url.pathname.endsWith('/markets')) return Response.json({ ...event, bookmakers: [book(['player_points', 'player_rebounds', 'player_assists', ...Array.from({ length: 8 }, (_, i) => `player_test_${i}`)].map(key => ({ key })))] });
    assert.equal(url.searchParams.get('oddsFormat'), 'decimal'); assert.equal(url.searchParams.get('regions'), 'us');
    const keys = url.searchParams.get('markets')!.split(',');
    return Response.json({ ...event, bookmakers: [book(keys.map(key => ({ key, outcomes: [{ name: key === 'h2h' ? game.home : 'Over', ...(key.startsWith('player_') ? { description: 'Player One' } : {}), price: 2, point: 12.5 }] })))] }, { headers: { 'x-requests-remaining': '480' } });
  });
  try {
    const games = await fetchTheOddsMarkets(game, 'game');
    assert.equal(games.markets.length, 3); assert.equal(requests.length, 3); assert.equal(requests.some(u => u.pathname.endsWith('/markets')), false);
    const props = await fetchTheOddsMarkets(game, 'player');
    assert.equal(props.markets.length, 8); assert.match(props.notice, /8 of 11/); assert.match(props.notice, /480/);
    assert.equal(requests.length, 5); assert.equal(props.markets.every(m => m.kind === 'player'), true);
    await fetchTheOddsMarkets(game, 'player'); assert.equal(requests.length, 5);
  } finally {
    if (previous === undefined) delete process.env.THE_ODDS_API_KEY; else process.env.THE_ODDS_API_KEY = previous;
    if (previousRegion === undefined) delete process.env.THE_ODDS_API_REGIONS; else process.env.THE_ODDS_API_REGIONS = previousRegion;
  }
});

test('market API validates kind before fetching schedules', async () => {
  const result = await marketsGet(new Request('http://localhost/api/markets?kind=unknown'));
  assert.equal(result.status, 400); assert.match((await result.json()).error, /Market kind/);
});

test('ambiguous provider events are rejected before any odds credits are spent', async t => {
  const old = process.env.THE_ODDS_API_KEY; process.env.THE_ODDS_API_KEY = 'ambiguous-test-key';
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname === '/v4/sports') return Response.json([{ key: 'basketball_nba', active: true }]);
    assert.equal(url.pathname.endsWith('/events'), true);
    return Response.json([event, { ...event, id: 'second-match' }]);
  });
  try { await assert.rejects(fetchTheOddsMarkets(game, 'game'), /no unique matching event/); }
  finally { if (old === undefined) delete process.env.THE_ODDS_API_KEY; else process.env.THE_ODDS_API_KEY = old; }
});
