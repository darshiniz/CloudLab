const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { boot, createLab, waitStatus, statusOf, waitFor, sleep } = require('./helpers');

let t;
before(async () => { t = await boot({ MAX_QUEUE_LENGTH: '2', MAX_ACTIVE_ENVS_PER_STUDENT: '3' }); });
after(async () => { await t.close(); });

// every test starts with no live labs
beforeEach(async () => {
  const live = await t.ctx.db('environments').whereNotIn('status', ['terminated']).select('id');
  for (const r of live) await t.ctx.envs.terminate(r.id, 'test').catch(() => {});
  await t.ctx.db('policy').update({ max_labs_per_worker: 4 });
  t.ctx.driver.faults.length = 0;
});

const who = (k) => t.as(t.emails[k]);

test('lifecycle: create -> running -> stop -> start -> restart -> delete, with 409 on illegal moves', async () => {
  const s = await who('darshini');
  const r = await createLab(s);
  assert.equal(r.status, 202);
  const id = r.body.data.id;
  await waitStatus(t.ctx, id, 'running');
  let e = (await s.get(`/environments/${id}`)).body.data;
  assert.equal(e.status, 'running');
  assert.ok(e.containerId);
  assert.ok(e.startedAt);
  assert.ok(e.autoStopAt);
  assert.ok(e.provisioning.steps.every((x) => x.state === 'done'));

  assert.equal((await s.post(`/environments/${id}/start`)).status, 409); // already running
  const stop = await s.post(`/environments/${id}/stop`);
  assert.equal(stop.status, 200);
  assert.equal(stop.body.data.status, 'stopped');
  assert.equal(stop.body.data.autoStopAt, null);
  assert.equal((await s.post(`/environments/${id}/stop`)).status, 409); // already stopped
  assert.equal((await s.post(`/environments/${id}/heartbeat`)).status, 409);

  const start = await s.post(`/environments/${id}/start`);
  assert.equal(start.status, 202);
  await waitStatus(t.ctx, id, 'running');

  const restart = await s.post(`/environments/${id}/restart`);
  assert.equal(restart.status, 202);
  await waitStatus(t.ctx, id, 'running');

  const del = await s.delete(`/environments/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.data.status, 'terminated');
  assert.equal((await s.delete(`/environments/${id}`)).status, 409);
  assert.equal((await s.post(`/environments/${id}/start`)).status, 409);
  assert.equal(t.ctx.driver.find(id), undefined, 'container is removed');
});

test('heartbeat is 204 and does not count as activity (BRD BR-11) unless keepRunning is sent', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  await t.ctx.db('environments').where({ id }).update({ last_activity_at: '2026-01-01T00:00:00.000Z' });
  assert.equal((await s.post(`/environments/${id}/heartbeat`)).status, 204);
  assert.equal((await t.ctx.db('environments').where({ id }).first()).last_activity_at, '2026-01-01T00:00:00.000Z');
  assert.equal((await s.post(`/environments/${id}/heartbeat`, { keepRunning: true })).status, 204);
  assert.notEqual((await t.ctx.db('environments').where({ id }).first()).last_activity_at, '2026-01-01T00:00:00.000Z');
});

test('ownership: another student gets 404, faculty can read, owner-only endpoints refuse faculty/admin', async () => {
  const d = await who('darshini');
  const id = (await createLab(d)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const a = await who('anushka');
  assert.equal((await a.get(`/environments/${id}`)).status, 404);
  assert.equal((await a.post(`/environments/${id}/stop`)).status, 404);
  assert.equal((await a.delete(`/environments/${id}`)).status, 404);
  assert.equal((await a.get(`/environments/${id}/access`)).status, 404);
  assert.equal((await (await who('faculty')).get(`/environments/${id}`)).status, 200);
  assert.equal((await (await who('faculty')).post(`/environments/${id}/stop`)).status, 403);
  assert.equal((await (await who('admin')).get(`/environments/${id}`)).status, 200);
  assert.equal((await (await who('admin')).get(`/environments/${id}/access`)).status, 403); // owner-only endpoint: wrong role
  assert.equal((await (await who('admin')).get(`/environments/${id}/metrics`)).status, 200);
  const stopped = await (await who('admin')).post(`/environments/${id}/stop`);
  assert.equal(stopped.status, 200); // admin may act on any lab
  assert.equal(await statusOf(t.ctx, id), 'stopped');
});

test('list: students see only their own; filters and paging work', async () => {
  const d = await who('darshini');
  const a = await who('anushka');
  await waitStatus(t.ctx, (await createLab(d, { name: 'one' })).body.data.id, 'running');
  await waitStatus(t.ctx, (await createLab(a, { name: 'two', labId: 'lab_java' })).body.data.id, 'running');
  const mine = await d.get('/environments');
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.meta.total, 1);
  const all = await (await who('admin')).get('/environments?pageSize=1&page=2');
  assert.equal(all.body.meta.page, 2);
  assert.equal(all.body.meta.pageSize, 1);
  assert.equal(all.body.meta.total, 2);
  assert.equal((await (await who('admin')).get('/environments?labType=java')).body.data.length, 1);
  assert.equal((await (await who('admin')).get('/environments?status=stopped')).body.data.length, 0);
  assert.equal((await (await who('admin')).get('/environments?status=bogus')).status, 422);
  assert.equal((await (await who('faculty')).get('/environments')).body.data.length, 2);
});

test('capacity: slots fill, then queue (FIFO with positions), then 503 CAPACITY_FULL; stopping frees the head of the queue', async () => {
  await t.ctx.db('policy').update({ max_labs_per_worker: 1 }); // 2 workers x 1 slot
  const names = ['darshini', 'anushka', 'riya', 'sneha'];
  const ids = [];
  for (const n of names.slice(0, 2)) ids.push((await createLab(await who(n))).body.data.id);
  await Promise.all(ids.map((id) => waitStatus(t.ctx, id, 'running')));
  const w = new Set(await t.ctx.db('environments').whereIn('id', ids).pluck('worker_id'));
  assert.equal(w.size, 2, 'spread across both workers');

  const q1 = await createLab(await who('riya'));
  assert.equal(q1.status, 202);
  assert.equal(q1.body.data.status, 'queued');
  assert.equal(q1.body.data.queuePosition, 1);
  assert.equal(q1.body.data.workerId, null);
  const q2 = await createLab(await who('sneha'));
  assert.equal(q2.body.data.queuePosition, 2);
  // queue limit is 2 -> next request is refused
  const extra = await createLab(await who('darshini'), { name: 'one too many' });
  assert.equal(extra.status, 503);
  assert.equal(extra.body.error.code, 'CAPACITY_FULL');
  assert.equal(await t.ctx.db('environments').where({ name: 'one too many' }).first(), undefined, 'refused request leaves no record');

  await (await who('darshini')).post(`/environments/${ids[0]}/stop`);
  await waitStatus(t.ctx, q1.body.data.id, 'running');
  const still = (await (await who('sneha')).get(`/environments/${q2.body.data.id}`)).body.data;
  assert.equal(still.status, 'queued');
  assert.equal(still.queuePosition, 1);
});

test('concurrency: 12 simultaneous requests never use more than the slots that exist', async () => {
  await t.ctx.db('policy').update({ max_labs_per_worker: 2 }); // 4 slots
  await t.ctx.db('users').whereNot({ role: 'student' }).select('id'); // no-op, keeps linter quiet
  // 12 requests from 12 different students would need 12 accounts; use the 4 students x 3 labs (the per-student limit)
  const res = await Promise.all(['darshini', 'anushka', 'riya', 'sneha'].flatMap((n) => [0, 1, 2].map(async (i) => createLab(await who(n), { name: `race ${n} ${i}` }))));
  const accepted = res.filter((r) => r.status === 202);
  const refused = res.filter((r) => r.status === 503);
  assert.equal(accepted.length + refused.length, 12);
  assert.equal(accepted.filter((r) => r.body.data.status !== 'queued').length, 4, 'exactly 4 slots handed out');
  assert.equal(accepted.filter((r) => r.body.data.status === 'queued').length, 2, 'queue holds 2');
  assert.equal(refused.length, 6);
  const used = await t.ctx.nodes.slotsUsedMap();
  for (const [, n] of used) assert.ok(n <= 2);
  const positions = accepted.filter((r) => r.body.data.status === 'queued').map((r) => r.body.data.queuePosition).sort();
  assert.deepEqual(positions, [1, 2]);
});

test('per-student limit of active labs is enforced with 409', async () => {
  const s = await who('darshini');
  for (let i = 0; i < 3; i++) assert.equal((await createLab(s, { name: `lab ${i}` })).status, 202);
  const r = await createLab(s, { name: 'fourth' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_STATE');
});

test('provisioning failure is a failed environment (not an HTTP error); Retry goes through /restart', async () => {
  const s = await who('darshini');
  t.ctx.driver.failNext('create', 'boom: secret internals');
  const r = await createLab(s);
  assert.equal(r.status, 202);
  const id = r.body.data.id;
  await waitStatus(t.ctx, id, 'failed');
  const e = (await s.get(`/environments/${id}`)).body.data;
  assert.equal(e.status, 'failed');
  assert.ok(e.failureReason);
  assert.ok(!/secret internals/.test(e.failureReason), 'raw driver errors are not shown to students');
  assert.ok(e.provisioning.steps.some((x) => x.state === 'failed'));
  assert.equal(e.containerId, null);
  assert.equal(await t.ctx.nodes.slotsUsedMap().then((m) => [...m.values()].reduce((a, b) => a + b, 0)), 0, 'a failed lab releases its slot');

  const retry = await s.post(`/environments/${id}/restart`);
  assert.equal(retry.status, 202);
  await waitStatus(t.ctx, id, 'running');
  assert.equal((await s.get(`/environments/${id}`)).body.data.failureReason, null);
});

test('deleting a lab while it is still provisioning cancels it cleanly', async () => {
  t.ctx.driver.delayMs = 150;
  try {
    const s = await who('darshini');
    const id = (await createLab(s)).body.data.id;
    await sleep(60);
    const del = await s.delete(`/environments/${id}`);
    assert.equal(del.status, 200);
    await sleep(700);
    assert.equal(await statusOf(t.ctx, id), 'terminated');
    assert.equal(t.ctx.driver.find(id), undefined, 'no container left behind');
  } finally { t.ctx.driver.delayMs = 0; }
});

test('auto-stop: inactive warning, then stop with an auto-stop log row; slot is freed', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

  await t.ctx.db('environments').where({ id }).update({ last_activity_at: ago(27) }); // 30 min policy, 5 min warning window
  await t.ctx.jobs.autoStop.tick();
  assert.equal(await statusOf(t.ctx, id), 'inactive');
  assert.equal((await s.get(`/environments/${id}`)).body.data.status, 'inactive');
  assert.ok((await s.get(`/environments/${id}`)).body.data.autoStopAt);

  await t.ctx.db('environments').where({ id }).update({ last_activity_at: ago(31) });
  await t.ctx.jobs.autoStop.tick();
  assert.equal(await statusOf(t.ctx, id), 'stopped');
  const log = (await (await who('admin')).get('/admin/policy/auto-stop-log')).body.data;
  assert.equal(log[0].environmentId, id);
  assert.ok(log[0].idleMinutes >= 30);
  assert.deepEqual(Object.keys(log[0]).sort(), ['environmentId', 'idleMinutes', 'labType', 'stoppedAt', 'userName']);
  assert.equal(t.ctx.driver.find(id).running, false);
});

test('auto-stop respects the policy switch, and workspace file changes count as activity', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const old = new Date(Date.now() - 90 * 60_000).toISOString();
  await t.ctx.db('environments').where({ id }).update({ last_activity_at: old });
  await t.ctx.db('policy').update({ auto_stop_enabled: 0 });
  await t.ctx.jobs.autoStop.tick();
  assert.equal(await statusOf(t.ctx, id), 'running');
  await t.ctx.db('policy').update({ auto_stop_enabled: 1 });

  const fs = require('fs');
  const path = require('path');
  const dir = path.join(t.ctx.storage.projectsDir(t.ids.darshini), 'p1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)');
  await t.ctx.jobs.autoStop.tick();
  assert.equal(await statusOf(t.ctx, id), 'running', 'a saved file is activity');
});

test('session time limit (durationMinutes) stops the lab', async () => {
  const s = await who('darshini');
  const id = (await createLab(s, { durationMinutes: 15 })).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  await t.ctx.db('environments').where({ id }).update({ session_expires_at: new Date(Date.now() - 1000).toISOString() });
  await t.ctx.jobs.autoStop.tick();
  assert.equal(await statusOf(t.ctx, id), 'stopped');
});

test('reconciliation: a container that died is marked stopped; an orphan container is removed; OOM is explained', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  t.ctx.driver.killContainer(id);
  await t.ctx.jobs.reconciler.tick();
  assert.equal(await statusOf(t.ctx, id), 'stopped');

  const id2 = (await createLab(s, { name: 'oom lab' })).body.data.id;
  await waitStatus(t.ctx, id2, 'running');
  t.ctx.driver.oomKill(id2);
  await t.ctx.jobs.reconciler.tick();
  assert.equal(await statusOf(t.ctx, id2), 'stopped');
  const ev = await t.ctx.db('env_events').where({ env_id: id2 }).orderBy('seq', 'desc').first();
  assert.match(ev.message, /memory/i);

  // orphan: a container for an environment that no longer exists
  const w = await t.ctx.nodes.get('worker-1');
  await t.ctx.driver.create(w, { envId: 'env_deadbeef00', userId: 'usr_x', name: 'cl-env_deadbeef00', image: 'x', cpu: 1, memoryGb: 1, pidsLimit: 10, hostPort: 20999, containerPort: 8080, bindIp: '127.0.0.1', mounts: [] });
  assert.ok(t.ctx.driver.find('env_deadbeef00'));
  await t.ctx.jobs.reconciler.tick();
  assert.equal(t.ctx.driver.find('env_deadbeef00'), undefined);
});

test('worker offline: nothing is stopped by mistake, and labs are still listed', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const worker = (await t.ctx.db('environments').where({ id }).first()).worker_id;
  t.ctx.driver.setOffline(worker, true);
  await t.ctx.jobs.reconciler.tick();
  await t.ctx.jobs.monitor.tick();
  assert.equal(await statusOf(t.ctx, id), 'running');
  const infra = (await (await who('admin')).get('/admin/infrastructure')).body.data;
  assert.equal(infra.nodes.find((n) => n.id === worker).status, 'offline');
  t.ctx.driver.setOffline(worker, false);
  await t.ctx.jobs.monitor.tick();
  assert.equal((await (await who('admin')).get('/admin/infrastructure')).body.data.nodes.find((n) => n.id === worker).status, 'online');
});

test('metrics, access and dataset mount', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const m = (await s.get(`/environments/${id}/metrics`)).body.data;
  assert.deepEqual(Object.keys(m).sort(), ['cpuPercent', 'diskPercent', 'memoryPercent', 'sampledAt']);
  const acc = (await s.get(`/environments/${id}/access`)).body.data;
  assert.deepEqual(Object.keys(acc).sort(), ['expiresAt', 'terminalUrl', 'workspaceUrl']);
  assert.match(acc.workspaceUrl, new RegExp(`/lab/${id}/`));
  const mount = await s.post(`/environments/${id}/datasets`, { datasetId: 'ds_iris' });
  assert.equal(mount.status, 200);
  assert.deepEqual(mount.body.data, { mountPath: '/data/shared/iris.csv' });
  assert.equal((await s.post(`/environments/${id}/datasets`, { datasetId: 'ds_nope' })).status, 404);
  await s.post(`/environments/${id}/stop`);
  assert.equal((await s.get(`/environments/${id}/access`)).status, 409);
});

test('deactivating a student stops their labs', async () => {
  const s = await who('sneha');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const sneha = await t.ctx.users.byEmail(t.emails.sneha);
  await (await who('admin')).patch(`/admin/users/${sneha.id}`, { status: 'inactive' });
  await waitFor(async () => (await statusOf(t.ctx, id)) === 'stopped', { what: 'lab to stop' });
  await (await who('admin')).patch(`/admin/users/${sneha.id}`, { status: 'active' });
});

test('restart of the API: interrupted provisioning becomes failed, running labs stay running', async () => {
  const s = await who('darshini');
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const stuck = (await createLab(s, { name: 'stuck' })).body.data.id;
  await waitStatus(t.ctx, stuck, 'running');
  await t.ctx.db('environments').where({ id: stuck }).update({ status: 'provisioning' });
  t.ctx.envs.running.delete(stuck);
  await t.ctx.envs.recover();
  assert.equal(await statusOf(t.ctx, stuck), 'failed');
  assert.equal(await statusOf(t.ctx, id), 'running');
});
