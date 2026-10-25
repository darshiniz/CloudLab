const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, createLab, waitStatus } = require('./helpers');
const { Reports } = require('../src/services/reports');

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3_600_000;

test('usage hours come from real sessions, split across days and weeks', async () => {
  const { db } = t.ctx;
  await db('usage_sessions').insert([
    { env_id: 'env_x', user_id: t.ids.darshini, lab_type: 'python', started_at: iso(5 * H), ended_at: iso(3 * H) },
    { env_id: 'env_y', user_id: t.ids.darshini, lab_type: 'java', started_at: iso(10 * 24 * H), ended_at: iso(10 * 24 * H - 1.5 * H) },
    { env_id: 'env_z', user_id: t.ids.anushka, lab_type: 'python', started_at: iso(1 * H), ended_at: null },
  ]);
  const s = await t.as(t.emails.darshini);
  const u = (await s.get('/usage/me?weeks=4')).body.data;
  assert.deepEqual(Object.keys(u).sort(), ['byLabType', 'hoursPerWeek', 'labsCreated', 'totalHours']);
  assert.equal(u.hoursPerWeek.length, 4);
  assert.deepEqual(Object.keys(u.hoursPerWeek[0]).sort(), ['hours', 'weekStart']);
  assert.ok(Math.abs(u.totalHours - 3.5) < 0.05, `total ${u.totalHours}`);
  assert.deepEqual(u.byLabType.map((x) => x.labType).sort(), ['java', 'python']);
  assert.equal((await s.get('/usage/me?weeks=0')).status, 422);
  assert.equal((await s.get('/usage/me?weeks=99')).status, 422);

  const rows = [{ started_at: '2026-10-01T22:00:00.000Z', ended_at: '2026-10-02T02:00:00.000Z' }];
  const days = Reports.byDay(rows, Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-10-03T00:00:00Z'));
  assert.deepEqual(days, [{ date: '2026-10-01', hours: 2 }, { date: '2026-10-02', hours: 2 }]);
});

test('faculty endpoints: shapes and permissions', async () => {
  const s = await t.as(t.emails.darshini);
  const f = await t.as(t.emails.faculty);
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');

  const ov = (await f.get('/faculty/overview')).body.data;
  assert.deepEqual(Object.keys(ov).sort(), ['activeStudents', 'stats', 'usageByDay']);
  assert.deepEqual(Object.keys(ov.stats).sort(), ['activeLabs', 'assignedActivities', 'avgHoursPerStudent', 'students']);
  assert.equal(ov.stats.students, 4);
  assert.equal(ov.stats.activeLabs, 1);
  assert.equal(ov.usageByDay.length, 7);
  assert.deepEqual(Object.keys(ov.activeStudents[0]).sort(), ['labType', 'name', 'since', 'userId']);

  const list = await f.get('/faculty/students?search=darsh&pageSize=5');
  assert.equal(list.body.meta.total, 1);
  assert.deepEqual(Object.keys(list.body.data[0]).sort(), ['email', 'id', 'labsCreated', 'lastActiveAt', 'name', 'rollNo', 'status']);
  assert.equal(list.body.data[0].labsCreated, 1);

  const det = (await f.get(`/faculty/students/${t.ids.darshini}`)).body.data;
  assert.deepEqual(Object.keys(det).sort(), ['environments', 'recentActivity', 'student', 'usageByDay']);
  assert.equal(det.environments[0].id, id);
  assert.ok(det.recentActivity.length >= 1);
  assert.deepEqual(Object.keys(det.recentActivity[0]).sort(), ['at', 'message']);
  assert.equal((await f.get(`/faculty/students/${t.ids.faculty}`)).status, 404); // not a student

  const sess = (await f.get('/faculty/sessions?labType=python')).body;
  assert.deepEqual(Object.keys(sess.data[0]).sort(), ['cpuPercent', 'durationMinutes', 'environmentId', 'labType', 'memoryPercent', 'status', 'studentName']);
  const sum = (await f.get('/faculty/usage/summary')).body.data;
  assert.deepEqual(Object.keys(sum).sort(), ['hoursPerStudent', 'mostUsedLabs']);
  assert.equal(sum.mostUsedLabs[0].labType, 'python');
  assert.equal((await (await t.as(t.emails.admin)).get('/faculty/overview')).status, 200);
  assert.equal((await s.get('/faculty/students')).status, 403);
});

test('activities: faculty create, validation, progress, admin read-only', async () => {
  const f = await t.as(t.emails.faculty);
  const ad = await t.as(t.emails.admin);
  const body = { title: 'Loops', description: 'Practise loops', labId: 'lab_python', dueDate: '2026-12-01T10:00:00Z', datasetId: 'ds_iris', assignTo: { type: 'students', studentIds: [t.ids.darshini, t.ids.anushka] } };
  const c = await f.post('/faculty/activities', body);
  assert.equal(c.status, 201);
  assert.deepEqual(Object.keys(c.body.data).sort(), ['assignTo', 'closed', 'createdAt', 'createdBy', 'datasetId', 'description', 'dueDate', 'id', 'labId', 'latePolicy', 'maxMarks', 'progress', 'title']);
  assert.deepEqual(c.body.data.assignTo.studentIds.sort(), [t.ids.anushka, t.ids.darshini].sort());
  assert.deepEqual(c.body.data.progress, { assigned: 2, inProgress: 0, completed: 0 });

  // progress: "in progress" follows the labs students start for that template, "completed" follows Submit
  const d = await t.as(t.emails.darshini);
  const a = await t.as(t.emails.anushka);
  const l1 = (await createLab(d, { name: 'activity lab' })).body.data.id;
  const l2 = (await createLab(a, { name: 'activity lab' })).body.data.id;
  await waitStatus(t.ctx, l1, 'running');
  await waitStatus(t.ctx, l2, 'running');
  await a.post(`/environments/${l2}/stop`);
  let got = (await f.get(`/faculty/activities/${c.body.data.id}`)).body.data;
  assert.deepEqual(got.progress, { assigned: 2, inProgress: 2, completed: 0 }); // started, nobody has submitted yet
  await a.post(`/assignments/${c.body.data.id}/submit`, {});
  got = (await f.get(`/faculty/activities/${c.body.data.id}`)).body.data;
  assert.deepEqual(got.progress, { assigned: 2, inProgress: 1, completed: 1 });

  const everyone = (await f.post('/faculty/activities', { ...body, title: 'Whole class', datasetId: null, assignTo: { type: 'class', studentIds: [] } })).body.data;
  assert.equal(everyone.datasetId, null);
  assert.equal(everyone.progress.assigned, 4);
  assert.deepEqual(everyone.assignTo, { type: 'class', studentIds: [] });

  for (const bad of [{ title: 'ab' }, { labId: 'nope' }, { datasetId: 'ds_nope' }, { dueDate: 'tomorrow' }, { assignTo: { type: 'students', studentIds: [] } }, { assignTo: { type: 'students', studentIds: ['usr_nope'] } }, { assignTo: { type: 'everyone' } }]) {
    const r = await f.post('/faculty/activities', { ...body, ...bad });
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
  assert.equal((await ad.post('/faculty/activities', body)).status, 403);   // admin is read-only here
  assert.equal((await d.post('/faculty/activities', body)).status, 403);
  assert.equal((await ad.get('/faculty/activities')).body.data.length, 3); // includes the seeded demo activity
  assert.equal((await ad.get(`/faculty/activities/${c.body.data.id}`)).status, 200);
  assert.equal((await f.get('/faculty/activities/act_nope')).status, 404);
});

test('admin overview, infrastructure, analytics and CSV export', async () => {
  const ad = await t.as(t.emails.admin);
  await t.ctx.jobs.monitor.tick();
  const ov = (await ad.get('/admin/overview')).body.data;
  assert.deepEqual(Object.keys(ov).sort(), ['alerts', 'cpuSeries', 'memorySeries', 'stateBreakdown', 'stats']);
  assert.deepEqual(Object.keys(ov.stats).sort(), ['activeLabs', 'cpuPercent', 'memoryPercent', 'runningContainers', 'storagePercent']);
  assert.deepEqual(Object.keys(ov.stateBreakdown).sort(), ['failed', 'inactive', 'running', 'stopped']);
  assert.ok(ov.stats.runningContainers >= 2);
  assert.ok(ov.cpuSeries.length >= 1);
  assert.deepEqual(Object.keys(ov.cpuSeries[0]).sort(), ['t', 'value']);

  const inf = (await ad.get('/admin/infrastructure')).body.data;
  assert.deepEqual(Object.keys(inf).sort(), ['clusterCapacity', 'nodes', 'queue', 'storage']);
  assert.deepEqual(inf.nodes.map((n) => n.id), ['control', 'worker-1', 'worker-2']);
  const control = inf.nodes[0];
  assert.equal(control.kind, 'control');
  assert.equal(control.slotsUsed, null);
  assert.equal(control.slotsTotal, null);
  assert.equal(inf.nodes[1].slotsTotal, 4);
  assert.equal(inf.clusterCapacity.slotsTotal, 8);
  assert.deepEqual(Object.keys(inf.storage).sort(), ['bucket', 'folders', 'totalGb', 'usedGb']);
  assert.deepEqual(Object.keys(inf.queue).sort(), ['items', 'length']);

  const an = (await ad.get('/admin/analytics')).body.data;
  assert.deepEqual(Object.keys(an).sort(), ['avgSessionMinutes', 'counts', 'labsCreatedPerDay', 'mostUsedTemplates', 'topStudents']);
  assert.equal(an.labsCreatedPerDay.length, 31);
  assert.ok(an.mostUsedTemplates[0].count >= 1);
  assert.equal((await ad.get('/admin/analytics?from=garbage')).status, 422);
});

test('CSV export is text/csv and neutralises spreadsheet formulas', async () => {
  const ad = await t.as(t.emails.admin);
  assert.equal(Reports.csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
  assert.equal(Reports.csvCell('+1'), "'+1");
  assert.equal(Reports.csvCell('@cmd'), "'@cmd");
  assert.equal(Reports.csvCell('a,b'), '"a,b"');
  assert.equal(Reports.csvCell(null), '');
  await t.ctx.db('users').where({ id: t.ids.riya }).update({ name: '=cmd|calc' });
  await t.ctx.db('usage_sessions').insert({ env_id: 'env_q', user_id: t.ids.riya, lab_type: 'python', started_at: iso(2 * H), ended_at: iso(H) });
  const r = await t.raw.get(`${t.API}/admin/analytics/export`).set('Authorization', `Bearer ${ad.token}`);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/csv/);
  assert.match(r.headers['content-disposition'], /attachment; filename=/);
  assert.ok(r.text.includes("'=cmd|calc"));
  assert.ok(!/(^|,)=cmd/m.test(r.text));
  assert.equal((await (await t.as(t.emails.faculty)).get('/admin/analytics/export')).status, 403);
});
