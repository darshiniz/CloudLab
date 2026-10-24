const fs = require('fs');
const os = require('os');
const path = require('path');
const supertest = require('supertest');
const { loadConfig } = require('../src/config');
const { createContext, closeContext } = require('../src/context');
const { createApp } = require('../src/app');
const { seed } = require('../src/db/seed');

const API = '/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 5000, every = 20, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(every);
  }
}

/** A complete app on a throw-away database and storage folder, using the MockDriver. */
async function boot(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudlab-test-'));
  const cfg = loadConfig({
    NODE_ENV: 'test', DB_FILE: path.join(dir, 'db.sqlite'), STORAGE_ROOT: path.join(dir, 'storage'),
    MOCK_STEP_DELAY_MS: '0', MOCK_SERVE_WORKSPACE: 'false', SEED_DEMO_DATA: 'true', LOGIN_RATE_PER_MIN: '1000',
    JOBS_ENABLED: 'false', ...over,
  });
  const ctx = await createContext(cfg);
  await seed(ctx);
  const app = createApp(ctx);
  const raw = supertest(app);
  const tokens = new Map();

  async function login(email, password) {
    const pw = password ?? (email === cfg.seed.adminEmail ? cfg.seed.adminPassword : email === 'sonia@gbs.edu' ? 'faculty123' : 'student123');
    if (!tokens.has(email)) {
      const r = await raw.post(`${API}/auth/login`).send({ email, password: pw });
      if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
      tokens.set(email, r.body.data.token);
    }
    return tokens.get(email);
  }

  /** Authenticated client: as('x@y').get('/labs') */
  async function as(email) {
    const token = await login(email);
    const call = (method) => (url, body) => {
      const r = raw[method](`${API}${url}`).set('Authorization', `Bearer ${token}`);
      return body === undefined ? r : r.send(body);
    };
    return { token, get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), delete: call('delete') };
  }

  const ids = {};
  for (const [k, email] of Object.entries({ admin: cfg.seed.adminEmail, faculty: 'sonia@gbs.edu', anushka: 'anushka@gbs.edu', darshini: 'darshini@gbs.edu', riya: 'riya@gbs.edu' })) {
    ids[k] = (await ctx.users.byEmail(email)).id;
  }
  const emails = { admin: cfg.seed.adminEmail, faculty: 'sonia@gbs.edu', anushka: 'anushka@gbs.edu', darshini: 'darshini@gbs.edu', riya: 'riya@gbs.edu', sneha: 'sneha@gbs.edu' };

  return {
    ctx, cfg, app, raw, as, login, ids, emails, API,
    async close() { await closeContext(ctx); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const createLab = (c, over = {}) => c.post('/environments', { labId: 'lab_python', name: 'test lab', size: 'small', durationMinutes: 60, ...over });
const statusOf = async (ctx, id) => (await ctx.db('environments').where({ id }).first()).status;
const waitStatus = (ctx, id, status, timeout = 5000) => waitFor(async () => (await statusOf(ctx, id)) === status, { timeout, what: `${id} to be ${status}` });

module.exports = { boot, waitFor, sleep, createLab, statusOf, waitStatus, API };
