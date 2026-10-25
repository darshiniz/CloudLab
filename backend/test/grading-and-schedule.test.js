const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

let t;
test.before(async () => { t = await boot({ MOCK_VM_BOOT_MS: '0' }); });
test.after(async () => { await t.close(); });

const base = { title: 'Graded task', description: 'Do it', labId: 'lab_python', dueDate: '2099-01-01T10:00:00Z', assignTo: { type: 'class', studentIds: [] } };

test('marks and feedback: faculty grade a submission, the student sees it, validation holds', async () => {
  const f = await t.as(t.emails.faculty);
  const d = await t.as(t.emails.darshini);
  const a = await t.as(t.emails.anushka);
  const act = (await f.post('/faculty/activities', { ...base, maxMarks: 20 })).body.data;
  assert.equal(act.maxMarks, 20);
  const dflt = (await f.post('/faculty/activities', { ...base, title: 'Default max' })).body.data;
  assert.equal(dflt.maxMarks, 100);

  const grade = (sid, body) => f.put(`/faculty/activities/${act.id}/submissions/${sid}/grade`, body);
  assert.equal((await grade(t.ids.darshini, { marks: 15 })).status, 404, 'cannot grade before the student submits');

  await d.post(`/assignments/${act.id}/submit`, { note: 'done' });
  assert.equal((await grade(t.ids.darshini, { marks: 21 })).status, 422, 'above the maximum');
  assert.equal((await grade(t.ids.darshini, { marks: -1 })).status, 422);
  assert.equal((await grade(t.ids.darshini, { feedback: 'no marks' })).status, 422);

  const g = await grade(t.ids.darshini, { marks: 17.5, feedback: 'Good use of loops.' });
  assert.equal(g.status, 200);
  assert.equal(g.body.data.marks, 17.5);
  assert.equal(g.body.data.maxMarks, 20);
  assert.ok(g.body.data.gradedAt);

  const mine = (await d.get('/assignments')).body.data.find((x) => x.id === act.id);
  assert.equal(mine.submission.marks, 17.5);
  assert.equal(mine.submission.feedback, 'Good use of loops.');
  assert.equal(mine.maxMarks, 20);
  const other = (await a.get('/assignments')).body.data.find((x) => x.id === act.id);
  assert.equal(other.submission, null, 'another student sees no marks');

  // regrading replaces the grade (a graded submission is locked for the student; see the rules test in assignments.test.js)
  await grade(t.ids.darshini, { marks: 18 });
  await d.post(`/assignments/${act.id}/submit`, { note: 'updated' });
  const rows = (await f.get(`/faculty/activities/${act.id}/submissions`)).body.data;
  assert.equal(rows.find((x) => x.studentId === t.ids.darshini).marks, 18);

  // only the owner may grade; students never can
  const other2 = await t.as(t.emails.admin);
  assert.equal((await d.put(`/faculty/activities/${act.id}/submissions/${t.ids.darshini}/grade`, { marks: 20 })).status, 403);
  assert.equal(other2.token.length > 10, true);
});

test('Data Science lab is available (no longer "coming soon")', async () => {
  const d = await t.as(t.emails.darshini);
  const labs = (await d.get('/labs')).body.data;
  const ds = labs.find((l) => l.type === 'datascience');
  assert.ok(ds);
  assert.equal(ds.comingSoon, false);
  const r = await d.post('/environments', { labId: ds.id, name: 'ds lab', size: 'small', durationMinutes: 30 });
  assert.equal(r.status, 202);
});

test('power sync follows VMs started or stopped outside the app (daily schedule)', async () => {
  const { scaler, cloud, db } = t.ctx;
  const w = t.cfg.workers[1];
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  // 17:00: Azure deallocates the VM; the app still thinks it is on
  await db('scaling_state').where({ node_id: w.id }).update({ state: 'on', changed_at: old });
  await cloud.deallocateVm(w.vmName);
  await scaler.syncPower();
  assert.equal(await scaler.powerOf(w.id), 'off');
  // 08:50: Azure starts it; the app thinks it is off
  await db('scaling_state').where({ node_id: w.id }).update({ changed_at: old });
  await cloud.startVm(w.vmName);
  await scaler.syncPower();
  assert.equal(await scaler.powerOf(w.id), 'starting');
  const ev = await db('scaling_events').where({ source: 'schedule' }).orderBy('seq');
  assert.deepEqual(ev.map((e) => e.action), ['scale_in', 'scale_out']);
  // a worker that changed state a moment ago is left alone (Azure reports stale power state for a while)
  await db('scaling_state').where({ node_id: w.id }).update({ state: 'on', changed_at: new Date().toISOString() });
  await cloud.deallocateVm(w.vmName);
  await scaler.syncPower();
  assert.equal(await scaler.powerOf(w.id), 'on');
  await cloud.startVm(w.vmName);
});

test('scheduled stop (16:55 IST) stops labs started before it and spares later ones', async () => {
  const s = await boot({ SCHEDULED_STOP_ENABLED: 'true', SCHEDULED_STOP_TIME: '16:55', SCHEDULED_STOP_UTC_OFFSET_MIN: '330' });
  try {
    const { AutoStop } = require('../src/jobs/autostop');
    const a = new AutoStop(s.ctx);
    const stopAt = a.scheduledStopMs(Date.parse('2026-11-02T08:00:00Z')); // 13:30 IST that day
    assert.equal(new Date(stopAt).toISOString(), '2026-11-02T11:25:00.000Z'); // 16:55 IST

    // end to end: one lab began before 16:55, one after; at 16:56 only the first is stopped, with reason "scheduled"
    const { createLab, waitStatus } = require('./helpers');
    const c = await s.as(s.emails.darshini);
    const early = (await createLab(c, { name: 'early lab' })).body.data.id;
    const late = (await createLab(c, { name: 'late lab' })).body.data.id;
    await waitStatus(s.ctx, early, 'running'); await waitStatus(s.ctx, late, 'running');
    const day = a.scheduledStopMs(Date.now());
    // the test may run at any hour: make sure the 4-hour session limit cannot expire these labs before 16:55 does
    await s.ctx.db('environments').whereIn('id', [early, late]).update({ session_expires_at: new Date(day + 86_400_000).toISOString() });
    await s.ctx.db('environments').where({ id: early }).update({ started_at: new Date(day - 3600_000).toISOString(), last_activity_at: new Date(day + 60_000).toISOString() });
    await s.ctx.db('environments').where({ id: late }).update({ started_at: new Date(day + 30_000).toISOString(), last_activity_at: new Date(day + 60_000).toISOString() });
    await a.tick(day + 60_000);
    const row = (id) => s.ctx.db('environments').where({ id }).first();
    assert.equal((await row(early)).status, 'stopped');
    assert.equal((await row(early)).stop_reason, 'scheduled');
    assert.equal((await row(late)).status, 'running');
  } finally { await s.close(); }
});
