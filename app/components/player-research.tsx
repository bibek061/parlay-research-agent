'use client';
import { useEffect, useState } from 'react';
import type { Game, Player } from '../../lib/domain';
import type { PlayerHistory } from '../../lib/players';

export default function PlayerResearch({ game, date, onPlayer }: { game: Game; date: string; onPlayer: (name: string) => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [player, setPlayer] = useState('');
  const [history, setHistory] = useState<PlayerHistory | null>(null);
  const [metric, setMetric] = useState('');
  const [line, setLine] = useState('');
  const [direction, setDirection] = useState('over');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setMessage('');
    fetch(`/api/players?date=${date}&game=${encodeURIComponent(game.id)}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data; })
      .then(data => { setPlayers(data.players); setMessage(data.players.length ? data.notice : 'No roster returned. You can still enter a player prop below.'); })
      .catch(e => { if (e.name !== 'AbortError') setMessage(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [game.id, date]);
  useEffect(() => {
    setHistory(null); setMetric('');
    if (!player) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setHistory(null); setMessage('');
    fetch(`/api/players?date=${date}&game=${encodeURIComponent(game.id)}&player=${player}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data as PlayerHistory; })
      .then(data => { setHistory(data); setMetric(data.metrics.find(m => m.key === 'points')?.key ?? data.metrics[0]?.key ?? ''); setMessage(data.notice); })
      .catch(e => { if (e.name !== 'AbortError') setMessage(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [player, date, game.id]);
  const rows = history?.games.filter(g => g.stats[metric] !== undefined) ?? [];
  const validLine = line.trim() !== '' && Number.isFinite(Number(line));
  const wins = validLine ? rows.filter(g => direction === 'over' ? g.stats[metric] > Number(line) : g.stats[metric] < Number(line)).length : 0;
  const pushes = validLine ? rows.filter(g => g.stats[metric] === Number(line)).length : 0;
  const average = rows.length ? rows.reduce((sum, row) => sum + row.stats[metric], 0) / rows.length : null;
  const max = Math.max(1, ...rows.map(r => r.stats[metric]), validLine ? Number(line) : 0);
  return <section className="player-research">
    <div className="section-title"><div><h3>Player research</h3><p>Recent game logs · ESPN</p></div><span className="tag">HISTORICAL</span></div>
    <div className="form-grid">
      <label>Player<select value={player} disabled={loading && !players.length} onChange={e => { setPlayer(e.target.value); onPlayer(players.find(p => String(p.id) === e.target.value)?.name ?? ''); }}><option value="">Select a player</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Statistic<select value={metric} onChange={e => setMetric(e.target.value)} disabled={!history?.metrics.length}><option value="">Select a statistic</option>{history?.metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
      <label>Prop line<input type="number" step="0.5" value={line} onChange={e => setLine(e.target.value)} placeholder="e.g. 24.5" /></label>
      <label>Direction<select value={direction} onChange={e => setDirection(e.target.value)}><option value="over">Over</option><option value="under">Under</option></select></label>
    </div>
    {loading && <p className="muted" role="status">Loading player data…</p>}
    {!loading && rows.length > 0 && <>
      <div className="stat-strip"><span><strong>{average?.toFixed(1)}</strong> average</span><span><strong>{rows.length}</strong> recorded games</span><span><strong>{validLine ? `${wins}/${rows.length}` : '—'}</strong> cleared line</span>{pushes > 0 && <span>{pushes} push{pushes === 1 ? '' : 'es'}</span>}</div>
      <div className="chart" aria-label="Recent game statistics">{[...rows].reverse().map(row => <div className="bar-column" key={row.id} title={`${row.date.slice(0, 10)}: ${row.stats[metric]}`}><span>{row.stats[metric]}</span><div className={`bar ${validLine && (direction === 'over' ? row.stats[metric] > Number(line) : row.stats[metric] < Number(line)) ? 'hit' : ''}`} style={{ height: `${Math.max(3, row.stats[metric] / max * 80)}px` }} /><small>{row.date.slice(5, 10)}</small></div>)}</div>
    </>}
    {history && !rows.length && !loading && <p>No recorded games for this statistic before the selected matchup.</p>}
    <p className="fine-print" role="status">{message}</p>
  </section>;
}
