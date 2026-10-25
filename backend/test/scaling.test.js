const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { boot, createLab, waitStatus } = require('./helpers');

let t; let admin;
before(async () => {
  t = await boot({ MAX_QUEUE_LENGTH: '5', MOCK_VM_BOOT_MS: '0', SCALE_OUT_AFTER_SEC: '60', SCALE_IN_IDLE_MIN: '10', SCALE_COOLDOWN_SEC: '0' });
  admin = await t.as(t.emails.admin);
});
after(async () => { await t.close(); });

beforeEach(async () => {
  const live = await t.ctx.db('environments').whereNotIn('status', ['terminated']).select('id');
  for (const r of live) await t.ctx.envs.terminate(r.id, 'test').catch(() => {});
  await t.ctx.db('policy').update({ max_labs_per_worker: 1 });
  // both workers on, auto mode off, VMs running
  for (const w of t.cfg.workers) {
    await t.ctx.db('scaling_state').where({ node_id: w.id }).update({ state: 'on' });
    await t.ctx.cloud.startVm(w.vmName);
  }
  await t.ctx.db('scaling_config').update({ auto_enabled: 0 });
  await t.ctx.db('scaling_events').delete();
  await t.ctx.db('alerts').delete();
  t.ctx.cloud.calls.length = 0;
  t.ctx.scaler.lastActionAt = 0;
  t.ctx.scaler.queueSince = null;
  t.ctx.scaler.idleSince.clear();
});

const who = (k) => t.as(t.emails[k]);
const worker = (st, id) => st.workers.find((w) => w.id === id);

test('GET /admin/scaling has the documented shape and is admin-only', async () => {
  const r = await admin.get('/admin/scaling');
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.deepEqual(Object.keys(d).sort(), ['autoEnabled', 'available', 'events', 'provider', 'rules', 'workers']);
  assert.equal(d.provider, 'mock');
  assert.equal(d.workers.length, 2);
  assert.deepEqual(Object.keys(d.workers[0]).sort(), ['id', 'name', 'power', 'since', 'slotsUsed', 'status', 'vmName']);
  assert.equal((await (await who('darshini')).get('/admin/scaling')).status, 403);
  assert.equal((await (await who('darshini')).post('/admin/scaling/workers/worker-2/scale-in')).status, 403);
});

test('manual scale-in: idle worker is deallocated, goes offline without an alarm and adds no capacity', async () => {
  const r = await admin.post('/admin/scaling/workers/worker-2/scale-in');
  assert.equal(r.status, 200);
  assert.equal(worker(r.body.data, 'worker-2').power, 'off');
  assert.deepEqual(t.ctx.cloud.calls, [{ op: 'deallocate', vmName: 'cloudlab-worker-2' }]);
  assert.equal(r.body.data.events[0].action, 'scale_in');
  assert.equal(r.body.data.events[0].source, 'manual');

  await t.ctx.jobs.monitor.tick();
  const infra = (await admin.get('/admin/infrastructure')).body.data;
  const w2 = infra.nodes.find((n) => n.id === 'worker-2');
  assert.equal(w2.status, 'offline');
  assert.equal(w2.power, 'off');
  assert.equal(infra.clusterCapacity.slotsTotal, 1, 'only worker-1 counts');
  assert.equal(await t.ctx.db('alerts').where({ alert_key: 'offline:worker-2' }).whereNull('resolved_at').first(), undefined, 'a deliberate stop raises no alarm');
});

test('scale-in is refused while the worker runs labs, and for the last worker', async () => {
  const id = (await createLab(await who('darshini'))).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const wid = (await t.ctx.db('environments').where({ id }).first()).worker_id;
  const busy = await admin.post(`/admin/scaling/workers/${wid}/scale-in`);
  assert.equal(busy.status, 409);
  assert.match(busy.body.error.message, /still runs 1 lab/);
  assert.equal(t.ctx.cloud.calls.length, 0, 'the cloud is never asked');

  const other = wid === 'worker-1' ? 'worker-2' : 'worker-1';
  assert.equal((await admin.post(`/admin/scaling/workers/${other}/scale-in`)).status, 200);
  await t.ctx.envs.terminate(id, 'test');
  const last = await admin.post(`/admin/scaling/workers/${wid}/scale-in`);
  assert.equal(last.status, 409);
  assert.match(last.body.error.message, /At least one worker/);
});

test('labs are never placed on a stopped worker: they queue instead', async () => {
  await admin.post('/admin/scaling/workers/worker-2/scale-in');
  const a = await createLab(await who('darshini'));
  const b = await createLab(await who('anushka'));
  assert.equal(a.body.data.status !== 'queued', true);
  assert.equal(b.body.data.status, 'queued', 'worker-1 is full and worker-2 is off');
  await waitStatus(t.ctx, a.body.data.id, 'running');
  assert.equal((await t.ctx.db('environments').where({ id: a.body.data.id }).first()).worker_id, 'worker-1');
});

test('manual scale-out starts a stopped worker, the monitor brings it online and the queue drains onto it', async () => {
  await admin.post('/admin/scaling/workers/worker-2/scale-in');
  const a = await createLab(await who('darshini'));
  const b = await createLab(await who('anushka'));
  await waitStatus(t.ctx, a.body.data.id, 'running');
  assert.equal(b.body.data.status, 'queued');

  const out = await admin.post('/admin/scaling/workers/worker-2/scale-out');
  assert.equal(out.status, 200);
  assert.equal(worker(out.body.data, 'worker-2').power, 'starting');
  assert.ok(t.ctx.cloud.calls.some((c) => c.op === 'start' && c.vmName === 'cloudlab-worker-2'));
  assert.equal((await admin.post('/admin/scaling/workers/worker-2/scale-out')).status, 409, 'already starting');

  await t.ctx.jobs.monitor.tick(); // the worker answers -> online
  assert.equal(await t.ctx.scaler.powerOf('worker-2'), 'on');
  await waitStatus(t.ctx, b.body.data.id, 'running');
  assert.equal((await t.ctx.db('environments').where({ id: b.body.data.id }).first()).worker_id, 'worker-2');
});

test('auto scale-out: waits for SCALE_OUT_AFTER_SEC of queueing, then starts a stopped worker once', async () => {
  await admin.post('/admin/scaling/workers/worker-2/scale-in');
  t.ctx.cloud.calls.length = 0;
  await admin.put('/admin/scaling', { autoEnabled: true });
  const a = await createLab(await who('darshini'));
  const b = await createLab(await who('anushka'));
  await waitStatus(t.ctx, a.body.data.id, 'running');
  assert.equal(b.body.data.status, 'queued');

  const T0 = Date.now();
  await t.ctx.scaler.tick(T0);
  await t.ctx.scaler.tick(T0 + 30_000);
  assert.equal(t.ctx.cloud.calls.length, 0, 'not yet: the queue is younger than 60 s');
  await t.ctx.scaler.tick(T0 + 61_000);
  assert.deepEqual(t.ctx.cloud.calls, [{ op: 'start', vmName: 'cloudlab-worker-2' }]);
  await t.ctx.scaler.tick(T0 + 70_000);
  assert.equal(t.ctx.cloud.calls.length, 1, 'no second start while one is in progress');

  await t.ctx.jobs.monitor.tick();
  await waitStatus(t.ctx, b.body.data.id, 'running');
  const st = (await admin.get('/admin/scaling')).body.data;
  assert.ok(st.events.some((e) => e.source === 'auto' && e.action === 'scale_out' && /waited in the queue/.test(e.reason)));
});

test('auto scale-in: an idle worker is stopped after SCALE_IN_IDLE_MIN, the last one never is', async () => {
  await admin.put('/admin/scaling', { autoEnabled: true });
  const T0 = Date.now();
  await t.ctx.scaler.tick(T0);
  await t.ctx.scaler.tick(T0 + 5 * 60_000);
  assert.equal(t.ctx.cloud.calls.length, 0, 'only 5 minutes idle');
  await t.ctx.scaler.tick(T0 + 11 * 60_000);
  assert.deepEqual(t.ctx.cloud.calls, [{ op: 'deallocate', vmName: 'cloudlab-worker-2' }], 'the highest-numbered worker goes first');
  await t.ctx.scaler.tick(T0 + 60 * 60_000);
  await t.ctx.scaler.tick(T0 + 120 * 60_000);
  assert.equal(t.ctx.cloud.calls.length, 1, 'worker-1 stays on (MIN_WORKERS=1)');
  assert.equal(await t.ctx.scaler.powerOf('worker-1'), 'on');
});

test('auto scale-in does not touch a worker that has a lab, and waits while labs are queued', async () => {
  await admin.put('/admin/scaling', { autoEnabled: true });
  const id = (await createLab(await who('darshini'))).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const busyWorker = (await t.ctx.db('environments').where({ id }).first()).worker_id;
  const T0 = Date.now();
  await t.ctx.scaler.tick(T0);
  await t.ctx.scaler.tick(T0 + 30 * 60_000);
  const stopped = t.ctx.cloud.calls.filter((c) => c.op === 'deallocate').map((c) => c.vmName);
  assert.ok(!stopped.includes(`cloudlab-${busyWorker}`), 'the busy worker keeps running');
});

test('auto mode off: the autoscaler does nothing', async () => {
  const T0 = Date.now();
  await t.ctx.scaler.tick(T0);
  await t.ctx.scaler.tick(T0 + 3 * 3600_000);
  assert.equal(t.ctx.cloud.calls.length, 0);
});

test('a refused cloud call leaves the worker in its previous state and is logged', async () => {
  await admin.post('/admin/scaling/workers/worker-2/scale-in');
  t.ctx.cloud.failNext = 'quota exceeded';
  const r = await admin.post('/admin/scaling/workers/worker-2/scale-out');
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /quota exceeded/);
  assert.equal(await t.ctx.scaler.powerOf('worker-2'), 'off');
  const ev = (await admin.get('/admin/scaling')).body.data.events[0];
  assert.equal(ev.ok, false);

  assert.equal((await admin.post('/admin/scaling/workers/worker-2/scale-out')).status, 200); // both on again
  await t.ctx.jobs.monitor.tick();
  t.ctx.cloud.failNext = 'denied';
  assert.equal((await admin.post('/admin/scaling/workers/worker-1/scale-in')).status, 409);
  assert.equal(await t.ctx.scaler.powerOf('worker-1'), 'on', 'rolled back');
});

test('validation and unknown workers', async () => {
  assert.equal((await admin.put('/admin/scaling', { autoEnabled: 'yes' })).status, 422);
  assert.equal((await admin.post('/admin/scaling/workers/worker-9/scale-in')).status, 404);
  const r = await admin.put('/admin/scaling', { autoEnabled: true });
  assert.equal(r.body.data.autoEnabled, true);
});
