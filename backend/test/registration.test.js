const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

let t;
test.before(async () => { t = await boot({ REGISTRATION_MAX_STUDENTS: '6' }); }); // 4 demo students + 2 free places
test.after(async () => { await t.close(); });

const reg = (over = {}) => t.raw.post(`${t.API}/auth/register`).send({ name: 'New Student', email: 'new1@gbs.edu', rollNo: '25P0320099', password: 'longenough1', ...over });
const login = (email, password) => t.raw.post(`${t.API}/auth/login`).send({ email, password });

test('register creates a Pending student who cannot sign in until an admin approves', async () => {
  const r = await reg();
  assert.equal(r.status, 201);
  assert.equal(r.body.data.status, 'pending');
  assert.equal(r.body.data.password, undefined);

  const early = await login('new1@gbs.edu', 'longenough1');
  assert.equal(early.status, 403);
  assert.match(early.body.error.message, /waiting for administrator approval/);

  const ad = await t.as(t.emails.admin);
  const pending = (await ad.get('/admin/users?status=pending')).body.data;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].selfRegistered, true);
  assert.equal(pending[0].approvedBy, null);

  const ok = await ad.patch(`/admin/users/${r.body.data.id}`, { status: 'active' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.status, 'active');
  assert.equal(ok.body.data.approvedBy, 'Administrator');
  assert.ok(ok.body.data.approvedAt);

  const now = await login('new1@gbs.edu', 'longenough1');
  assert.equal(now.status, 200);
  assert.equal(now.body.data.user.role, 'student');
});

test('a rejected registration cannot sign in; registration is institute-email only', async () => {
  const ad = await t.as(t.emails.admin);
  const r = await reg({ email: 'new2@gbs.edu', rollNo: '25P0320098' });
  assert.equal(r.status, 201);
  await ad.patch(`/admin/users/${r.body.data.id}`, { status: 'rejected' });
  const res = await login('new2@gbs.edu', 'longenough1');
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /not approved/);

  const outside = await reg({ email: 'someone@gmail.com', rollNo: '25P0320097' });
  assert.equal(outside.status, 422);
  assert.ok(outside.body.error.details.email);
});

test('duplicate email and roll number, weak password and missing fields are refused', async () => {
  assert.equal((await reg({ email: 'new1@gbs.edu', rollNo: '25P0320090' })).status, 409);
  assert.equal((await reg({ email: 'new3@gbs.edu', rollNo: '25P0320099' })).status, 422);
  assert.equal((await reg({ email: 'new3@gbs.edu', rollNo: '25P0320090', password: 'short' })).status, 422);
  assert.equal((await reg({ email: 'new3@gbs.edu', rollNo: '' })).status, 422);
});

test('the student cap counts active and pending students and then closes registration', async () => {
  // 4 demo + new1 (active) + new2 (rejected, does not count) = 5 -> one free place
  const last = await reg({ email: 'new4@gbs.edu', rollNo: '25P0320080' });
  assert.equal(last.status, 201);
  const full = await reg({ email: 'new5@gbs.edu', rollNo: '25P0320081' });
  assert.equal(full.status, 403);
  assert.equal(full.body.error.code, 'REGISTRATION_CLOSED');
});

test('registration is rate limited per IP', async () => {
  const lim = await boot({ REGISTRATION_RATE_PER_MIN: '3', REGISTRATION_MAX_STUDENTS: '100' });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await lim.raw.post(`${lim.API}/auth/register`).send({ name: 'Rate Test', email: `r${i}@gbs.edu`, rollNo: `R${i}`, password: 'longenough1' })).status);
    assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  } finally { await lim.close(); }
});

test('REGISTRATION_ENABLED=false closes registration', async () => {
  const off = await boot({ REGISTRATION_ENABLED: 'false' });
  try {
    const r = await off.raw.post(`${off.API}/auth/register`).send({ name: 'Nope Nope', email: 'x@gbs.edu', rollNo: 'X1', password: 'longenough1' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'REGISTRATION_CLOSED');
  } finally { await off.close(); }
});
