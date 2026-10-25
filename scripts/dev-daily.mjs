import { spawn } from 'node:child_process';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535.');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: 'inherit', windowsHide: true });
const children = [server];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', code => { stop(); process.exitCode = code ?? 0; });
// Use the exact local port and wait for this application before starting jobs.
let ready = false;
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    ready = response.ok && (await response.json()).app === 'parlay-research-agent';
  } catch {}
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (ready && !stopping) children.push(spawn(process.execPath, ['--env-file-if-exists=.env.local', 'scripts/scheduler.mjs'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, RESEARCH_URL: `http://127.0.0.1:${port}` } }));
else if (!stopping) { console.error('App did not become ready. Scheduler was not started.'); stop(); process.exitCode = 1; }
