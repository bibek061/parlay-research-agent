'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SPORTS, TIME_ZONE, isSport, type Game, type Leg, type Market, type Slate } from '../../lib/domain';
import { easternDate } from '../../lib/time';
import { evaluateParlay, impliedProbability } from '../../lib/math';
import PlayerResearch from './player-research';

type Config = { apiSports: boolean; theOdds: boolean; odds: boolean; espn: boolean; scheduler: boolean };
const formatTime = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(date));
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
function validateSavedLeg(leg: Leg) {
  return leg && typeof leg.id === 'string' && typeof leg.gameId === 'string' && isSport(leg.sport) && typeof leg.selection === 'string' && typeof leg.matchup === 'string' && typeof leg.market === 'string' && typeof leg.bookmaker === 'string' && ['manual', 'provider'].includes(leg.source) && ['game', 'player'].includes(leg.kind) && Number.isFinite(Date.parse(leg.start)) && Number.isFinite(leg.decimalOdds) && leg.decimalOdds > 1 && leg.decimalOdds <= 10000;
}
export default function Dashboard({ today, config }: { today: string; config: Config }) {
  const [date, setDate] = useState(today);
  const [slate, setSlate] = useState<Slate | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sport, setSport] = useState('all');
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('all');
  const [limit, setLimit] = useState(24);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<'game' | 'player'>('game');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketNotice, setMarketNotice] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);
  const [book, setBook] = useState('all');
  const [marketQuery, setMarketQuery] = useState('');
  const [marketLimit, setMarketLimit] = useState(16);
  const [playerName, setPlayerName] = useState('');
  const [slips, setSlips] = useState<Record<string, Leg[]>>({});
  const [hydrated, setHydrated] = useState(false);
  const [stake, setStake] = useState('10');
  const [clock, setClock] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const legs = slips[date] ?? [];
  const selected = slate?.games.find(g => g.id === selectedId);
  useEffect(() => {
    setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('parlay-lab-slips-v1') || '{}');
      const clean: Record<string, Leg[]> = {};
      Object.entries(saved).slice(-30).forEach(([day, items]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(items)) clean[day] = items.filter(validateSavedLeg).slice(0, 10); });
      setSlips(clean);
    } catch { setMessage('Saved picks could not be read. Your new board is ready.'); }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) try { localStorage.setItem('parlay-lab-slips-v1', JSON.stringify(slips)); } catch { setMessage('Browser storage is unavailable. Export your slip to keep a copy.'); }
  }, [slips, hydrated]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setSlate(null); setSelectedId('');
    fetch(`/api/research?date=${date}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data; })
      .then(setSlate).catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, refresh]);
  useEffect(() => { setLimit(24); }, [sport, query, phase, date]);
  useEffect(() => {
    setMarkets([]); setMarketNotice(''); setBook('all'); setMarketQuery(''); setMarketLimit(16);
    if (!selectedId) return;
    const controller = new AbortController(); setMarketLoading(true);
    fetch(`/api/markets?date=${date}&game=${encodeURIComponent(selectedId)}&kind=${mode}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data; })
      .then(data => { setMarkets(data.markets); setMarketNotice(data.notice); })
      .catch(e => { if (e.name !== 'AbortError') setMarketNotice(e.message); })
      .finally(() => { if (!controller.signal.aborted) setMarketLoading(false); });
    return () => controller.abort();
  }, [selectedId, date, mode]);
  useEffect(() => { setPlayerName(''); }, [selectedId, date]);
  useEffect(() => { setMarketLimit(16); }, [mode, book, marketQuery]);
  const gameRank = (g: Game) => g.phase === 'scheduled' && Date.parse(g.start) > clock ? 0 : g.phase === 'live' ? 1 : 2;
  const games = (slate?.games ?? []).filter(g => (sport === 'all' || g.sport === sport) && (phase === 'all' || g.phase === phase) && `${g.home} ${g.away} ${g.league}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => gameRank(a) - gameRank(b) || a.start.localeCompare(b.start));
  const filteredMarkets = markets.filter(m => m.gameId === selectedId && m.kind === mode && (book === 'all' || m.bookmaker === book) && `${m.name} ${m.selection}`.toLowerCase().includes(marketQuery.toLowerCase()));
  const books = [...new Set(markets.map(m => m.bookmaker))];
  const evaluation = useMemo(() => { try { return evaluateParlay(legs, Number(stake)); } catch { return null; } }, [legs, stake]);
  const invalidLegs = legs.filter(l => Date.parse(l.start) <= clock || slate?.games.some(g => g.id === l.gameId && g.phase !== 'scheduled'));
  const canAdd = selected?.phase === 'scheduled' && Date.parse(selected.start) > clock;
  const updateLegs = (items: Leg[]) => setSlips(current => ({ ...current, [date]: items }));
  function addLeg(leg: Leg) {
    if (legs.length >= 10) { setMessage('Your slip already has 10 legs. Remove one before adding another.'); return; }
    if (legs.some(l => l.gameId === leg.gameId)) { setMessage('This matchup is already on your slip. Use one leg per game.'); return; }
    if (!canAdd || Date.parse(leg.start) <= Date.now()) { setMessage('This game is no longer available for a pre-match pick.'); return; }
    updateLegs([...legs, leg]); setMessage(`Added: ${leg.selection}`);
  }
  function addMarket(m: Market) {
    if (!selected || m.gameId !== selected.id) return;
    addLeg({ id: m.id, gameId: selected.id, sport: selected.sport, matchup: `${selected.away} at ${selected.home}`, start: selected.start, selection: m.selection, market: m.name, decimalOdds: m.decimalOdds, bookmaker: m.bookmaker, kind: m.kind, source: 'provider' });
  }
  function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const data = new FormData(event.currentTarget); const decimalOdds = Number(data.get('odds'));
    try { impliedProbability(decimalOdds); } catch (e) { setMessage((e as Error).message); return; }
    const selection = String(data.get('selection') || '').trim(), market = String(data.get('market') || '').trim(), bookmaker = String(data.get('bookmaker') || '').trim();
    if (!selection || !market || !bookmaker || mode === 'player' && !playerName.trim()) { setMessage('Complete the selection, market, player (for props), and bookmaker.'); return; }
    addLeg({ id: `manual:${crypto.randomUUID()}`, gameId: selected.id, sport: selected.sport, matchup: `${selected.away} at ${selected.home}`, start: selected.start,
      selection: `${mode === 'player' ? `${playerName.trim()} · ` : ''}${selection}`, market, decimalOdds, bookmaker, kind: mode, source: 'manual' });
  }
  function exportSlip() {
    const blob = new Blob([JSON.stringify({ date, exportedAt: new Date().toISOString(), legs, stake: Number(stake), evaluation, status: 'research-only', hasStartedLegs: invalidLegs.length > 0 }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `parlay-${date}.json`; anchor.click(); URL.revokeObjectURL(url); setMessage('Research slip exported.');
  }
  function chooseGame(game: Game) { setSelectedId(game.id); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  const counts = { games: slate?.games.length ?? 0, upcoming: slate?.games.filter(g => g.phase === 'scheduled' && Date.parse(g.start) > clock).length ?? 0, sports: new Set(slate?.games.map(g => g.sport)).size, fallback: slate?.providers.filter(p => p.status === 'fallback').length ?? 0 };
  return <>
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">↗</span><span>PARLAY<span className="brand-light">LAB</span><small>DAILY RESEARCH DESK</small></span></a><nav aria-label="Main navigation"><a href="#board" onClick={() => setMode('game')}>Daily board</a><a href="#match-research" onClick={() => setMode('player')}>Player props</a><a href="#connections">Connections</a></nav><span className="open-source">◈ OPEN SOURCE</span></header>
    <main className="shell">
      <section className="hero"><div><p className="eyebrow"><span className="live-dot" /> EVERY SPORT. EVERY DAY.</p><h1>Your daily research edge<span>.</span></h1><p className="subtitle">Explore the slate, research player props, and build a mix that’s yours.</p></div><div className="date-control"><label htmlFor="research-date">RESEARCH DATE · EASTERN TIME</label><div><input id="research-date" type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /><button className="quiet" onClick={() => setDate(easternDate())}>Today</button></div></div></section>
      <section className="metrics" aria-label="Daily summary">{[{ value: counts.games, label: 'Games on the board', sub: 'Across available competitions' }, { value: counts.upcoming, label: 'Upcoming games', sub: 'Scheduled, before first whistle' }, { value: counts.sports, label: 'Sports in play', sub: 'Mix sports in a single slip' }, { value: `${legs.length}/10`, label: 'Your selected legs', sub: `${legs.filter(l => l.kind === 'player').length} player props in your mix` }].map(m => <div className="metric" key={m.label}><p>{m.label}</p><strong>{loading && m.label !== 'Your selected legs' ? '—' : m.value}</strong><small>{m.sub}</small></div>)}</section>
      <div className="workspace">
        <div className="research-column">
          <section className="panel" id="board"><div className="panel-heading"><div><p className="eyebrow">THE DAILY SLATE</p><h2>Find your next matchup</h2></div><button className="outline" disabled={loading} onClick={() => setRefresh(r => r + 1)}>{loading ? 'Loading…' : '↻ Refresh'}</button></div>
            <div className="sport-tabs" aria-label="Filter by sport"><button className={sport === 'all' ? 'active' : ''} onClick={() => setSport('all')}>✳ All sports</button>{SPORTS.map(s => <button key={s.id} className={sport === s.id ? 'active' : ''} onClick={() => setSport(s.id)}>{s.icon} {s.label}</button>)}</div>
            <div className="filters"><label className="search"><span className="sr-only">Search teams or leagues</span><input placeholder="Search teams or leagues…" value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="sr-only">Game status</span><select value={phase} onChange={e => setPhase(e.target.value)}><option value="all">All games</option><option value="scheduled">Scheduled</option><option value="live">In progress</option><option value="finished">Final</option><option value="unavailable">Postponed / other</option></select></label></div>
            {loading && <div className="empty" role="status"><div className="spinner" /><h3>Putting the day’s slate together</h3><p>Checking schedules across seven sports.</p></div>}
            {error && <div className="notice error" role="alert">{error}</div>}
            {!loading && !games.length && <div className="empty"><span className="empty-icon">◎</span><h3>{slate?.providers.every(p => p.status === 'error') ? 'Data connections are unavailable' : 'No games match this view'}</h3><p>{slate?.providers.every(p => p.status === 'error') ? 'Check Connections below for provider details, then refresh.' : 'Try another date, sport, or search.'}</p></div>}
            <div className="game-grid">{games.slice(0, limit).map(g => <button className={`game-card ${selectedId === g.id ? 'selected' : ''}`} key={g.id} onClick={() => chooseGame(g)} aria-pressed={selectedId === g.id}><div className="game-meta"><span>{SPORTS.find(s => s.id === g.sport)?.icon} {g.league}</span><span className={g.phase === 'live' ? 'live-label' : ''}>{g.phase === 'scheduled' ? formatTime(g.start) : g.phase === 'finished' ? 'FINAL' : g.status}</span></div><div className="team-row"><span className="team-avatar">{g.away.split(' ').map(w => w[0]).slice(0, 3).join('')}</span><strong>{g.away}</strong><b>{g.awayScore ?? '—'}</b></div><div className="team-row"><span className="team-avatar home">{g.home.split(' ').map(w => w[0]).slice(0, 3).join('')}</span><strong>{g.home}</strong><b>{g.homeScore ?? '—'}</b></div><div className="game-footer"><small>{g.source === 'espn' ? 'ESPN fallback' : 'API-Sports'}</small><span>Research game ↗</span></div></button>)}</div>
            {games.length > limit && <button className="more" onClick={() => setLimit(n => n + 24)}>Show more · {games.length - limit} remaining</button>}
            <div className="panel-foot">{slate ? `Checked ${formatTime(slate.fetchedAt)} ET · Cached for 5 minutes · ${counts.fallback} sports using ESPN fallback` : 'Schedules use America/New_York, including daylight saving time.'}</div>
          </section>
          <section className="panel match-panel" id="match-research" ref={detailRef}><div className="panel-heading"><div><p className="eyebrow">LOOK CLOSER</p><h2>{selected ? `${selected.away} at ${selected.home}` : 'Research a game'}</h2></div>{selected && <button className="quiet" aria-label="Close game research" onClick={() => setSelectedId('')}>×</button>}</div>
            {!selected ? <div className="empty compact"><span className="empty-icon">⌕</span><h3>Start with a matchup</h3><p>Select a game above to explore odds, research players, or add your own line.</p></div> : <div className="match-content" key={selected.id}>
              <div className="segment"><button className={mode === 'game' ? 'active' : ''} onClick={() => setMode('game')}>Game markets</button><button className={mode === 'player' ? 'active' : ''} onClick={() => setMode('player')}>Player props</button></div>
              {mode === 'player' && <PlayerResearch key={selected.id} game={selected} date={date} onPlayer={setPlayerName} />}
              <div className="section-title"><h3>{mode === 'player' ? 'Player-prop prices' : 'Available markets'}</h3><span className="tag">DECIMAL ODDS</span></div>
              <div className="filters"><input aria-label="Search markets" placeholder="Search player or market…" value={marketQuery} onChange={e => setMarketQuery(e.target.value)} /><select aria-label="Bookmaker" value={book} onChange={e => setBook(e.target.value)}><option value="all">All bookmakers</option>{books.map(b => <option key={b}>{b}</option>)}</select></div>
              {marketLoading && <p role="status">Checking available odds…</p>}
              {!marketLoading && !filteredMarkets.length && <div className="notice">No {mode === 'player' ? 'player-prop' : 'game'} prices returned for this view. You can enter a verified sportsbook line below.</div>}
              <div className="market-list">{filteredMarkets.slice(0, marketLimit).map(m => {
                const stale = !!m.updatedAt && clock - Date.parse(m.updatedAt) > 900000;
                return <button key={m.id} className="market-row" disabled={!canAdd || stale || legs.some(l => l.gameId === m.gameId)} onClick={() => addMarket(m)}><span><strong>{m.selection}</strong><small>{m.name} · {m.bookmaker}</small><small>{stale ? 'Stale price · ' : ''}{m.updatedAt ? `Updated ${formatTime(m.updatedAt)} ET` : 'Update time unavailable'}</small></span><b>{m.decimalOdds.toFixed(2)} <span>+</span></b></button>;
              })}</div>
              {filteredMarkets.length > marketLimit && <button className="more" onClick={() => setMarketLimit(n => n + 20)}>More markets ({filteredMarkets.length - marketLimit})</button>}
              <p className="fine-print">{marketNotice}</p>
              <details className="manual-entry" open={!marketLoading && !filteredMarkets.length}><summary>Add your own {mode === 'player' ? 'player prop' : 'sportsbook line'}</summary><p className="fine-print">Manual entries are labeled on your slip. Use the sportsbook’s current decimal odds.</p><form key={mode} onSubmit={addManual}>
                <div className="form-grid">{mode === 'player' && <label className="span-two">Player name<input value={playerName} onChange={e => setPlayerName(e.target.value)} required maxLength={100} placeholder="Player’s full name" /></label>}<label>Market<input name="market" required maxLength={100} placeholder={mode === 'player' ? 'Points, assists, strikeouts…' : 'Moneyline, spread, total…'} /></label><label>Selection<input name="selection" required maxLength={100} placeholder={mode === 'player' ? 'Over 24.5' : 'Home team -3.5'} /></label><label>Decimal odds<input name="odds" type="number" step="0.001" min="1.001" max="10000" required placeholder="1.91" /></label><label>Bookmaker<input name="bookmaker" required maxLength={80} placeholder="Sportsbook name" /></label></div><button className="primary wide" disabled={!canAdd}>+ Add {mode === 'player' ? 'player prop' : 'game pick'} to slip</button>{!canAdd && <p className="fine-print">This game has started or is not scheduled. Pre-match picks are disabled.</p>}</form></details>
            </div>}
          </section>
          <section className="panel connections" id="connections"><div className="panel-heading"><div><p className="eyebrow">CONNECTED SOURCES</p><h2>Know where your data comes from</h2></div><span className="tag">SERVER ONLY KEYS</span></div><div className="connection-summary"><div><strong>API-Sports</strong><span>{config.apiSports ? 'Key configured' : 'Optional key not set'}</span></div><div><strong>The Odds API</strong><span>{config.theOdds ? 'Key configured · odds load on demand' : 'Add THE_ODDS_API_KEY for prop prices'}</span></div><div><strong>ESPN fallback</strong><span>{config.espn ? 'Enabled · no key needed' : 'Disabled'}</span></div>{config.odds && <div><strong>odds-api.net</strong><span>Optional backup key configured</span></div>}</div>
            <div className="provider-list">{slate?.providers.map(p => <details key={p.sport}><summary><span>{SPORTS.find(s => s.id === p.sport)?.label}</span><span className={`status ${p.status}`}>{p.status === 'fallback' ? 'ESPN fallback' : p.status === 'ready' ? 'API-Sports' : p.status === 'empty' ? 'No games' : 'Unavailable'} · {p.games}</span></summary><p>{p.message}</p></details>)}</div>
            <div className="setup-note"><p>Odds come from The Odds API at the-odds-api.com. Player props load when you open their tab, with up to eight market types per matchup. Coverage depends on the event and bookmakers.</p><p>Daily schedule: 8 AM Eastern. {config.scheduler ? 'Research token configured; run the local scheduler or deploy the workflow to activate unattended runs.' : 'Set RESEARCH_API_TOKEN and run the local scheduler to activate unattended runs.'}</p><p>App code: MIT. External data remains subject to each provider’s terms. <a href="https://github.com/pseudo-r/Public-ESPN-API" target="_blank" rel="noreferrer">ESPN reference ↗</a> · <a href="https://the-odds-api.com/liveapi/guides/v4/" target="_blank" rel="noreferrer">The Odds API documentation ↗</a></p></div>
          </section>
        </div>
        <aside className="slip panel"><div className="slip-heading"><div className="eyebrow">YOUR MIX</div><h2>Parlay builder <span>{legs.length}</span></h2><p>Game picks + player props. Across sports.</p></div>
          {legs.length === 0 ? <div className="empty slip-empty"><span className="slip-art">＋</span><h3>A fresh slip. A fresh start.</h3><p>Add 2–10 picks from the daily board.<br />One leg per game.</p></div> : <div className="legs">{legs.map((l, i) => <div className={`leg ${invalidLegs.includes(l) ? 'expired' : ''}`} key={l.id}><div className="leg-meta"><span>{String(i + 1).padStart(2, '0')} · {SPORTS.find(s => s.id === l.sport)?.label} · {l.kind === 'player' ? 'PROP' : 'GAME'}</span><button className="remove" aria-label={`Remove ${l.selection}`} onClick={() => updateLegs(legs.filter(x => x.id !== l.id))}>×</button></div><strong>{l.selection}</strong><small>{l.market}</small><small>{l.matchup}</small><div className="leg-bottom"><small>{l.bookmaker}{l.source === 'manual' ? ' · Manual' : ''}</small><b>{l.decimalOdds.toFixed(2)}</b></div></div>)}</div>}
          <div className="slip-calculator"><label>Illustrative stake (USD)<div className="stake-input"><span>$</span><input aria-label="Stake in dollars" type="number" min="0.01" max="1000000" step="0.01" value={stake} onChange={e => setStake(e.target.value)} /></div></label><div className="stake-presets">{[5, 10, 25].map(n => <button key={n} className={Number(stake) === n ? 'active' : ''} onClick={() => setStake(String(n))}>${n}</button>)}</div>
            <dl><div><dt>Combined decimal odds</dt><dd>{evaluation ? `${evaluation.combinedDecimalOdds.toFixed(2)}×` : '—'}</dd></div><div><dt>Implied break-even</dt><dd>{evaluation ? `${(evaluation.impliedBreakEvenProbability * 100).toFixed(2)}%` : '—'}</dd></div><div><dt>Illustrative net profit</dt><dd>{evaluation ? money(evaluation.estimatedNetProfit) : '—'}</dd></div></dl><div className="payout"><span>Illustrative return</span><strong>{evaluation ? money(evaluation.estimatedPayout) : '—'}</strong><small>Includes your stake · all legs must win</small></div>
            {invalidLegs.length > 0 && <p className="notice error">{invalidLegs.length} leg(s) started or became unavailable. Remove them before using this slip.</p>}
            {legs.length >= 2 && !evaluation && <p className="notice error">Enter a valid positive stake and check for duplicate games.</p>}
            {new Set(legs.map(l => l.bookmaker)).size > 1 && <p className="fine-print">This slip combines different bookmakers. The multiplied price is a comparison, not a single book’s quote.</p>}
            <button className="primary wide" disabled={!legs.length} onClick={exportSlip}>Export research slip ↗</button>{legs.length > 0 && <button className="more" onClick={() => { updateLegs([]); setMessage('Slip cleared for this date.'); }}>Clear slip</button>}
            <p className="fine-print">Saved in this browser by date. Prices and payouts are illustrative; implied probability is not a prediction. No bets are placed.</p>
          </div>
        </aside>
      </div>
      <footer><span>PARLAY LAB <span className="muted">/ Daily sports research</span></span><span>Open source · Self-hosted · Research only</span></footer>
    </main>
    {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Dismiss notification" onClick={() => setMessage('')}>×</button></div>}
  </>;
}
