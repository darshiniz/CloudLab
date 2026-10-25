const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, API } = require('./helpers');
const { ROLE, ENV_STATUS, SIZE, STEP_KEY } = require('../src/constants');

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s);

test('health is public and has the contract shape', async () => {
  const r = await t.raw.get(`${API}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'ok');
  assert.ok(r.body.data.time);
  assert.match(r.headers['x-request-id'], /^req_/);
});

test('login: success returns token, expiresIn and the User model', async () => {
  const r = await t.raw.post(`${API}/auth/login`).send({ email: 'darshini@gbs.edu', password: 'student123' });
  assert.equal(r.status, 200);
  const { token, expiresIn, user } = r.body.data;
  assert.ok(token);
  assert.equal(expiresIn, 28800);
  assert.deepEqual(Object.keys(user).sort(), ['approvedAt', 'approvedBy', 'createdAt', 'email', 'id', 'lastActiveAt', 'name', 'role', 'rollNo', 'selfRegistered', 'status']);
  assert.equal(user.role, ROLE.STUDENT);
  assert.equal(user.rollNo, '25P0320018');
  assert.match(user.id, /^usr_/);
  assert.ok(isIso(user.createdAt));
});

test('login: wrong password and unknown email give the same 401 INVALID_CREDENTIALS', async () => {
  const a = await t.raw.post(`${API}/auth/login`).send({ email: 'darshini@gbs.edu', password: 'nope' });
  const b = await t.raw.post(`${API}/auth/login`).send({ email: 'ghost@gbs.edu', password: 'nope' });
  for (const r of [a, b]) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
  }
  assert.equal(a.body.error.message, b.body.error.message);
});

test('login: missing body is 400 BAD_REQUEST, empty fields are 422 with details', async () => {
  const none = await t.raw.post(`${API}/auth/login`);
  assert.equal(none.status, 400);
  assert.equal(none.body.error.code, 'BAD_REQUEST');
  const bad = await t.raw.post(`${API}/auth/login`).set('content-type', 'application/json').send('{not json');
  assert.equal(bad.status, 400);
  const empty = await t.raw.post(`${API}/auth/login`).send({});
  assert.equal(empty.status, 422);
  assert.equal(empty.body.error.code, 'VALIDATION_ERROR');
  assert.ok(empty.body.error.details.email);
  assert.ok(empty.body.error.details.password);
});

test('missing, malformed and expired tokens are 401 UNAUTHENTICATED', async () => {
  for (const h of [undefined, 'Bearer abc', 'Basic xyz']) {
    const q = t.raw.get(`${API}/auth/me`);
    if (h) q.set('Authorization', h);
    const r = await q;
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
  }
});

test('logout revokes the token', async () => {
  const login = await t.raw.post(`${API}/auth/login`).send({ email: 'riya@gbs.edu', password: 'student123' });
  const token = login.body.data.token;
  assert.equal((await t.raw.get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`)).status, 200);
  assert.equal((await t.raw.post(`${API}/auth/logout`).set('Authorization', `Bearer ${token}`)).status, 204);
  assert.equal((await t.raw.get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`)).status, 401);
});

test('unknown routes use the error envelope', async () => {
  const r = await t.raw.get(`${API}/nope`);
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
  assert.ok(r.body.error.details);
});

test('lab catalog: students see enabled + coming soon, admin sees all with includeDisabled', async () => {
  const s = await t.as(t.emails.darshini);
  const res = await s.get('/labs');
  assert.deepEqual(res.body.meta, { page: 1, pageSize: 100, total: 5 }, 'every list carries meta');
  const list = res.body.data;
  assert.deepEqual(list.map((l) => l.id).sort(), ['lab_cloud', 'lab_datascience', 'lab_java', 'lab_python', 'lab_web']);
  const python = list.find((l) => l.id === 'lab_python');
  assert.deepEqual(Object.keys(python).sort(), ['comingSoon', 'description', 'dockerImage', 'enabled', 'id', 'limits', 'name', 'tools', 'type']);
  assert.deepEqual(Object.keys(python.limits).sort(), ['cpu', 'memoryGb', 'storageGb']);
  assert.equal(list.find((l) => l.id === 'lab_cloud').comingSoon, true);
});

test('lab templates: only admin writes; docker image is validated; never deleted', async () => {
  const s = await t.as(t.emails.darshini);
  assert.equal((await s.post('/labs', {})).status, 403);
  const a = await t.as(t.emails.admin);
  const bad = await a.post('/labs', { name: 'X1', type: 'python', description: 'd', tools: [], dockerImage: '--privileged', limits: { cpu: 1, memoryGb: 1, storageGb: 5 } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.dockerImage);
  const created = await a.post('/labs', { name: 'Rust Lab', type: 'python', description: 'Rust', tools: ['rustc'], dockerImage: 'cloudlab/rust:1.0', limits: { cpu: 2, memoryGb: 2, storageGb: 5 } });
  assert.equal(created.status, 201);
  assert.match(created.body.data.id, /^lab_/);
  assert.equal(created.body.data.enabled, true);
  const patched = await a.patch(`/labs/${created.body.data.id}`, { enabled: false, limits: { cpu: 1 } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.enabled, false);
  assert.deepEqual(patched.body.data.limits, { cpu: 1, memoryGb: 2, storageGb: 5 });
  assert.equal((await s.get(`/labs/${created.body.data.id}`)).status, 404); // disabled templates are hidden from students
  assert.equal((await a.delete(`/labs/${created.body.data.id}`)).status, 404); // no delete route
});

test('role matrix: wrong role is 403', async () => {
  const s = await t.as(t.emails.darshini);
  const f = await t.as(t.emails.faculty);
  const a = await t.as(t.emails.admin);
  assert.equal((await s.get('/admin/users')).status, 403);
  assert.equal((await s.get('/faculty/overview')).status, 403);
  assert.equal((await f.get('/admin/users')).status, 403);
  assert.equal((await f.get('/projects')).status, 403);
  assert.equal((await a.get('/projects')).status, 403);
  assert.equal((await f.post('/environments', { labId: 'lab_python', name: 'abc', size: 'small', durationMinutes: 30 })).status, 403);
  assert.equal((await a.post('/environments', { labId: 'lab_python', name: 'abc', size: 'small', durationMinutes: 30 })).status, 403);
  assert.equal((await a.get('/usage/me')).status, 403);
  assert.equal((await s.get('/usage/me')).status, 200);
});

test('admin users: create, EMAIL_EXISTS, validation, patch rules', async () => {
  const a = await t.as(t.emails.admin);
  const body = { name: 'New Student', email: 'new@gbs.edu', role: 'student', password: 'Secret@123', rollNo: '25P0320099' };
  const c = await a.post('/admin/users', body);
  assert.equal(c.status, 201);
  assert.equal(c.body.data.email, 'new@gbs.edu');
  assert.equal(c.body.data.password, undefined);
  assert.equal(c.body.data.password_hash, undefined);
  const dup = await a.post('/admin/users', { ...body, email: 'NEW@gbs.edu', rollNo: '25P0320098' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'EMAIL_EXISTS');
  const noRoll = await a.post('/admin/users', { ...body, email: 'x@gbs.edu', rollNo: undefined });
  assert.equal(noRoll.status, 422);
  assert.ok(noRoll.body.error.details.rollNo);
  const weak = await a.post('/admin/users', { ...body, email: 'y@gbs.edu', password: 'short' });
  assert.equal(weak.status, 422);
  const me = (await a.get('/auth/me')).body.data;
  assert.equal((await a.patch(`/admin/users/${me.id}`, { status: 'inactive' })).status, 409);
  assert.equal((await a.patch(`/admin/users/${me.id}`, { role: 'faculty' })).status, 409);
  const p = await a.patch(`/admin/users/${c.body.data.id}`, { status: 'inactive' });
  assert.equal(p.body.data.status, 'inactive');
  const denied = await t.raw.post(`${API}/auth/login`).send({ email: 'new@gbs.edu', password: 'Secret@123' });
  assert.equal(denied.status, 403);
  const list = await a.get('/admin/users?role=student&search=new&page=1&pageSize=5');
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.page, 1);
  assert.equal(list.body.meta.pageSize, 5);
  assert.ok(list.body.meta.total >= 1);
});

test('a deactivated user is locked out immediately, even with a valid token', async () => {
  const a = await t.as(t.emails.admin);
  const s = await t.as(t.emails.sneha);
  const who = (await s.get('/auth/me')).body.data;
  await a.patch(`/admin/users/${who.id}`, { status: 'inactive' });
  assert.equal((await s.get('/auth/me')).status, 401);
  await a.patch(`/admin/users/${who.id}`, { status: 'active' });
});

test('policy and settings validation (ranges from the contract)', async () => {
  const a = await t.as(t.emails.admin);
  assert.deepEqual((await a.get('/admin/policy')).body.data, { autoStopEnabled: true, inactivityMinutes: 30, maxLabsPerWorker: 4 });
  for (const bad of [{ autoStopEnabled: true, inactivityMinutes: 14, maxLabsPerWorker: 4 }, { autoStopEnabled: true, inactivityMinutes: 121, maxLabsPerWorker: 4 },
    { autoStopEnabled: true, inactivityMinutes: 30, maxLabsPerWorker: 0 }, { autoStopEnabled: true, inactivityMinutes: 30, maxLabsPerWorker: 9 }, { inactivityMinutes: 30 }]) {
    const r = await a.put('/admin/policy', bad);
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
  const ok = await a.put('/admin/policy', { autoStopEnabled: true, inactivityMinutes: 45, maxLabsPerWorker: 4 });
  assert.equal(ok.body.data.inactivityMinutes, 45);
  await a.put('/admin/policy', { autoStopEnabled: true, inactivityMinutes: 30, maxLabsPerWorker: 4 });
  const s = await a.put('/admin/settings', { region: 'asia-south1', defaults: { cpu: 1, memoryGb: 1, storageGb: 5 } });
  assert.equal(s.status, 200);
  assert.equal((await a.get('/admin/settings')).body.data.region, 'asia-south1');
  const log = await a.get('/admin/audit-log?pageSize=3');
  assert.equal(log.status, 200);
  assert.ok(log.body.data.length <= 3);
  assert.deepEqual(Object.keys(log.body.data[0]).sort(), ['action', 'actorId', 'actorName', 'at', 'id', 'target']);
});

test('environment model matches the contract exactly', async () => {
  const s = await t.as(t.emails.riya);
  const r = await s.post('/environments', { labId: 'lab_python', name: 'shape check', size: SIZE.STANDARD, durationMinutes: 30 });
  assert.equal(r.status, 202);
  const e = r.body.data;
  assert.deepEqual(Object.keys(e).sort(), ['autoStopAt', 'containerId', 'createdAt', 'failureReason', 'id', 'labId', 'labType', 'lastActivityAt', 'name', 'provisioning', 'queuePosition', 'resources', 'size', 'startedAt', 'status', 'stopReason', 'stoppedAt', 'usage', 'userId', 'userName', 'workerId']);
  assert.match(e.id, /^env_/);
  assert.deepEqual(e.resources, { cpu: 2, memoryGb: 2, storageGb: 5 });
  assert.deepEqual(e.provisioning.steps.map((x) => x.key), Object.values(STEP_KEY));
  assert.ok([ENV_STATUS.PROVISIONING, ENV_STATUS.RUNNING].includes(e.status));
  assert.equal(e.queuePosition, null);
  await s.delete(`/environments/${e.id}`);
});

test('environment create validation: name, size, duration, lab', async () => {
  const s = await t.as(t.emails.riya);
  const r = await s.post('/environments', { labId: 'nope', name: 'ab', size: 'huge', durationMinutes: 10 });
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys(r.body.error.details).sort(), ['durationMinutes', 'name', 'size']);
  assert.equal(r.body.error.details.size, 'must be small or standard');
  const noLab = await s.post('/environments', { labId: 'nope', name: 'good name', size: 'small', durationMinutes: 30 });
  assert.equal(noLab.status, 422);
  assert.ok(noLab.body.error.details.labId);
  const soon = await s.post('/environments', { labId: 'lab_cloud', name: 'good name', size: 'small', durationMinutes: 30 });
  assert.equal(soon.status, 422);
  assert.equal((await s.post('/environments', { labId: 'lab_python', name: 'x'.repeat(41), size: 'small', durationMinutes: 241 })).status, 422);
});
