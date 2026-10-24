const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { boot, createLab, waitStatus } = require('./helpers');

let t;
before(async () => { t = await boot({ MOCK_SERVE_WORKSPACE: 'true', HOST_PORT_MIN: '21500', HOST_PORT_MAX: '21600', LOGIN_RATE_PER_MIN: '8', CORS_ORIGINS: 'http://localhost:5173' }); });
after(async () => { await t.close(); });

const tokenFrom = (url) => new URL(url).searchParams.get('wt');

test('workspace proxy: token in URL becomes an HttpOnly cookie, then the IDE page is served', async () => {
  await t.login(t.emails.admin); // log in before the rate-limit test uses up the budget
  const s = await t.as(t.emails.darshini);
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const { workspaceUrl } = (await s.get(`/environments/${id}/access`)).body.data;
  const wt = tokenFrom(workspaceUrl);

  assert.equal((await t.raw.get(`/lab/${id}/`)).status, 401, 'no token');
  assert.equal((await t.raw.get(`/lab/${id}/?wt=garbage`)).status, 401);
  assert.equal((await t.raw.get(`/lab/${id}/`).set('Authorization', `Bearer ${s.token}`)).status, 401, 'a login token is not a workspace token');

  const first = await t.raw.get(`/lab/${id}/?wt=${wt}&folder=/workspace`).redirects(0);
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, `/lab/${id}/?folder=%2Fworkspace`);
  const cookie = first.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, new RegExp(`Path=/lab/${id}`));
  assert.match(cookie, /SameSite=Lax/);

  const page = await t.raw.get(`/lab/${id}/`).set('Cookie', cookie.split(';')[0]);
  assert.equal(page.status, 200);
  assert.match(page.text, /CloudLab mock workspace/);
  assert.match(page.text, new RegExp(id));
  assert.equal((await t.raw.get(`/lab/${id}/healthz`).set('Cookie', cookie.split(';')[0])).body.status, 'alive');

  // the same cookie does not open another lab
  const other = (await createLab(await t.as(t.emails.anushka), { name: 'other' })).body.data.id;
  await waitStatus(t.ctx, other, 'running');
  assert.equal((await t.raw.get(`/lab/${other}/`).set('Cookie', cookie.split(';')[0])).status, 401);

  // someone else's valid workspace token for their own lab cannot be pointed at this lab
  const foreign = tokenFrom((await (await t.as(t.emails.anushka)).get(`/environments/${other}/access`)).body.data.workspaceUrl);
  assert.equal((await t.raw.get(`/lab/${id}/?wt=${foreign}`).redirects(0)).status, 401);

  await s.post(`/environments/${id}/stop`);
  assert.equal((await t.raw.get(`/lab/${id}/`).set('Cookie', cookie.split(';')[0])).status, 404, 'stopped lab is unreachable');
});

test('workspace proxy: deactivated account loses access even with a valid token', async () => {
  const s = await t.as(t.emails.riya);
  const id = (await createLab(s)).body.data.id;
  await waitStatus(t.ctx, id, 'running');
  const wt = tokenFrom((await s.get(`/environments/${id}/access`)).body.data.workspaceUrl);
  await t.ctx.db('users').where({ id: t.ids.riya }).update({ status: 'inactive' });
  assert.equal((await t.raw.get(`/lab/${id}/?wt=${wt}`).redirects(0)).status, 403);
  await t.ctx.db('users').where({ id: t.ids.riya }).update({ status: 'active' });
});

test('workspace websocket upgrade is refused without a valid workspace token', async () => {
  const server = http.createServer(t.app);
  server.on('upgrade', (req, socket, head) => t.app.locals.workspace.upgrade(req, socket, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ port, host: '127.0.0.1', path: '/lab/env_aaaaaaaaaa/stable/', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
      req.on('response', (res) => resolve(res.statusCode));
      req.on('upgrade', () => resolve(101));
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 401);
  } finally { server.closeAllConnections?.(); server.close(); }
});

test('login is rate limited (429 RATE_LIMITED)', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await t.raw.post(`${t.API}/auth/login`).send({ email: 'ghost@gbs.edu', password: 'x' });
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'RATE_LIMITED');
});

test('CORS: only configured origins are allowed; request id is exposed; helmet headers present', async () => {
  const ok = await t.raw.options(`${t.API}/auth/login`).set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
  const bad = await t.raw.options(`${t.API}/auth/login`).set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'POST');
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
  const r = await t.raw.get(`${t.API}/health`).set('Origin', 'http://localhost:5173');
  assert.match(r.headers['access-control-expose-headers'], /X-Request-Id/i);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-powered-by'], undefined);
});

test('internal errors never leak details, and carry the request id', async () => {
  const orig = t.ctx.policy.get;
  t.ctx.policy.get = async () => { throw new Error('db password is hunter2'); };
  try {
    const a = await t.as(t.emails.admin);
    const r = await a.get('/admin/policy');
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(r.body).includes('hunter2'));
    assert.ok(r.body.error.message.includes(r.headers['x-request-id']));
  } finally { t.ctx.policy.get = orig; }
});
