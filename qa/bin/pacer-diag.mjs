// Shows how the database pacer books slots and when its waiters wake (run on a Windows runner to see why two
// pacers on one database fired 3 ms apart there). Usage: node qa/bin/pacer-diag.mjs  (from the repository root)
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { DbPacer, MIN_GAP_MS } = await import('../../packages/sources-other/src/http.ts');
const { migrateSourcesOther } = await import('../../packages/sources-other/src/index.ts');
const dir = mkdtempSync(join(tmpdir(), 'jl-pacer-diag-'));
const path = join(dir, 'pace.db');
const a = new DatabaseSync(path); migrateSourcesOther(a);
const b = new DatabaseSync(path); b.exec('PRAGMA busy_timeout = 5000');
console.log('journal a:', a.prepare('PRAGMA journal_mode').get(), 'b:', b.prepare('PRAGMA journal_mode').get(), 'MIN_GAP_MS', MIN_GAP_MS, 'node', process.version, process.platform);
const pa = new DbPacer(a), pb = new DbPacer(b);
const t0 = Date.now();
const rows = () => JSON.stringify(a.prepare('SELECT host, next_at_ms FROM source_host_slots').all().map((r) => ({ ...r, next_at_ms: Number(r.next_at_ms) - t0 })));
const times = await Promise.all([0, 1, 2].map(async (i) => {
  const p = i % 2 ? pb : pa;
  const before = Date.now() - t0;
  await p.wait('feed.example', 0);
  const woke = Date.now() - t0;
  console.log(`waiter ${i} (${i % 2 ? 'b' : 'a'}): started at +${before} ms, woke at +${woke} ms; slots now ${rows()}`);
  return woke;
}));
times.sort((x, y) => x - y);
console.log('gaps:', times.slice(1).map((t, i) => t - times[i]).join(', '), 'ms');
a.close(); b.close();

// ---------------------------------------------------------------------------------------------------------------
// The boards pacer: the same question for packages/boards (the suite that reports "gap 2 ms" on windows-latest).
// Two clients, two SqlitePacer objects on one database, eight requests at once, exactly as
// packages/boards/test/polite.test.ts does it. Every arrival is printed in arrival order with its gap, so a pair
// that did not wait for its slot names itself here instead of only failing an assertion.

/** How coarse Date.now() is on this machine: the smallest change seen over a busy second (Windows is ~15.6 ms). */
function clockStepMs() {
  const seen = new Set();
  const until = Date.now() + 200;
  while (Date.now() < until) seen.add(Date.now());
  const xs = [...seen].sort((x, y) => x - y);
  const steps = xs.slice(1).map((v, i) => v - xs[i]).filter((d) => d > 0 && d < 100);
  return steps.length ? Math.min(...steps) : 0;
}

async function boardsScenario(label, intervalMs, requests) {
  const { SqlitePacer } = await import('../../packages/boards/src/http.ts');
  const { createBoardHttp } = await import('../../packages/boards/src/index.ts');
  const { startMockHosts } = await import('../../packages/boards/scripts/mock-hosts.ts');
  const mock = await startMockHosts({ boards: { 'greenhouse:acme': { name: 'Acme', jobs: 1 } } });
  const dir2 = mkdtempSync(join(tmpdir(), 'jl-diag-boards-'));
  const db = join(dir2, 'p.db');
  const p1 = new SqlitePacer(db, intervalMs), p2 = new SqlitePacer(db, intervalMs);
  const sent = [];
  const a = createBoardHttp({ pacer: p1, hostMap: mock.hostMap, onRequest: (i) => sent.push({ who: 'a', path: i.url.replace(/^https?:\/\/[^/]+/, ''), at: Date.now() }) });
  const b = createBoardHttp({ pacer: p2, hostMap: mock.hostMap, onRequest: (i) => sent.push({ who: 'b', path: i.url.replace(/^https?:\/\/[^/]+/, ''), at: Date.now() }) });
  const url = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true';
  const base = Date.now();
  try {
    await Promise.all([...Array(requests)].flatMap(() => [a.getJson(url), b.getJson(url)]));
    const arrivals = mock.log.filter((e) => e.host === 'boards-api.greenhouse.io');
    console.log(`\n[boards ${label}] interval ${intervalMs} ms, ${requests} requests per client, host arrivals ${arrivals.length}`);
    arrivals.forEach((e, i) => {
      const gap = i ? e.at - arrivals[i - 1].at : 0;
      console.log(`  arrival ${String(i).padStart(2)}: at +${String(e.at - base).padStart(5)} ms  gap ${String(gap).padStart(5)} ms  ${e.method} ${e.path.slice(0, 60)}`);
    });
    const sorted = arrivals.map((e) => e.at).sort((x, y) => x - y);
    const gaps = sorted.slice(1).map((t, i) => t - sorted[i]);
    console.log(`  [boards ${label}] smallest gap ${gaps.length ? Math.min(...gaps) : 0} ms; sent ${sent.length}; robots served from cache ${8 - arrivals.length + (requests - arrivals.length > 0 ? 0 : 0)}`);
    const slots = p1['db'].prepare('SELECT host, next_at, busy_until FROM host_pacing').all();
    console.log(`  [boards ${label}] slots:`, JSON.stringify(slots));
  } finally {
    p1.close(); p2.close(); await mock.close();
  }
}

console.log('\nclock step for Date.now():', clockStepMs(), 'ms');
await boardsScenario('300ms', 300, 4);
await boardsScenario('1000ms', 1000, 1);
