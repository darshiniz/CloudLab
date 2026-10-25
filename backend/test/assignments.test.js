const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, createLab, waitStatus } = require('./helpers');

let t;
test.before(async () => { t = await boot(); });
test.after(async () => { await t.close(); });

const base = { description: 'Do it', labId: 'lab_python', dueDate: '2099-01-01T10:00:00Z', datasetId: 'ds_iris' };
const mk = async (f, over) => (await f.post('/faculty/activities', { ...base, ...over })).body.data;

test('students see only their activities; status follows their own work and the Submit button', async () => {
  const f = await t.as(t.emails.faculty);
  const d = await t.as(t.emails.darshini);
  const a = await t.as(t.emails.anushka);
  const some = await mk(f, { title: 'Only Darshini', assignTo: { type: 'students', studentIds: [t.ids.darshini] } });
  const all = await mk(f, { title: 'Whole class', datasetId: null, assignTo: { type: 'class', studentIds: [] } });
  const find = async (c, id) => (await c.get('/assignments')).body.data.find((x) => x.id === id);

  assert.ok(await find(d, some.id));
  assert.equal(await find(a, some.id), undefined, 'not assigned to Anushka');
  assert.ok(await find(a, all.id));

  const row = await find(d, some.id);
  assert.deepEqual(Object.keys(row).sort(), ['assignedBy', 'createdAt', 'dataset', 'description', 'dueDate', 'environmentId', 'id', 'lab', 'liveEnvironmentId', 'maxMarks', 'overdue', 'status', 'submission', 'title']);
  assert.equal(row.status, 'assigned');
  assert.equal(row.submission, null);
  assert.equal(row.lab.type, 'python');
  assert.ok(row.dataset.mountPath.startsWith('/data/shared/'));

  // starting a lab makes it inProgress, and it STAYS inProgress after the lab stops (stopping is not finishing)
  const lab = (await createLab(d, { name: 'activity lab' })).body.data.id;
  await waitStatus(t.ctx, lab, 'running');
  let now = await find(d, some.id);
  assert.equal(now.status, 'inProgress');
  assert.equal(now.liveEnvironmentId, lab);
  assert.equal((await find(a, all.id)).status, 'assigned');
  await d.post(`/environments/${lab}/stop`);
  now = await find(d, some.id);
  assert.equal(now.status, 'inProgress');
  assert.equal(now.liveEnvironmentId, null);

  // submit
  const sub = await d.post(`/assignments/${some.id}/submit`, { note: 'first part done' });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.data.status, 'submitted');
  assert.equal(sub.body.data.submission.note, 'first part done');
  assert.equal(sub.body.data.submission.late, false);
  const again = await d.post(`/assignments/${some.id}/submit`, { note: 'updated' });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.submission.note, 'updated');
  assert.equal(await t.ctx.db('submissions').where({ activity_id: some.id }).count({ n: '*' }).first().then((x) => Number(x.n)), 1);
  assert.equal((await find(a, all.id)).status, 'assigned', 'Anushka is unaffected');

  // not yours, unknown, wrong role
  assert.equal((await a.post(`/assignments/${some.id}/submit`, {})).status, 404);
  assert.equal((await d.post('/assignments/act_nope/submit', {})).status, 404);
  assert.equal((await d.post(`/assignments/${all.id}/submit`, { note: 'x'.repeat(1001) })).status, 422);
  assert.equal((await f.post(`/assignments/${some.id}/submit`, {})).status, 403);
});

test('late submissions are flagged', async () => {
  const f = await t.as(t.emails.faculty);
  const d = await t.as(t.emails.darshini);
  const act = await mk(f, { title: 'Past due', dueDate: new Date(Date.now() + 1000).toISOString(), assignTo: { type: 'students', studentIds: [t.ids.darshini] } });
  await new Promise((r) => setTimeout(r, 1200));
  const r = (await d.get('/assignments')).body.data.find((x) => x.id === act.id);
  assert.equal(r.overdue, true);
  const s = (await d.post(`/assignments/${act.id}/submit`, {})).body.data;
  assert.equal(s.submission.late, true);
  assert.equal(s.overdue, false, 'submitted work is not overdue');
});

test('faculty see who submitted, and can read a submitted student\'s files (read-only, only after submit)', async () => {
  const f = await t.as(t.emails.faculty);
  const d = await t.as(t.emails.darshini);
  const f2 = await t.as(t.emails.admin);
  const act = await mk(f, { title: 'With files', assignTo: { type: 'students', studentIds: [t.ids.darshini, t.ids.anushka] } });
  const files = (sid, p = '') => f.get(`/faculty/activities/${act.id}/submissions/${sid}/files${p}`);

  let rows = (await f.get(`/faculty/activities/${act.id}/submissions`)).body.data;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.status), ['assigned', 'assigned']);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['email', 'feedback', 'gradedAt', 'late', 'marks', 'maxMarks', 'name', 'note', 'paths', 'rollNo', 'status', 'studentId', 'submittedAt']);
  assert.deepEqual((await f.get(`/faculty/activities/${act.id}`)).body.data.progress, { assigned: 2, inProgress: 0, completed: 0 });
  assert.equal((await files(t.ids.darshini)).status, 404, 'not submitted yet');

  await t.ctx.storage.ensureStudent(t.ids.darshini);
  const dir = t.ctx.storage.projectsDir(t.ids.darshini);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('loops/main.py', 'print("hello")\n');
  put('loops/src/util.py', 'x = 1\n');
  put('loops/node_modules/big/index.js', 'skipped');
  put('private-stuff/diary.txt', 'not for faculty');
  put('notes.txt', 'also private');
  fs.symlinkSync('/etc', path.join(dir, 'loops', 'link-to-etc'));

  // the picker lists the top of the workspace
  const pick = (await d.get('/assignments/workspace')).body.data;
  assert.deepEqual(pick.map((x) => x.name).sort(), ['loops', 'notes.txt', 'private-stuff']);

  // bad choices are refused and nothing is recorded
  for (const bad of [['../x'], ['loops/src'], ['nope'], ['..'], ['/etc']]) {
    assert.equal((await d.post(`/assignments/${act.id}/submit`, { note: 'x', paths: bad })).status, 422, JSON.stringify(bad));
  }
  assert.equal((await files(t.ids.darshini)).status, 404, 'still not submitted');

  await d.post(`/assignments/${act.id}/submit`, { note: 'please check', paths: ['loops'] });

  rows = (await f.get(`/faculty/activities/${act.id}/submissions`)).body.data;
  const dr = rows.find((x) => x.studentId === t.ids.darshini);
  assert.equal(dr.status, 'submitted');
  assert.equal(dr.note, 'please check');
  assert.deepEqual(dr.paths, ['loops']);
  assert.equal(rows.find((x) => x.studentId === t.ids.anushka).status, 'assigned');
  assert.deepEqual((await f.get(`/faculty/activities/${act.id}`)).body.data.progress, { assigned: 2, inProgress: 0, completed: 1 });

  // faculty see ONLY what was handed in: no private folder, no loose file, no node_modules, no symlink
  const top = (await files(t.ids.darshini)).body.data;
  assert.deepEqual(top.map((x) => x.name), ['loops']);
  assert.deepEqual((await files(t.ids.darshini, '?path=/loops')).body.data.map((x) => x.name).sort(), ['main.py', 'src']);
  assert.deepEqual((await files(t.ids.darshini, '?path=/loops/src')).body.data.map((x) => x.name), ['util.py']);
  assert.equal((await files(t.ids.darshini, '?path=/private-stuff')).status, 404);
  const dl = await f.get(`/faculty/activities/${act.id}/submissions/${t.ids.darshini}/files/download?path=/loops/main.py`);
  assert.equal(dl.status, 200);
  assert.match(dl.text ?? String(dl.body), /hello/);
  assert.equal((await f.get(`/faculty/activities/${act.id}/submissions/${t.ids.darshini}/files/download?path=/notes.txt`)).status >= 400, true);
  assert.equal((await files(t.ids.darshini, '?path=/../..')).status >= 400, true, 'cannot escape the submission folder');

  // the copy is frozen: editing the live workspace afterwards changes nothing for faculty
  put('loops/main.py', 'print("CHANGED AFTER SUBMIT")\n');
  const dl2 = await f.get(`/faculty/activities/${act.id}/submissions/${t.ids.darshini}/files/download?path=/loops/main.py`);
  assert.match(dl2.text ?? String(dl2.body), /hello/);
  // submitting again replaces the copy (and a different choice replaces the old one)
  await d.post(`/assignments/${act.id}/submit`, { note: 'v2', paths: ['loops', 'notes.txt'] });
  const dl3 = await f.get(`/faculty/activities/${act.id}/submissions/${t.ids.darshini}/files/download?path=/loops/main.py`);
  assert.match(dl3.text ?? String(dl3.body), /CHANGED AFTER SUBMIT/);
  assert.deepEqual((await files(t.ids.darshini)).body.data.map((x) => x.name).sort(), ['loops', 'notes.txt']);
  assert.equal((await files(t.ids.anushka)).status, 404, 'Anushka has not submitted');

  // another faculty member's activities are not visible; admin may read; students may not
  assert.equal((await f2.get(`/faculty/activities/${act.id}/submissions`)).status, 200);
  assert.equal((await d.get(`/faculty/activities/${act.id}/submissions`)).status, 403);
});

test('only students can use the assignments endpoints', async () => {
  assert.equal((await (await t.as(t.emails.faculty)).get('/assignments')).status, 403);
  assert.equal((await (await t.as(t.emails.admin)).get('/assignments')).status, 403);
  assert.equal((await t.raw.get(`${t.API}/assignments`)).status, 401);
});

test('handing in is limited in size and a submission without files is allowed', async () => {
  const small = await boot({ MAX_SUBMISSION_BYTES: '1000' });
  try {
    const f = await small.as(small.emails.faculty);
    const d = await small.as(small.emails.darshini);
    const act = (await f.post('/faculty/activities', { ...base, title: 'Size', assignTo: { type: 'class', studentIds: [] } })).body.data;
    await small.ctx.storage.ensureStudent(small.ids.darshini);
    const dir = small.ctx.storage.projectsDir(small.ids.darshini);
    fs.mkdirSync(path.join(dir, 'big'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'big', 'data.bin'), Buffer.alloc(5000));
    const r = await d.post(`/assignments/${act.id}/submit`, { paths: ['big'] });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.details.paths);
    assert.equal((await d.get('/assignments')).body.data.find((x) => x.id === act.id).status, 'assigned', 'nothing was recorded');
    const none = await d.post(`/assignments/${act.id}/submit`, { note: 'theory only' });
    assert.equal(none.status, 201);
    const empty = await f.get(`/faculty/activities/${act.id}/submissions/${small.ids.darshini}/files`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data, [], 'submitted without files: faculty see an empty folder, never the live workspace');
  } finally { await small.close(); }
});
