const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

let t;
before(async () => { t = await boot({ STORAGE_QUOTA_BYTES: '5000', MAX_UPLOAD_BYTES: '3000', MAX_DATASET_BYTES: '20000' }); });
after(async () => { await t.close(); });

const upload = (c, url, buf, name, fields = {}) => {
  const r = t.raw.post(`${t.API}${url}`).set('Authorization', `Bearer ${c.token}`);
  for (const [k, v] of Object.entries(fields)) r.field(k, v);
  return r.attach('file', buf, name);
};

test('projects: create, list, isolation between students, delete', async () => {
  const d = await t.as(t.emails.darshini);
  const a = await t.as(t.emails.anushka);
  const c = await d.post('/projects', { name: 'Sales Analysis', labType: 'python' });
  assert.equal(c.status, 201);
  assert.deepEqual(Object.keys(c.body.data).sort(), ['createdAt', 'id', 'labType', 'modifiedAt', 'name', 'userId']);
  assert.match(c.body.data.id, /^prj_/);
  assert.equal((await d.post('/projects', { name: 'sales analysis', labType: 'python' })).status, 422); // duplicate
  assert.equal((await d.post('/projects', { name: 'x', labType: 'cobol' })).status, 422);
  assert.equal((await d.get('/projects')).body.data.length, 1);
  assert.equal((await a.get('/projects')).body.data.length, 0);
  const id = c.body.data.id;
  assert.equal((await a.get(`/projects/${id}/files`)).status, 404);
  assert.equal((await a.delete(`/projects/${id}`)).status, 404);
  assert.equal((await d.delete(`/projects/${id}`)).status, 204);
  assert.equal((await d.get('/projects')).body.data.length, 0);
});

test('files: upload into folders, list, download, delete', async () => {
  const d = await t.as(t.emails.darshini);
  const id = (await d.post('/projects', { name: 'Files', labType: 'python' })).body.data.id;
  const up = await upload(d, `/projects/${id}/files`, Buffer.from('print("hi")'), 'analysis.py', { path: '/src' });
  assert.equal(up.status, 201);
  assert.deepEqual(up.body.data.path, '/src/analysis.py');
  assert.equal(up.body.data.type, 'file');
  assert.equal(up.body.data.sizeBytes, 11);
  const root = (await d.get(`/projects/${id}/files`)).body.data;
  assert.deepEqual(root.map((f) => [f.name, f.type]), [['src', 'folder']]);
  const sub = (await d.get(`/projects/${id}/files?path=/src`)).body.data;
  assert.equal(sub[0].path, '/src/analysis.py');
  const dl = await t.raw.get(`${t.API}/projects/${id}/files/download?path=/src/analysis.py`).set('Authorization', `Bearer ${d.token}`)
    .buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(dl.status, 200);
  assert.match(dl.headers['content-disposition'], /attachment/);
  assert.equal(dl.body.toString(), 'print("hi")');
  assert.equal(dl.headers['x-content-type-options'], 'nosniff');
  assert.equal((await d.delete(`/projects/${id}/files?path=/src/analysis.py`)).status, 204);
  assert.equal((await d.get(`/projects/${id}/files?path=/src`)).body.data.length, 0);
  assert.equal((await d.get(`/projects/${id}/files?path=/missing`)).status, 404);
  assert.equal((await d.get(`/projects/${id}/files/download?path=/src/gone.py`)).status, 404);
});

test('path traversal and symlink escapes are refused', async () => {
  const d = await t.as(t.emails.darshini);
  const a = await t.as(t.emails.anushka);
  const id = (await d.post('/projects', { name: 'Safe', labType: 'python' })).body.data.id;
  await a.post('/projects', { name: 'Other', labType: 'python' });
  fs.writeFileSync(path.join(t.ctx.storage.projectsDir(t.ids.anushka), 'secret.txt'), 'top secret');

  for (const p of ['/../x', '/a/../../x', '..', '/src/../../../etc']) {
    const r = await d.get(`/projects/${id}/files?path=${encodeURIComponent(p)}`);
    assert.equal(r.status, 422, p);
  }
  assert.equal((await d.get(`/projects/${id}/files/download?path=${encodeURIComponent('../../../../etc/passwd')}`)).status, 422);
  const up = await upload(d, `/projects/${id}/files`, Buffer.from('x'), 'ok.txt', { path: '/../..' });
  assert.equal(up.status, 422);
  assert.equal((await d.delete(`/projects/${id}/files?path=/`)).status, 422);

  // A lab container (running as the student) can create a symlink inside the workspace.
  const dir = path.join(t.ctx.storage.projectsDir(t.ids.darshini), fs.readdirSync(t.ctx.storage.projectsDir(t.ids.darshini)).find((n) => n.startsWith('safe-')));
  fs.symlinkSync(t.ctx.storage.projectsDir(t.ids.anushka), path.join(dir, 'link'));
  fs.symlinkSync(path.join(t.ctx.storage.projectsDir(t.ids.anushka), 'secret.txt'), path.join(dir, 'stolen.txt'));
  const via = await d.get(`/projects/${id}/files/download?path=/stolen.txt`);
  assert.ok([403, 404].includes(via.status), `symlinked file: ${via.status}`);
  assert.notEqual(via.text, 'top secret');
  const viaDir = await d.get(`/projects/${id}/files?path=/link`);
  assert.ok([403, 404].includes(viaDir.status), `symlinked dir: ${viaDir.status}`);
  const listing = (await d.get(`/projects/${id}/files`)).body.data.map((f) => f.name);
  assert.ok(!listing.includes('link') && !listing.includes('stolen.txt'), 'symlinks are not listed');
  const up2 = await upload(d, `/projects/${id}/files`, Buffer.from('pwn'), 'x.txt', { path: '/link' });
  assert.ok([403, 404].includes(up2.status));
  assert.ok(!fs.existsSync(path.join(t.ctx.storage.projectsDir(t.ids.anushka), 'x.txt')));
});

test('quota: upload past 5 GB (here 5000 bytes) is 413 STORAGE_QUOTA_EXCEEDED; usage endpoint reports it', async () => {
  const s = await t.as(t.emails.riya);
  const id = (await s.post('/projects', { name: 'Big', labType: 'python' })).body.data.id;
  assert.equal((await upload(s, `/projects/${id}/files`, Buffer.alloc(2500), 'a.bin')).status, 201);
  const second = await upload(s, `/projects/${id}/files`, Buffer.alloc(2000), 'b.bin');
  assert.equal(second.status, 201);
  const third = await upload(s, `/projects/${id}/files`, Buffer.alloc(1000), 'c.bin');
  assert.equal(third.status, 413);
  assert.equal(third.body.error.code, 'STORAGE_QUOTA_EXCEEDED');
  const u = (await s.get('/storage/usage')).body.data;
  assert.deepEqual(u, { usedBytes: 4500, limitBytes: 5000 });
  const huge = await upload(s, `/projects/${id}/files`, Buffer.alloc(3500), 'huge.bin');
  assert.equal(huge.status, 413); // above the per-file limit
  assert.equal(fs.readdirSync(t.ctx.storage.tmpDir).length, 0, 'no temp files are left behind');
});

test('file names are sanitised', async () => {
  const s = await t.as(t.emails.sneha);
  const id = (await s.post('/projects', { name: 'Names', labType: 'python' })).body.data.id;
  const r = await upload(s, `/projects/${id}/files`, Buffer.from('x'), '../../evil name$.sh');
  assert.equal(r.status, 201);
  assert.equal(r.body.data.path, '/evil name_.sh');
});

test('datasets: shared list, student upload (mine), scope rules, delete rules', async () => {
  const d = await t.as(t.emails.darshini);
  const f = await t.as(t.emails.faculty);
  const ad = await t.as(t.emails.admin);
  const shared = (await d.get('/datasets?scope=shared')).body.data;
  assert.deepEqual(shared.map((x) => x.id).sort(), ['ds_housing', 'ds_iris', 'ds_titanic']);
  const iris = shared.find((x) => x.id === 'ds_iris');
  assert.deepEqual(Object.keys(iris).sort(), ['courses', 'description', 'id', 'mountPath', 'name', 'rows', 'scope', 'sizeBytes', 'uploadedAt', 'uploadedBy', 'userId'].filter((k) => k !== 'userId'));
  assert.equal(iris.rows, 150);
  assert.equal(iris.mountPath, '/data/shared/iris.csv');

  const csv = Buffer.from('a,b\n1,2\n3,4\n');
  const mine = await upload(d, '/datasets', csv, 'mydata.csv', { description: 'mine', courses: '["MCA-Python"]' });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.data.scope, 'mine');
  assert.equal(mine.body.data.rows, 2);
  assert.equal(mine.body.data.mountPath, '/data/mine/mydata.csv');
  assert.deepEqual(mine.body.data.courses, ['MCA-Python']);
  assert.equal((await upload(d, '/datasets', csv, 'mydata.csv')).status, 422); // duplicate name
  assert.equal((await upload(d, '/datasets', csv, 'x.csv', { scope: 'shared' })).status, 403); // students cannot publish
  assert.equal((await upload(f, '/datasets', csv, 'x.csv', { scope: 'mine' })).status, 403);
  const sh = await upload(f, '/datasets', csv, 'class.csv', { description: 'for class' });
  assert.equal(sh.status, 201);
  assert.equal(sh.body.data.scope, 'shared');
  assert.equal((await upload(d, '/datasets', Buffer.alloc(30000), 'big.csv')).status, 413);

  // privacy: others never see "mine"
  assert.equal((await (await t.as(t.emails.anushka)).get('/datasets?scope=mine')).body.data.length, 0);
  assert.equal((await f.get('/datasets?scope=mine')).body.data.length, 0);
  assert.equal((await ad.get('/datasets')).body.data.some((x) => x.id === mine.body.data.id), false);
  assert.equal((await (await t.as(t.emails.anushka)).delete(`/datasets/${mine.body.data.id}`)).status, 404);

  // deletes
  assert.equal((await d.delete(`/datasets/${sh.body.data.id}`)).status, 403); // not the uploader
  assert.equal((await (await t.as(t.emails.faculty)).delete('/datasets/ds_iris')).status, 204); // faculty seeded it
  assert.equal((await ad.delete(`/datasets/${sh.body.data.id}`)).status, 204); // admin deletes any
  assert.equal((await d.delete(`/datasets/${mine.body.data.id}`)).status, 204);
  assert.ok(!fs.existsSync(path.join(t.ctx.storage.datasetsDir, 'iris.csv')));
  assert.equal((await d.delete(`/datasets/${mine.body.data.id}`)).status, 404);
});
