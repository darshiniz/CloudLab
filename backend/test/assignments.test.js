const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, createLab, waitStatus } = require('./helpers');

let t;
test.before(async () => { t = await boot(); });
test.after(async () => { await t.close(); });

test('students see only the activities assigned to them, with their own progress', async () => {
  const f = await t.as(t.emails.faculty);
  const d = await t.as(t.emails.darshini);
  const a = await t.as(t.emails.anushka);
  const base = { description: 'Do it', labId: 'lab_python', dueDate: '2099-01-01T10:00:00Z', datasetId: 'ds_iris' };
  const some = (await f.post('/faculty/activities', { ...base, title: 'Only Darshini', assignTo: { type: 'students', studentIds: [t.ids.darshini] } })).body.data;
  const all = (await f.post('/faculty/activities', { ...base, title: 'Whole class', datasetId: null, assignTo: { type: 'class', studentIds: [] } })).body.data;

  const mineD = (await d.get('/assignments')).body.data;
  const mineA = (await a.get('/assignments')).body.data;
  assert.ok(mineD.some((x) => x.id === some.id));
  assert.ok(!mineA.some((x) => x.id === some.id), 'not assigned to Anushka');
  assert.ok(mineA.some((x) => x.id === all.id));

  const row = mineD.find((x) => x.id === some.id);
  assert.deepEqual(Object.keys(row).sort(), ['assignedBy', 'createdAt', 'dataset', 'description', 'dueDate', 'environmentId', 'id', 'lab', 'overdue', 'status', 'title']);
  assert.equal(row.status, 'assigned');
  assert.equal(row.environmentId, null);
  assert.equal(row.overdue, false);
  assert.equal(row.lab.type, 'python');
  assert.ok(row.dataset.mountPath.startsWith('/data/shared/'));
  assert.equal(mineD.find((x) => x.id === all.id).dataset, null);

  // progress is per student and follows that student's own labs
  const lab = (await createLab(d, { name: 'activity lab' })).body.data.id;
  await waitStatus(t.ctx, lab, 'running');
  let now = (await d.get('/assignments')).body.data.find((x) => x.id === some.id);
  assert.equal(now.status, 'inProgress');
  assert.equal(now.environmentId, lab);
  assert.equal((await a.get('/assignments')).body.data.find((x) => x.id === all.id).status, 'assigned');
  await d.post(`/environments/${lab}/stop`);
  now = (await d.get('/assignments')).body.data.find((x) => x.id === some.id);
  assert.equal(now.status, 'completed');
});

test('only students can use the endpoint', async () => {
  assert.equal((await (await t.as(t.emails.faculty)).get('/assignments')).status, 403);
  assert.equal((await (await t.as(t.emails.admin)).get('/assignments')).status, 403);
  assert.equal((await t.raw.get(`${t.API}/assignments`)).status, 401);
});