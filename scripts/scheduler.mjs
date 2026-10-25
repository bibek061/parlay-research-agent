import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
const statePath = path.join(process.cwd(), '.data', 'scheduler.json');
let completedDate = '';
try { completedDate = JSON.parse(await readFile(statePath, 'utf8')).date || ''; } catch {}
const token = process.env.RESEARCH_API_TOKEN;
if (!token) { console.error('Set RESEARCH_API_TOKEN in .env.local to run daily research.'); process.exit(1); }
const base = process.env.RESEARCH_URL || 'http://127.0.0.1:3000';
let busy = false, nextAttempt = 0;
async function tick(force = false) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  if (busy || !force && (completedDate === date || Number(part('hour')) < 8 || Date.now() < nextAttempt)) return;
  busy = true;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/research?date=${date}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90000), redirect: 'error' });
    const result = await response.json();
    if (!response.ok) throw Error(`Research endpoint returned HTTP ${response.status}.`);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(`${statePath}.tmp`, JSON.stringify({ date, completedAt: new Date().toISOString() }));
    await rename(`${statePath}.tmp`, statePath);
    completedDate = date;
    console.log(`Daily research ${date}: ${result.status}, ${result.games.length} games. Snapshot saved.`);
  } catch (error) {
    console.error(`Daily research failed: ${error.message} Retrying in five minutes.`);
    nextAttempt = Date.now() + 300000;
    if (force) process.exitCode = 1;
  } finally { busy = false; }
}
if (process.argv.includes('--once')) await tick(true);
else { console.log('Daily research scheduler active: 8 AM America/New_York, with same-day catch-up.'); await tick(); setInterval(() => void tick(), 30000); }
