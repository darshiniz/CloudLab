#!/usr/bin/env node
/**
 * BRD section 13.4 "Resource Limit Validation": tests T-01 to T-05, run against the REAL system.
 *
 * Run on the CONTROL VM, as the user that can ssh to the workers (the `cloudlab` service user), e.g.
 *   sudo -u cloudlab STUDENT_PASSWORD='...' node ~/cloudlab/infra/tests/resource-tests.js
 * (see docs/RESOURCE_TESTS.md for the full walk-through). It creates labs as three student accounts, measures them with
 * `docker stats` / `docker exec` on the workers, deletes everything it created, and writes
 * infra/tests/results/resource-tests-<date>.md with measured values and PASS / FAIL.
 *
 * Settings (environment variables):
 *   STUDENT_PASSWORD   password shared by the test students (required; never printed)
 *   STUDENTS           comma-separated student emails (default darshini@gbs.edu,simba@gbs.edu,anushka@gbs.edu)
 *   API                default http://127.0.0.1:5000/api/v1
 *   SIZE               lab size used for the tests: small (1 GB) or standard (2 GB). default small
 *   DURATION_MIN       T-03 load duration in minutes (BRD: 30). Use 3 for a rehearsal. default 30
 *   ONLY               e.g. ONLY=T-01,T-04 to run some tests
 *   DRY_RUN=1          call the API but fake every Docker measurement (for rehearsing against a laptop/mock server)
 *   WORKER_n_DOCKER_HOST  read from /etc/cloudlab/api.env when not set
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const API = process.env.API || 'http://127.0.0.1:5000/api/v1';
const PASSWORD = process.env.STUDENT_PASSWORD;
const STUDENTS = (process.env.STUDENTS || 'darshini@gbs.edu,simba@gbs.edu,anushka@gbs.edu').split(',').map((s) => s.trim());
const SIZE = process.env.SIZE || 'small';
const DURATION_MIN = Number(process.env.DURATION_MIN ?? 30);
const DRY = process.env.DRY_RUN === '1';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT_MB = SIZE === 'standard' ? 2048 : 1024;
const IDLE_LIMIT_MB = 600; // BRD T-01 pass criterion

if (!PASSWORD) { console.error('Set STUDENT_PASSWORD (the password of the test student accounts).'); process.exit(2); }

// ---- helpers ---------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB'), ...a);

function readEnvFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(process.env.ENV_FILE || '/etc/cloudlab/api.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* not readable: fall back to the environment */ }
  return out;
}
const fileEnv = readEnvFile();
const dockerHostOf = (workerId) => {
  const n = workerId.replace('worker-', '');
  return process.env[`WORKER_${n}_DOCKER_HOST`] || fileEnv[`WORKER_${n}_DOCKER_HOST`] || '';
};

function run(cmd, args, { timeout = 600_000, input } = {}) {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
    if (input) p.stdin.end(input);
  });
}
/** docker on a given worker (over ssh, exactly like the API does) */
function docker(workerId, args, opts) {
  if (DRY) return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  const host = dockerHostOf(workerId);
  return run('docker', host ? ['-H', host, ...args] : args, opts);
}

async function api(token, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, body: json };
}

const sessions = new Map();
async function login(email) {
  if (sessions.has(email)) return sessions.get(email);
  const r = await api(null, 'POST', '/auth/login', { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: HTTP ${r.status} ${r.body?.error?.message || ''}`);
  sessions.set(email, r.body.data.token);
  return r.body.data.token;
}

const created = []; // { token, id }
let seq = 0;
async function createLab(student, labId, label) {
  const token = await login(student);
  const t0 = Date.now();
  const r = await api(token, 'POST', '/environments', { labId, name: `rt-${label}-${++seq}`, size: SIZE, durationMinutes: 240 });
  if (r.status !== 202) throw new Error(`create ${label} for ${student}: HTTP ${r.status} ${r.body?.error?.message || ''}`);
  const env = r.body.data;
  created.push({ token, id: env.id });
  return { id: env.id, token, t0 };
}
async function waitRunning(lab, timeoutMs = 180_000) {
  for (;;) {
    const r = await api(lab.token, 'GET', `/environments/${lab.id}`);
    const e = r.body?.data;
    if (e && (e.status === 'running' || e.status === 'inactive')) { lab.workerId = e.workerId; lab.container = `cl-${e.id}`; lab.seconds = (Date.now() - lab.t0) / 1000; return lab; }
    if (e && ['failed', 'stopped', 'terminated'].includes(e.status)) throw new Error(`lab ${lab.id} ended as ${e.status}: ${e.failureReason || ''}`);
    if (Date.now() - lab.t0 > timeoutMs) throw new Error(`lab ${lab.id} not running after ${timeoutMs / 1000}s (status ${e?.status})`);
    await sleep(500);
  }
}
const statusOf = async (lab) => (await api(lab.token, 'GET', `/environments/${lab.id}`)).body?.data;
async function cleanup() {
  for (const lab of created.splice(0)) {
    await api(lab.token, 'POST', `/environments/${lab.id}/stop`).catch(() => {});
    await api(lab.token, 'DELETE', `/environments/${lab.id}`).catch(() => {});
  }
}

/** Memory used by a container, in MB, from `docker stats`. */
async function memMb(lab) {
  if (DRY) return 250 + Math.round(Math.random() * 50);
  const r = await docker(lab.workerId, ['stats', '--no-stream', '--format', '{{.MemUsage}}', lab.container]);
  const m = r.stdout.match(/([\d.]+)\s*([KMG]i?B)/i);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  return u.startsWith('G') ? v * 1024 : u.startsWith('K') ? v / 1024 : v;
}
const oomKilled = async (lab) => {
  if (DRY) return false;
  const r = await docker(lab.workerId, ['inspect', '-f', '{{.State.OOMKilled}}', lab.container]);
  return r.stdout.trim() === 'true';
};
async function execIn(lab, script, opts) {
  if (DRY) { await sleep(200); return { code: 0, stdout: '', stderr: '' }; }
  return docker(lab.workerId, ['exec', lab.container, 'sh', '-c', script], opts);
}
/** Run `script` in the container while sampling memory every 2 s; returns { code, peakMb, seconds }. */
async function execWithPeak(lab, script, opts) {
  let peak = 0; let stop = false;
  const sampler = (async () => { while (!stop) { const m = await memMb(lab); if (m > peak) peak = m; await sleep(1500); } })();
  const t0 = Date.now();
  const r = await execIn(lab, script, opts);
  stop = true; await sampler;
  return { code: r.code, peakMb: Math.round(peak), seconds: (Date.now() - t0) / 1000, stderr: r.stderr };
}
async function hostAvailMb(workerId) {
  if (DRY) return 900;
  const r = await docker(workerId, ['run', '--rm', '--pid=host', 'busybox', 'sh', '-c', "grep MemAvailable /proc/meminfo | tr -s ' ' | cut -d' ' -f2"]);
  const kb = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(kb) ? Math.round(kb / 1024) : NaN;
}

// ---- workloads (run inside the lab containers) --------------------------------------------------------------------
const WORK = {
  python: `python3 - <<'PY'
import numpy as np, pandas as pd, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
df = pd.DataFrame(np.random.rand(1500000, 5), columns=list('abcde'))
df['f'] = df.a * df.b + df.c
print(df.groupby(pd.cut(df.a, 20), observed=True).f.mean().head(3))
df.sample(5000).plot(); plt.savefig('/tmp/rt.png')
PY`,
  web: `set -e; rm -rf /tmp/rtweb; mkdir /tmp/rtweb; cd /tmp/rtweb; npm init -y >/dev/null; npm install express >/dev/null 2>&1
node -e "const s=require('express')().listen(3456); setTimeout(()=>s.close(),4000)"`,
  java: `set -e; rm -rf /tmp/rtjava; mkdir -p /tmp/rtjava/src/main/java; cd /tmp/rtjava
cat > pom.xml <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>rt</groupId><artifactId>rt</artifactId><version>1</version>
<properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties></project>
XML
echo 'public class A { public static void main(String[] a){ System.out.println("ok"); } }' > src/main/java/A.java
MAVEN_OPTS=-Xmx512m mvn -q -B -Dmaven.repo.local=/tmp/rtm2 package`,
};
// CPU + memory loads for T-03 (each takes a few seconds when the lab has the CPU to itself)
const LOAD = {
  python: `python3 -c "
b = bytearray(250*1024*1024)
s = 0
for i in range(12000000): s += i*i
"`,
  web: `node -e "
const b = Buffer.alloc(150*1024*1024); let s = 0;
for (let i = 0; i < 400000000; i++) s += i % 7;
"`,
  java: `mkdir -p /tmp/rtload && cd /tmp/rtload && cat > L.java <<'J'
public class L { public static void main(String[] a){ byte[] b = new byte[200*1024*1024]; long s=0; for (long i=0;i<900000000L;i++) s+=i%7; System.out.println(s+b.length); } }
J
javac L.java && java -Xmx512m L >/dev/null`,
};
const LABS = { python: 'lab_python', web: 'lab_web', java: 'lab_java' };

// ---- the tests ---------------------------------------------------------------------------------------------------
const results = [];
const record = (id, what, criterion, measured, pass, notes = '') => {
  results.push({ id, what, criterion, measured, result: pass === null ? 'INCONCLUSIVE' : pass ? 'PASS' : 'FAIL', notes });
  log(`${id}: ${pass === null ? 'INCONCLUSIVE' : pass ? 'PASS' : 'FAIL'}  ${measured}`);
};
const want = (id) => !ONLY.length || ONLY.includes(id);

async function t01() {
  const rows = [];
  for (const kind of ['python', 'web', 'java']) {
    const lab = await waitRunning(await createLab(STUDENTS[0], LABS[kind], `t01-${kind}`));
    await sleep(DRY ? 100 : 45_000); // let the IDE settle
    const samples = [];
    for (let i = 0; i < 3; i++) { samples.push(await memMb(lab)); await sleep(DRY ? 50 : 3000); }
    rows.push({ kind, mb: Math.round(Math.max(...samples)) });
    await cleanup();
  }
  const bad = rows.filter((r) => !(r.mb <= IDLE_LIMIT_MB));
  record('T-01', 'Idle memory of each template (IDE server running)', `<= ${IDLE_LIMIT_MB} MB`,
    rows.map((r) => `${r.kind} ${r.mb} MB`).join(', '), bad.length === 0,
    'Measured after the IDE finished starting, without a browser tab attached (a tab adds some memory in the extension host).');
  return bad.length === 0;
}

async function t02() {
  const rows = [];
  for (const kind of ['python', 'web', 'java']) {
    const lab = await waitRunning(await createLab(STUDENTS[0], LABS[kind], `t02-${kind}`));
    const r = await execWithPeak(lab, WORK[kind], { timeout: 900_000 });
    const oom = await oomKilled(lab);
    const ok = r.code === 0 && !oom;
    rows.push({ kind, ok, ...r, oom });
    if (!ok) log(`   ${kind} task failed (exit ${r.code}, oom ${oom}) ${r.stderr.slice(-200).replace(/\s+/g, ' ')}`);
    await cleanup();
  }
  record('T-02', 'Peak memory under a real task (pandas+matplotlib / npm install + server / Maven build with 512 MB heap)',
    'No out-of-memory kill and the task completes',
    rows.map((r) => `${r.kind}: ${r.ok ? 'completed' : `FAILED (exit ${r.code}${r.oom ? ', OOM killed' : ''})`}, peak ${r.peakMb} MB in ${r.seconds.toFixed(0)} s`).join('; '),
    rows.every((r) => r.ok), `Lab limit used: ${LIMIT_MB} MB (${SIZE}). Peak is sampled every 1.5 s, so a very short spike can be missed.`);
}

async function t03() {
  const mix = ['python', 'web', 'java', 'java'];
  const labs = [];
  for (let i = 0; i < mix.length; i++) labs.push(await createLab(STUDENTS[i % STUDENTS.length], LABS[mix[i]], `t03-${mix[i]}${i}`));
  await Promise.all(labs.map((l) => waitRunning(l)));
  labs.forEach((l, i) => { l.kind = mix[i]; });
  const workers = new Set(labs.map((l) => l.workerId));
  if (workers.size > 1) {
    record('T-03', '4 concurrent labs (1 Python, 1 Web, 2 Java) under load', 'see BRD', `labs were spread over ${[...workers].join(' and ')}`, null,
      'The test needs all 4 labs on ONE worker. In Admin > Infrastructure press "Scale in" on the other worker (or stop it), then run ONLY=T-03 again.');
    await cleanup();
    return;
  }
  const workerId = labs[0].workerId;
  // baseline: each workload alone, one at a time
  const base = {};
  for (const kind of ['python', 'web', 'java']) {
    const l = labs.find((x) => x.kind === kind);
    const t0 = Date.now(); await execIn(l, LOAD[kind], { timeout: 600_000 }); base[kind] = (Date.now() - t0) / 1000;
  }
  log(`   baseline (alone): ${Object.entries(base).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(', ')}`);

  const endAt = Date.now() + DURATION_MIN * 60_000;
  const times = labs.map(() => []);
  let minAvail = Infinity; let stop = false;
  const memWatch = (async () => { while (!stop) { const a = await hostAvailMb(workerId); if (a < minAvail) minAvail = a; await sleep(DRY ? 100 : 15_000); } })();
  await Promise.all(labs.map(async (l, i) => {
    do {
      const t0 = Date.now();
      const r = await execIn(l, LOAD[l.kind], { timeout: 900_000 });
      times[i].push({ s: (Date.now() - t0) / 1000, code: r.code });
    } while (Date.now() < endAt);
  }));
  stop = true; await memWatch;

  const statuses = await Promise.all(labs.map(statusOf));
  const stopped = statuses.filter((s) => !['running', 'inactive'].includes(s?.status));
  const ratios = labs.map((l, i) => {
    const ok = times[i].filter((t) => t.code === 0);
    const avg = ok.reduce((a, t) => a + t.s, 0) / Math.max(1, ok.length);
    return { kind: l.kind, avg, ratio: avg / base[l.kind], failedRuns: times[i].length - ok.length };
  });
  const worst = Math.max(...ratios.map((r) => r.ratio));
  const memOk = minAvail >= 300; const cpuOk = worst <= 3; const aliveOk = stopped.length === 0 && ratios.every((r) => r.failedRuns === 0);
  record('T-03', `4 concurrent labs (1 Python, 1 Web, 2 Java) under load for ${DURATION_MIN} minutes`,
    'No lab stopped; >= 300 MB worker memory free; each task <= 3x as long as alone',
    `labs stopped: ${stopped.length}; lowest free worker memory: ${Math.round(minAvail)} MB; slowdown ${ratios.map((r) => `${r.kind} ${r.ratio.toFixed(1)}x`).join(', ')}`,
    memOk && cpuOk && aliveOk,
    `memory part: ${memOk && aliveOk ? 'pass' : 'FAIL'}; CPU slowdown part: ${cpuOk ? 'pass' : 'FAIL'} (decides which decision-rule line applies).`);
  results.at(-1).parts = { memory: memOk && aliveOk, cpu: cpuOk };
  await cleanup();
}

async function t04() {
  const mix = ['python', 'java', 'web', 'python'];
  const t0 = Date.now();
  const labs = await Promise.all(mix.map((k, i) => createLab(STUDENTS[i % STUDENTS.length], LABS[k], `t04-${k}${i}`)));
  const done = await Promise.allSettled(labs.map((l) => waitRunning(l, 120_000)));
  const secs = labs.map((l, i) => (done[i].status === 'fulfilled' ? l.seconds : NaN));
  const queued = secs.filter(Number.isNaN).length;
  record('T-04', '4 simultaneous Create Lab requests', 'Each lab Running within 30 seconds',
    `time to Running: ${secs.map((s) => (Number.isNaN(s) ? 'not running' : `${s.toFixed(1)} s`)).join(', ')} (all four sent within ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    secs.every((s) => s <= 30), queued ? 'Some labs did not start: check free slots and that the images are pulled on both workers.' : 'Needs the lab images already pulled on the workers (otherwise the first start includes the download).');
  await cleanup();
}

async function t05() {
  const labs = [];
  for (let i = 0; i < 4; i++) labs.push(await createLab(STUDENTS[i % STUDENTS.length], LABS.python, `t05-${i}`));
  await Promise.all(labs.map((l) => waitRunning(l)));
  const victim = labs[0]; const others = labs.slice(1);
  const mb = Math.round(LIMIT_MB * 1.5);

  // A: a student program allocates more than the limit. The kernel kills the biggest process in the container (the program).
  const a = await execIn(victim, `python3 -c "b = bytearray(${mb}*1024*1024); print(len(b))"`, { timeout: 120_000 });
  const aKilled = a.code === 137 || a.code === 1 || DRY;
  const aSt = await statusOf(victim);
  const aNote = `A) program allocating ${mb} MB: exit code ${a.code} (limit ${LIMIT_MB} MB), lab status afterwards ${aSt.status}`;

  // B: the IDE process itself runs out of memory (made the OOM victim on purpose), so the container dies and the platform must notice.
  const b = await execIn(victim, `P=$(pgrep -u $(id -u) -f 'code-server' | head -n1); echo 1000 > /proc/$P/oom_score_adj; python3 -c "b = bytearray(${mb}*1024*1024)"`, { timeout: 120_000 });
  void b;
  let stopped = null; const until = Date.now() + 150_000;
  while (Date.now() < until) {
    const s = await statusOf(victim);
    if (s?.status === 'stopped') { stopped = s; break; }
    await sleep(3000);
    if (DRY) break;
  }
  const oom = await oomKilled(victim);
  const others2 = await Promise.all(others.map(statusOf));
  const othersOk = others2.every((s) => ['running', 'inactive'].includes(s?.status));
  const reasonOk = DRY ? true : stopped?.stopReason === 'memory_limit';
  const pass = (DRY || (!!stopped && reasonOk && oom)) && othersOk;
  record('T-05', 'A lab allocating more memory than its limit', 'Only that container stops, the other 3 keep running, status Stopped with reason Memory Limit',
    `B) container status ${stopped ? stopped.status : 'did not stop'}, stop reason ${stopped?.stopReason ?? 'none'}, Docker OOMKilled=${oom}; other 3 labs: ${others2.map((s) => s?.status).join('/')}`,
    pass, `${aNote}. ${aSt.status === 'running' || aSt.status === 'inactive' ? 'In A the limit was enforced: only the program was killed and the lab stayed up.' : 'In A the whole lab stopped.'} B forces the IDE process to be the victim, to show what the platform does when the container itself is killed.`);
  void aKilled;
  await cleanup();
}

// ---- main --------------------------------------------------------------------------------------------------------
function decision() {
  const get = (id) => results.find((r) => r.id === id);
  const ids = ['T-01', 'T-02', 'T-03', 'T-04', 'T-05'];
  if (ids.some((id) => !get(id))) return 'Not all tests were run, so no decision yet.';
  if (ids.some((id) => get(id).result === 'INCONCLUSIVE')) return 'At least one test was inconclusive. Re-run it before deciding.';
  const t3 = get('T-03');
  const memFail = ['T-01', 'T-02'].some((id) => get(id).result === 'FAIL') || t3.parts?.memory === false;
  const cpuOnly = !memFail && t3.parts?.cpu === false;
  if (memFail) return 'MEMORY FAILURE: per the BRD decision rule, change the limits to 1 GB per lab and 3 labs per worker.';
  if (cpuOnly) return 'CPU-ONLY FAILURE: per the BRD decision rule, drop the cap to 3 labs per worker and keep the memory limit.';
  const other = ['T-04', 'T-05'].filter((id) => get(id).result === 'FAIL');
  return other.length ? `${other.join(' and ')} failed: see the notes; the T-01 to T-03 limits stand.` : 'ALL TESTS PASS: the memory limit and 4 labs per worker are final.';
}

function writeReport() {
  const dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = path.join(dir, `resource-tests-${stamp}${DRY ? '-DRYRUN' : ''}.md`);
  const esc = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
  const md = [
    `# Resource limit validation (BRD 13.4)${DRY ? '  (DRY RUN: Docker numbers are fake)' : ''}`, '',
    `Run: ${new Date().toISOString()}  |  lab size: ${SIZE} (${LIMIT_MB} MB limit)  |  T-03 duration: ${DURATION_MIN} min  |  API: ${API}`, '',
    '| Test | What was tested | Pass criterion | Measured | Result |', '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${esc(r.what)} | ${esc(r.criterion)} | ${esc(r.measured)} | **${r.result}** |`), '',
    '## Notes', ...results.map((r) => `- ${r.id}: ${esc(r.notes)}`), '',
    '## Decision (BRD 13.4 decision rule)', decision(), '',
  ].join('\n');
  fs.writeFileSync(file, md);
  return { file, md };
}

(async () => {
  log(`Resource tests against ${API}. size=${SIZE}, students=${STUDENTS.length}${DRY ? ', DRY RUN' : ''}`);
  const steps = [['T-01', t01], ['T-02', t02], ['T-03', t03], ['T-04', t04], ['T-05', t05]];
  try {
    for (const [id, fn] of steps) {
      if (!want(id)) continue;
      log(`--- ${id} ---`);
      try { await fn(); } catch (e) { record(id, 'test could not complete', '-', e.message, false, 'The test itself errored, which is different from the limit being wrong.'); await cleanup(); }
    }
  } finally { await cleanup(); }
  const { file, md } = writeReport();
  console.log('\n' + md);
  console.log(`\nSaved: ${file}`);
  process.exit(results.some((r) => r.result === 'FAIL') ? 1 : 0);
})();
