// ─────────────────────────────────────────────────────────────────────────────
// Mock backend. Behaves like the real Express API described in
// "CloudLab API Contract v1.0": same paths, same { data, meta } envelope,
// same error body, same role rules, same status moves.
// The frontend can't tell the difference, which is the whole point:
// flip VITE_USE_MOCKS to false and the real backend takes over.
// ─────────────────────────────────────────────────────────────────────────────
import {
  ALLOWED_FROM, DATASET_SCOPE, ENV_STATUS, ERROR_CODE as E, LAB_TYPE, LIMITS,
  PROVISIONING_STEPS, ROLE, SIZE, SIZE_RESOURCES, USER_STATUS,
} from '../constants/enums';
import { users } from './data/users';
import { labs } from './data/labs';
import { environments } from './data/environments';
import { projects, files } from './data/projects';
import { datasets } from './data/datasets';
import { activities } from './data/activities';
import { nodes, policy, settings, storage, alerts, autoStopLog, auditLog, scaling } from './data/infrastructure';
import { ago, daysAgo, MIN } from './data/time';

// ── Mock database ────────────────────────────────────────────────────────────
// Kept in localStorage so a page refresh doesn't lose what you created during a demo.
// Starts fresh after 12 hours, or when you click "Reset demo data" in the profile menu.
const GIB = 1024 ** 3;
const STORE_KEY = 'cloudlab.mockdb.v3';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const seed = () => ({
  db: structuredClone({ users, labs, environments, projects, files, datasets, activities, nodes, policy, settings, storage, alerts, autoStopLog, auditLog, scaling }),
  storageUsed: { usr_101: Math.round(1.2 * GIB) }, // "Storage used 1.2/5 GB"
  seq: 6000,
});
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Date.now() - saved.savedAt < MAX_AGE_MS) return saved.state;
  } catch { /* storage blocked or corrupt: start fresh */ }
  return seed();
}
const state = load();
const { db, storageUsed } = state;
let seq = state.seq;
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ savedAt: Date.now(), state: { db, storageUsed, seq } })); } catch { /* ignore */ }
}
/** Wipe everything created during the demo and go back to the seed data */
export function resetMockData() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}
const nextId = (prefix) => `${prefix}_${seq++}`;
const QUEUE_MAX = 5;
const STEP_MS = 1300; // how long each of the 7 provisioning steps takes in the mock

// ── Helpers ──────────────────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
const ok = (data, status = 200) => ({ status, body: { data } });
const noContent = () => ({ status: 204, body: null });
const fail = (status, code, message, details) => { throw new HttpError(status, code, message, details); };
const notFound = (what = 'Resource') => fail(404, E.NOT_FOUND, `${what} not found`);
const forbidden = () => fail(403, E.FORBIDDEN, 'Your role is not allowed to do this');
const publicUser = ({ password, ...u }) => u;
const nowIso = () => new Date().toISOString();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const jitter = (v, amt, lo = 1, hi = 99) => Math.round(clamp(v + (Math.random() - 0.5) * amt, lo, hi));

function paginate(items, query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = clamp(Number(query.pageSize) || LIMITS.pageSizeDefault, 1, LIMITS.pageSizeMax);
  const start = (page - 1) * pageSize;
  return { status: 200, body: { data: items.slice(start, start + pageSize), meta: { page, pageSize, total: items.length } } };
}

function audit(actor, action, target) {
  db.auditLog.unshift({ id: nextId('aud'), actorId: actor.id, actorName: actor.name, action, target, at: nowIso() });
}

function scalingStatus() {
  return {
    provider: 'mock', available: true, autoEnabled: db.scaling.autoEnabled,
    rules: { scaleOutAfterSeconds: 60, scaleInAfterMinutes: 10, minWorkers: 1, cooldownSeconds: 120 },
    workers: db.nodes.filter((n) => n.kind === 'worker').map((n) => ({ id: n.id, name: n.name, vmName: `cloudlab-${n.id}`, power: db.scaling.workers[n.id].power, since: db.scaling.workers[n.id].since, status: db.scaling.workers[n.id].power === 'on' ? n.status : 'offline', slotsUsed: n.slotsUsed })),
    events: db.scaling.events.slice(0, 25),
  };
}

function validate(rules) {
  const details = {};
  for (const [field, message, bad] of rules) if (bad) details[field] = message;
  if (Object.keys(details).length) fail(422, E.VALIDATION_ERROR, 'Some fields are invalid', details);
}

// ── Environment simulation: provisioning steps, queue (BR-09), inactivity ────
const SLOT_STATUSES = [ENV_STATUS.PROVISIONING, ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE];
const workers = () => db.nodes.filter((n) => n.kind === 'worker' && n.status !== 'offline');
const slotsUsed = (workerId) =>
  db.environments.filter((e) => SLOT_STATUSES.includes(e.status) && (e.workerId ?? e._reservedWorker) === workerId).length;
const freeWorker = () =>
  workers()
    .map((w) => ({ w, used: slotsUsed(w.id) }))
    .filter(({ used }) => used < db.policy.maxLabsPerWorker)
    .sort((a, b) => a.used - b.used)[0]?.w ?? null;
const queue = () => db.environments.filter((e) => e.status === ENV_STATUS.QUEUED).sort((a, b) => a.queuePosition - b.queuePosition);

function freshSteps() {
  return PROVISIONING_STEPS.map((s) => ({ ...s, state: 'pending' }));
}

function beginProvisioning(env, worker) {
  Object.assign(env, {
    status: ENV_STATUS.PROVISIONING,
    queuePosition: null,
    failureReason: null,
    workerId: null,
    containerId: null,
    stoppedAt: null,
    autoStopAt: null,
    usage: { cpuPercent: 0, memoryPercent: 0 },
    provisioning: { currentStep: 1, steps: freshSteps() },
    _reservedWorker: worker.id,
    _provStart: Date.now(),
  });
}

function enqueue(env) {
  Object.assign(env, {
    status: ENV_STATUS.QUEUED,
    workerId: null,
    queuePosition: queue().length + 1,
    provisioning: { currentStep: 0, steps: freshSteps() },
  });
}

function placeOrQueue(env) {
  const w = freeWorker();
  if (w) return beginProvisioning(env, w);
  if (queue().length >= QUEUE_MAX) fail(503, E.CAPACITY_FULL, 'All servers are at capacity and the queue is full. Try again in a few minutes.');
  enqueue(env);
}

function tick(currentUserId) {
  const now = Date.now();
  for (const env of db.environments) {
    // 1. Provisioning: advance one step every STEP_MS
    if (env.status === ENV_STATUS.PROVISIONING && env._provStart) {
      const done = Math.floor((now - env._provStart) / STEP_MS);
      const failAt = /fail/i.test(env.name) ? 3 : -1; // demo: put "fail" in the lab name to see the error state
      env.provisioning.steps.forEach((s, i) => {
        if (failAt >= 0 && i === failAt && done >= i) s.state = 'failed';
        else s.state = i < done ? 'done' : i === done ? 'active' : 'pending';
      });
      env.provisioning.currentStep = Math.min(done + 1, 7);
      if (done >= 1) env.workerId = env._reservedWorker; // worker assigned after "Check resources"
      if (done >= 4) env.containerId ??= Math.random().toString(16).slice(2, 10);
      if (failAt >= 0 && done >= failAt) {
        Object.assign(env, { status: ENV_STATUS.FAILED, failureReason: 'Container failed to start: image pull timed out on ' + env._reservedWorker, workerId: null, _reservedWorker: null });
        env.provisioning.currentStep = failAt + 1;
        env.provisioning.steps.forEach((s, i) => { if (i > failAt) s.state = 'pending'; });
      } else if (done >= 7) {
        Object.assign(env, { status: ENV_STATUS.RUNNING, startedAt: nowIso(), lastActivityAt: nowIso(), usage: { cpuPercent: 12, memoryPercent: 24 } });
        env.provisioning.currentStep = 7;
        delete env._provStart;
      }
    }

    // 2. Other students keep working (so the demo doesn't slowly go idle)
    if (env.userId !== currentUserId && env.status === ENV_STATUS.RUNNING) env.lastActivityAt = nowIso();

    // 3. Inactivity policy: running → inactive after 10 idle min → stopped at autoStopAt
    if ([ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(env.status)) {
      const idleMin = (now - new Date(env.lastActivityAt).getTime()) / MIN;
      env.autoStopAt = new Date(new Date(env.lastActivityAt).getTime() + db.policy.inactivityMinutes * MIN).toISOString();
      if (env.status === ENV_STATUS.RUNNING && idleMin >= 10) env.status = ENV_STATUS.INACTIVE;
      if (env.status === ENV_STATUS.INACTIVE && idleMin < 10) env.status = ENV_STATUS.RUNNING;
      if (db.policy.autoStopEnabled && now >= new Date(env.autoStopAt).getTime()) {
        stopEnv(env);
        db.autoStopLog.unshift({ environmentId: env.id, userName: env.userName, labType: env.labType, stoppedAt: nowIso(), idleMinutes: Math.round(idleMin) });
      }
      // live metrics
      if (env.status === ENV_STATUS.RUNNING) {
        env.usage = { cpuPercent: jitter(env.usage.cpuPercent || 20, 14), memoryPercent: jitter(env.usage.memoryPercent || 30, 6) };
      } else if (env.status === ENV_STATUS.INACTIVE) {
        env.usage = { cpuPercent: jitter(2, 2, 0, 5), memoryPercent: env.usage.memoryPercent };
      }
    }
  }

  // 4. Promote the queue when a slot frees up
  for (const env of queue()) {
    const w = freeWorker();
    if (!w) break;
    beginProvisioning(env, w);
  }
  queue().forEach((e, i) => { e.queuePosition = i + 1; });

  // 5. Node numbers follow the labs on them
  for (const n of db.nodes) {
    if (n.kind !== 'worker') continue;
    n.slotsUsed = slotsUsed(n.id);
    n.slotsTotal = db.policy.maxLabsPerWorker;
    n.cpuPercent = jitter(18 + n.slotsUsed * 13, 8);
    n.memoryPercent = jitter(n.id === 'worker-2' ? 87 : 30 + n.slotsUsed * 12, 2);
    n.status = n.memoryPercent > 85 ? 'degraded' : 'online';
  }
  const control = db.nodes.find((n) => n.kind === 'control');
  control.cpuPercent = jitter(control.cpuPercent, 6);
}

function stopEnv(env) {
  Object.assign(env, {
    status: ENV_STATUS.STOPPED,
    stoppedAt: nowIso(),
    autoStopAt: null,
    workerId: null,
    _reservedWorker: null,
    usage: { cpuPercent: 0, memoryPercent: 0 },
  });
}

const publicEnv = ({ _reservedWorker, _provStart, ...e }) => e;

// ── Auth ─────────────────────────────────────────────────────────────────────
const TOKEN_TTL = 8 * 60 * 60; // seconds
const makeToken = (u) => `mock.${u.id}.${Math.floor(Date.now() / 1000) + TOKEN_TTL}`;
function userFromToken(header) {
  const token = header?.replace(/^Bearer\s+/i, '');
  if (!token) fail(401, E.UNAUTHENTICATED, 'Please log in');
  const [, id, exp] = token.split('.');
  if (!id || Number(exp) * 1000 < Date.now()) fail(401, E.UNAUTHENTICATED, 'Your session has expired. Please log in again.');
  const u = db.users.find((x) => x.id === id);
  if (!u || u.status !== USER_STATUS.ACTIVE) fail(401, E.UNAUTHENTICATED, 'Please log in');
  return u;
}

// ── Access helpers ───────────────────────────────────────────────────────────
function getEnvFor(user, id, { act = false } = {}) {
  const env = db.environments.find((e) => e.id === id);
  if (!env) notFound('Environment');
  if (user.role === ROLE.STUDENT && env.userId !== user.id) notFound('Environment'); // 404, so ids aren't leaked
  if (act && user.role === ROLE.FACULTY) forbidden();
  return env;
}
function requireState(env, action) {
  if (!ALLOWED_FROM[action].includes(env.status)) {
    fail(409, E.INVALID_STATE, `Can't ${action} a lab that is ${env.status}`, { status: env.status });
  }
}
const ownProject = (user, id) => {
  const p = db.projects.find((x) => x.id === id && x.userId === user.id);
  if (!p) notFound('Project');
  return p;
};
const studentHours = (userId) => {
  // Stable pseudo-random hours per student so charts are consistent between reloads
  const n = Number(userId.replace(/\D/g, '')) || 1;
  return Math.round(((n * 37) % 23) + 6 + (n % 3) * 1.5);
};

// ── Routes: [method, path, allowedRoles | 'public' | 'any', handler] ────────
/** Why a student cannot submit right now (mirrors the real API). */
function mockLock(a, sub) {
  let reason = null;
  if (a.closed) reason = 'closed';
  else if ((a.latePolicy ?? 'allow') === 'block' && new Date(a.dueDate) < new Date()) reason = 'pastDue';
  else if (sub?.gradedAt) reason = 'graded';
  return { canSubmit: !reason, lockedReason: reason };
}
const LOCK_MESSAGE = { closed: 'Your faculty has stopped accepting submissions for this activity.', pastDue: 'The due date has passed and late submissions are not accepted for this activity.', graded: 'This submission has already been graded. Ask your faculty to reopen it if you need to change it.' };

/** One activity as the signed-in student sees it (shared by the mock assignments endpoints). */
function assignmentView(a, user) {
  const lab = db.labs.find((l) => l.id === a.labId);
  const ds = a.datasetId ? db.datasets.find((d) => d.id === a.datasetId) : null;
  const mine = db.environments.filter((e) => e.userId === user.id && e.labId === a.labId && e.createdAt >= a.createdAt).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const live = mine.find((e) => [ENV_STATUS.REQUESTED, ENV_STATUS.QUEUED, ENV_STATUS.PROVISIONING, ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(e.status));
  const sub = (db.submissions ?? []).find((x) => x.activityId === a.id && x.userId === user.id);
  return {
    id: a.id, title: a.title, description: a.description, dueDate: a.dueDate, createdAt: a.createdAt,
    assignedBy: db.users.find((u) => u.id === a.createdBy)?.name ?? null,
    lab: lab ? { id: lab.id, name: lab.name, type: lab.type } : { id: a.labId, name: a.labId, type: null },
    dataset: ds ? { id: ds.id, name: ds.name, mountPath: `/data/shared/${ds.name}` } : null,
    status: sub ? 'submitted' : mine.length ? 'inProgress' : 'assigned',
    maxMarks: a.maxMarks ?? 100, latePolicy: a.latePolicy ?? 'allow', closed: !!a.closed, ...mockLock(a, sub),
    submission: sub ? { paths: sub.paths ?? [], submittedAt: sub.submittedAt, note: sub.note, late: new Date(sub.submittedAt) > new Date(a.dueDate), marks: sub.marks ?? null, feedback: sub.feedback ?? null, gradedAt: sub.gradedAt ?? null } : null,
    overdue: !sub && new Date(a.dueDate) < new Date(),
    liveEnvironmentId: live?.id ?? null, environmentId: (live || mine[0])?.id ?? null,
  };
}

const S = ROLE.STUDENT, F = ROLE.FACULTY, A = ROLE.ADMIN;
const routes = [
  // 7.1 Health and auth
  ['GET', '/health', 'public', () => ok({ status: 'ok', time: nowIso() })],
  ['POST', '/auth/login', 'public', ({ body }) => {
    if (!body?.email || !body?.password) fail(400, E.BAD_REQUEST, 'Email and password are required');
    const u = db.users.find((x) => x.email === String(body.email).trim().toLowerCase());
    if (!u || u.password !== body.password) fail(401, E.INVALID_CREDENTIALS, 'Wrong email or password');
    if (u.status === USER_STATUS.PENDING) fail(403, E.FORBIDDEN, 'Your registration is waiting for administrator approval.');
    if (u.status === USER_STATUS.REJECTED) fail(403, E.FORBIDDEN, 'Your registration was not approved. Contact the administrator.');
    if (u.status !== USER_STATUS.ACTIVE) fail(403, E.FORBIDDEN, 'This account has been deactivated. Contact the lab admin.');
    u.lastActiveAt = nowIso();
    return ok({ token: makeToken(u), expiresIn: TOKEN_TTL, user: publicUser(u) });
  }],
  ['POST', '/auth/register', 'public', ({ body }) => {
    const email = String(body?.email ?? '').trim().toLowerCase();
    validate([
      ['name', 'is required', !body?.name?.trim() || body.name.trim().length < 2],
      ['email', 'must be an @gbs.edu address', !/^[^@\s]+@gbs\.edu$/.test(email)],
      ['rollNo', 'is required', !body?.rollNo?.trim()],
      ['password', 'must be at least 8 characters', (body?.password ?? '').length < 8],
    ]);
    if (db.users.some((u) => u.email === email)) fail(409, E.EMAIL_EXISTS, 'A user with this email already exists');
    if (db.users.some((u) => u.rollNo === body.rollNo.trim())) fail(422, E.VALIDATION_ERROR, 'Validation failed', { rollNo: 'is already used by another student' });
    if (db.users.filter((u) => u.role === S && [USER_STATUS.ACTIVE, USER_STATUS.PENDING].includes(u.status)).length >= 15) fail(403, E.REGISTRATION_CLOSED, 'Registration is closed: the limit of 15 students has been reached.');
    const u = { id: nextId('usr'), name: body.name.trim(), email, role: S, status: USER_STATUS.PENDING, rollNo: body.rollNo.trim(), createdAt: nowIso(), lastActiveAt: null, password: body.password, selfRegistered: true, approvedBy: null, approvedAt: null };
    db.users.push(u);
    return ok({ id: u.id, status: u.status, message: 'Registration received. You can sign in once an administrator approves your account.' }, 201);
  }],
  ['GET', '/auth/me', 'any', ({ user }) => ok(publicUser(user))],
  ['POST', '/auth/logout', 'any', () => noContent()],

  // 7.2 Lab catalog
  ['GET', '/labs', 'any', ({ user, query }) => {
    const all = query.includeDisabled === 'true' && user.role === A;
    const items = db.labs.filter((l) => all || l.enabled);
    return paginate(items, { ...query, pageSize: 100 });
  }],
  ['GET', '/labs/:id', 'any', ({ params }) => ok(db.labs.find((l) => l.id === params.id) ?? notFound('Lab'))],
  ['POST', '/labs', [A], ({ user, body }) => {
    validate([
      ['name', 'is required', !body?.name?.trim()],
      ['type', `must be one of ${Object.values(LAB_TYPE).join(', ')}`, !Object.values(LAB_TYPE).includes(body?.type)],
      ['dockerImage', 'is required', !body?.dockerImage?.trim()],
    ]);
    const lab = { id: `lab_${body.type}_${seq++}`, enabled: true, comingSoon: false, tools: [], limits: { cpu: 2, memoryGb: 2, storageGb: 5 }, description: '', ...body };
    db.labs.push(lab);
    audit(user, 'lab.create', lab.id);
    return ok(lab, 201);
  }],
  ['PATCH', '/labs/:id', [A], ({ user, params, body }) => {
    const lab = db.labs.find((l) => l.id === params.id) ?? notFound('Lab');
    const { id, ...changes } = body ?? {};
    Object.assign(lab, changes);
    audit(user, 'lab.update', `${lab.id} ${Object.keys(changes).join(', ')}`);
    return ok(lab);
  }],

  // 7.3 Environments
  ['GET', '/environments', 'any', ({ user, query }) => {
    let items = db.environments;
    if (user.role === S) items = items.filter((e) => e.userId === user.id);
    if (user.role === F) items = items.filter((e) => db.users.find((u) => u.id === e.userId)?.role === S);
    if (query.status) items = items.filter((e) => query.status.split(',').includes(e.status));
    if (query.labType) items = items.filter((e) => e.labType === query.labType);
    if (query.userId && user.role !== S) items = items.filter((e) => e.userId === query.userId);
    if (query.workerId && user.role === A) items = items.filter((e) => e.workerId === query.workerId);
    items = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(items.map(publicEnv), query);
  }],
  ['POST', '/environments', [S], ({ user, body }) => {
    const lab = db.labs.find((l) => l.id === body?.labId);
    const name = body?.name?.trim() ?? '';
    validate([
      ['labId', 'must be an enabled lab template', !lab || !lab.enabled || lab.comingSoon],
      ['name', `must be ${LIMITS.envNameMin} to ${LIMITS.envNameMax} characters`, name.length < LIMITS.envNameMin || name.length > LIMITS.envNameMax],
      ['size', 'must be small or standard', !Object.values(SIZE).includes(body?.size)],
      ['durationMinutes', `must be between ${LIMITS.durationMin} and ${LIMITS.durationMax}`, !(body?.durationMinutes >= LIMITS.durationMin && body?.durationMinutes <= LIMITS.durationMax)],
    ]);
    const env = {
      id: nextId('env'), name, userId: user.id, userName: user.name, labId: lab.id, labType: lab.type,
      status: ENV_STATUS.REQUESTED, size: body.size, resources: { ...SIZE_RESOURCES[body.size] },
      workerId: null, containerId: null, queuePosition: null,
      provisioning: { currentStep: 0, steps: freshSteps() },
      usage: { cpuPercent: 0, memoryPercent: 0 }, failureReason: null,
      createdAt: nowIso(), startedAt: null, stoppedAt: null, lastActivityAt: nowIso(), autoStopAt: null,
    };
    placeOrQueue(env);
    db.environments.push(env);
    return ok(publicEnv(env), 202);
  }],
  ['GET', '/environments/:id', [S, F, A], ({ user, params }) => ok(publicEnv(getEnvFor(user, params.id)))],
  ['POST', '/environments/:id/start', [S, A], ({ user, params }) => {
    const env = getEnvFor(user, params.id, { act: true });
    requireState(env, 'start');
    placeOrQueue(env);
    return ok(publicEnv(env), 202);
  }],
  ['POST', '/environments/:id/stop', [S, A], ({ user, params }) => {
    const env = getEnvFor(user, params.id, { act: true });
    requireState(env, 'stop');
    stopEnv(env);
    if (user.role === A) audit(user, 'environment.stop', env.id);
    return ok(publicEnv(env));
  }],
  ['POST', '/environments/:id/restart', [S, A], ({ user, params }) => {
    const env = getEnvFor(user, params.id, { act: true });
    requireState(env, 'restart');
    stopEnv(env);
    placeOrQueue(env);
    if (user.role === A) audit(user, 'environment.restart', env.id);
    return ok(publicEnv(env), 202);
  }],
  ['DELETE', '/environments/:id', [S, A], ({ user, params }) => {
    const env = getEnvFor(user, params.id, { act: true });
    requireState(env, 'delete');
    stopEnv(env);
    Object.assign(env, { status: ENV_STATUS.TERMINATED, containerId: null, queuePosition: null });
    if (user.role === A) audit(user, 'environment.terminate', env.id);
    return ok(publicEnv(env));
  }],
  ['POST', '/environments/:id/heartbeat', [S], ({ user, params }) => {
    const env = getEnvFor(user, params.id);
    if ([ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(env.status)) {
      env.lastActivityAt = nowIso();
      env.status = ENV_STATUS.RUNNING;
    }
    return noContent();
  }],
  ['GET', '/environments/:id/access', [S], ({ user, params }) => {
    const env = getEnvFor(user, params.id);
    if (![ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(env.status)) fail(409, E.INVALID_STATE, 'The lab must be running to open it');
    const t = Math.random().toString(36).slice(2, 10);
    return ok({
      workspaceUrl: `https://labs.cloudlab.dev/w/${env.id}?t=${t}`,
      terminalUrl: `wss://labs.cloudlab.dev/t/${env.id}?t=${t}`,
      expiresAt: new Date(Date.now() + 15 * MIN).toISOString(),
    });
  }],
  ['GET', '/environments/:id/metrics', [S, A], ({ user, params }) => {
    const env = getEnvFor(user, params.id);
    return ok({ cpuPercent: env.usage.cpuPercent, memoryPercent: env.usage.memoryPercent, diskPercent: 24, sampledAt: nowIso() });
  }],
  ['POST', '/environments/:id/datasets', [S], ({ user, params, body }) => {
    getEnvFor(user, params.id);
    const ds = db.datasets.find((d) => d.id === body?.datasetId && (d.scope === DATASET_SCOPE.SHARED || d.uploadedBy === user.id));
    if (!ds) notFound('Dataset');
    return ok({ mountPath: ds.mountPath });
  }],

  // 7.4 Projects and files (student only)
  ['GET', '/projects', [S], ({ user, query }) => paginate(db.projects.filter((p) => p.userId === user.id), query)],
  ['POST', '/projects', [S], ({ user, body }) => {
    validate([
      ['name', 'must be 3 to 40 characters', !(body?.name?.trim().length >= 3 && body.name.trim().length <= 40)],
      ['labType', 'is not a valid lab type', !Object.values(LAB_TYPE).includes(body?.labType)],
    ]);
    const p = { id: nextId('prj'), userId: user.id, name: body.name.trim(), labType: body.labType, createdAt: nowIso(), modifiedAt: nowIso() };
    db.projects.push(p);
    db.files[p.id] = [];
    return ok(p, 201);
  }],
  ['DELETE', '/projects/:id', [S], ({ user, params }) => {
    const p = ownProject(user, params.id);
    db.projects = db.projects.filter((x) => x !== p);
    delete db.files[p.id];
    return noContent();
  }],
  ['GET', '/projects/:id/files', [S], ({ user, params, query }) => {
    ownProject(user, params.id);
    const dir = (query.path || '/').replace(/\/$/, '') || '';
    const items = (db.files[params.id] ?? []).filter((f) => f.path.slice(0, f.path.lastIndexOf('/')) === dir);
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    return paginate(items, { pageSize: 100 });
  }],
  ['POST', '/projects/:id/files', [S], ({ user, params, body }) => {
    const p = ownProject(user, params.id);
    const file = body?.get?.('file');
    if (!file) fail(400, E.BAD_REQUEST, 'No file attached');
    if (!file.size) fail(422, E.VALIDATION_ERROR, 'This file is empty (0 bytes). If it is a OneDrive file, open it once so it downloads, then try again.', { file: 'is empty or could not be read' });
    const used = storageUsed[user.id] ?? 0;
    if (used + file.size > LIMITS.storageLimitBytes) fail(413, E.STORAGE_QUOTA_EXCEEDED, 'This upload would go over your 5 GB storage limit');
    const dir = (body.get('path') || '/').replace(/\/$/, '');
    const item = { name: file.name, path: `${dir}/${file.name}`, type: 'file', sizeBytes: file.size, modifiedAt: nowIso() };
    db.files[p.id] = (db.files[p.id] ?? []).filter((f) => f.path !== item.path).concat(item);
    storageUsed[user.id] = used + file.size;
    p.modifiedAt = nowIso();
    return ok(item, 201);
  }],
  ['GET', '/projects/:id/files/download', [S], ({ user, params, query }) => {
    ownProject(user, params.id);
    const f = (db.files[params.id] ?? []).find((x) => x.path === query.path && x.type === 'file') ?? notFound('File');
    const blob = new Blob([`# ${f.name}\n# Mock download from CloudLab (${f.sizeBytes} bytes in the real file)\n`], { type: 'text/plain' });
    return { status: 200, blob, filename: f.name };
  }],
  ['DELETE', '/projects/:id/files', [S], ({ user, params, query }) => {
    ownProject(user, params.id);
    const path = query.path;
    const list = db.files[params.id] ?? [];
    const removed = list.filter((f) => f.path === path || f.path.startsWith(path + '/'));
    if (!removed.length) notFound('File');
    db.files[params.id] = list.filter((f) => !removed.includes(f));
    storageUsed[user.id] = Math.max(0, (storageUsed[user.id] ?? 0) - removed.reduce((s, f) => s + f.sizeBytes, 0));
    return noContent();
  }],
  ['GET', '/storage/usage', [S], ({ user }) => ok({ usedBytes: storageUsed[user.id] ?? 0, limitBytes: LIMITS.storageLimitBytes })],

  // 7.5 Datasets
  ['GET', '/datasets', 'any', ({ user, query }) => {
    const scope = query.scope || DATASET_SCOPE.SHARED;
    const items = db.datasets.filter((d) => (scope === DATASET_SCOPE.SHARED ? d.scope === DATASET_SCOPE.SHARED : d.scope === DATASET_SCOPE.MINE && d.uploadedBy === user.id));
    return paginate(items, { ...query, pageSize: 100 });
  }],
  ['POST', '/datasets', 'any', async ({ user, body }) => {
    const file = body?.get?.('file');
    const scope = body?.get?.('scope');
    if (!file) fail(400, E.BAD_REQUEST, 'No file attached');
    if (user.role === S && scope !== DATASET_SCOPE.MINE) forbidden();
    if (user.role !== S && scope !== DATASET_SCOPE.SHARED) fail(422, E.VALIDATION_ERROR, 'Faculty and admin upload shared datasets', { scope: 'must be shared' });
    if (user.role === S && (storageUsed[user.id] ?? 0) + file.size > LIMITS.storageLimitBytes) fail(413, E.STORAGE_QUOTA_EXCEEDED, 'This upload would go over your 5 GB storage limit');
    if (!file.size) fail(422, E.VALIDATION_ERROR, 'This file is empty (0 bytes). If it is a OneDrive file, open it once so it downloads, or close it in Excel, then try again.', { file: 'is empty or could not be read' });
    let text = '';
    try { text = file.size < 5_000_000 ? await file.text() : ''; } catch {
      fail(422, E.VALIDATION_ERROR, "The browser couldn't read this file. Close it in other apps (e.g. Excel) or make sure it is downloaded, then try again.", { file: 'could not be read' });
    }
    const rows = text ? Math.max(0, text.trim().split(/\r?\n/).length - 1) : null;
    const name = body.get('name') || file.name;
    const ds = {
      id: nextId('ds'), name, description: body.get('description') || '', scope, sizeBytes: file.size, rows,
      courses: (body.get('courses') || '').split(',').map((c) => c.trim()).filter(Boolean),
      uploadedBy: user.id, uploadedAt: nowIso(),
      mountPath: scope === DATASET_SCOPE.SHARED ? `/data/shared/${name}` : `/data/mine/${name}`,
    };
    db.datasets.push(ds);
    if (user.role === S) storageUsed[user.id] = (storageUsed[user.id] ?? 0) + file.size;
    else audit(user, 'dataset.upload', ds.id);
    return ok(ds, 201);
  }],
  ['DELETE', '/datasets/:id', 'any', ({ user, params }) => {
    const ds = db.datasets.find((d) => d.id === params.id) ?? notFound('Dataset');
    if (ds.uploadedBy !== user.id && user.role !== A) forbidden();
    db.datasets = db.datasets.filter((d) => d !== ds);
    if (user.role === S) storageUsed[user.id] = Math.max(0, (storageUsed[user.id] ?? 0) - ds.sizeBytes);
    return noContent();
  }],

  // 7.6 Student usage
  ['GET', '/usage/me', [S], ({ user, query }) => {
    const weeks = clamp(Number(query.weeks) || 8, 1, 26);
    const hours = [4.5, 6, 3.5, 8, 7.5, 9, 6.5, 10.5, 8, 11, 9.5, 12];
    const hoursPerWeek = Array.from({ length: weeks }, (_, i) => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - d.getUTCDay() - 7 * (weeks - 1 - i));
      return { weekStart: d.toISOString(), hours: hours[i % hours.length] };
    });
    const total = hoursPerWeek.reduce((s, w) => s + w.hours, 0);
    return ok({
      hoursPerWeek,
      byLabType: [{ labType: 'python', hours: +(total * 0.55).toFixed(1) }, { labType: 'java', hours: +(total * 0.3).toFixed(1) }, { labType: 'web', hours: +(total * 0.15).toFixed(1) }],
      totalHours: +total.toFixed(1),
      labsCreated: db.environments.filter((e) => e.userId === user.id).length + 14,
    });
  }],

  // 7.7 Faculty
  ['GET', '/faculty/overview', [F, A], () => {
    const students = db.users.filter((u) => u.role === S);
    const active = db.environments.filter((e) => [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.PROVISIONING].includes(e.status));
    const usageByDay = Array.from({ length: 14 }, (_, i) => ({ date: daysAgo(13 - i).slice(0, 10), hours: [18, 22, 15, 9, 4, 26, 31, 28, 24, 20, 8, 5, 30, 27][i] }));
    return ok({
      stats: {
        students: students.length,
        activeLabs: active.length,
        assignedActivities: db.activities.length,
        avgHoursPerStudent: +(students.reduce((s, u) => s + studentHours(u.id), 0) / students.length).toFixed(1),
      },
      usageByDay,
      activeStudents: [...new Map(active.map((e) => [e.userId, { userId: e.userId, name: e.userName, labType: e.labType, since: e.startedAt ?? e.createdAt }])).values()],
    });
  }],
  ['GET', '/faculty/students', [F, A], ({ query }) => {
    const q = (query.search || '').toLowerCase();
    const items = db.users
      .filter((u) => u.role === S)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.rollNo.toLowerCase().includes(q) || u.email.includes(q))
      .map((u) => ({ id: u.id, name: u.name, rollNo: u.rollNo, email: u.email, labsCreated: db.environments.filter((e) => e.userId === u.id).length + (Number(u.id.slice(4)) % 9), lastActiveAt: u.lastActiveAt, status: u.status }));
    return paginate(items, query);
  }],
  ['GET', '/faculty/students/:id', [F, A], ({ params }) => {
    const u = db.users.find((x) => x.id === params.id && x.role === S) ?? notFound('Student');
    const envs = db.environments.filter((e) => e.userId === u.id).map(publicEnv);
    const base = studentHours(u.id);
    return ok({
      student: publicUser(u),
      environments: envs,
      usageByDay: Array.from({ length: 7 }, (_, i) => ({ date: daysAgo(6 - i).slice(0, 10), hours: +((base / 7) * (0.4 + ((i * 7 + base) % 10) / 8)).toFixed(1) })),
      recentActivity: [
        ...envs.slice(0, 3).map((e) => ({ message: `${e.status === 'running' ? 'Is working in' : 'Used'} ${e.name} (${e.labType})`, at: e.lastActivityAt })),
        { message: 'Logged in', at: u.lastActiveAt },
      ],
    });
  }],
  // Activities assigned to the signed-in student, with that student's own progress and submission
  ['GET', '/assignments', [S], ({ user }) => ok(db.activities
    .filter((a) => a.assignTo.type === 'class' || a.assignTo.studentIds.includes(user.id))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((a) => assignmentView(a, user))) ],
  ['GET', '/assignments/workspace', [S], () => ok([
    { name: 'loops-practice', type: 'folder', sizeBytes: 0, modifiedAt: nowIso() },
    { name: 'portfolio-site', type: 'folder', sizeBytes: 0, modifiedAt: nowIso() },
    { name: 'scratch', type: 'folder', sizeBytes: 0, modifiedAt: nowIso() },
    { name: 'notes.txt', type: 'file', sizeBytes: 420, modifiedAt: nowIso() },
  ])],
  ['POST', '/assignments/:id/submit', [S], ({ user, params, body }) => {
    const a = db.activities.find((x) => x.id === params.id && (x.assignTo.type === 'class' || x.assignTo.studentIds.includes(user.id))) ?? notFound('Activity');
    if ((body?.note ?? '').length > 1000) fail(422, E.VALIDATION_ERROR, 'Validation failed', { note: 'is too long' });
    db.submissions ??= [];
    const existing = db.submissions.find((x) => x.activityId === a.id && x.userId === user.id);
    const lock = mockLock(a, existing);
    if (!lock.canSubmit) fail(409, E.INVALID_STATE, LOCK_MESSAGE[lock.lockedReason]);
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    if (existing) Object.assign(existing, { note: body?.note?.trim() || null, submittedAt: nowIso(), paths });
    else {
      db.submissions.push({ activityId: a.id, userId: user.id, note: body?.note?.trim() || null, submittedAt: nowIso(), paths });
      a.progress.completed += 1;
      if (a.progress.inProgress > 0) a.progress.inProgress -= 1;
    }
    return ok(assignmentView(a, user), existing ? 200 : 201);
  }],
  ['GET', '/faculty/activities/:id/submissions', [F, A], ({ params }) => {
    const a = db.activities.find((x) => x.id === params.id) ?? notFound('Activity');
    const targets = db.users.filter((u) => u.role === S && u.status === 'active' && (a.assignTo.type === 'class' || a.assignTo.studentIds.includes(u.id)));
    return ok(targets.map((u) => {
      const sub = (db.submissions ?? []).find((x) => x.activityId === a.id && x.userId === u.id);
      const started = db.environments.some((e) => e.userId === u.id && e.labId === a.labId && e.createdAt >= a.createdAt);
      return {
        studentId: u.id, name: u.name, rollNo: u.rollNo ?? null, email: u.email,
        status: sub ? 'submitted' : started ? 'inProgress' : 'assigned',
        submittedAt: sub?.submittedAt ?? null, late: sub ? new Date(sub.submittedAt) > new Date(a.dueDate) : false, note: sub?.note ?? null, paths: sub?.paths ?? [],
        marks: sub?.marks ?? null, feedback: sub?.feedback ?? null, gradedAt: sub?.gradedAt ?? null, maxMarks: a.maxMarks ?? 100,
      };
    }));
  }],
  ['PUT', '/faculty/activities/:id/submissions/:studentId/grade', [F, A], ({ params, body }) => {
    const a = db.activities.find((x) => x.id === params.id) ?? notFound('Activity');
    const sub = (db.submissions ?? []).find((x) => x.activityId === a.id && x.userId === params.studentId) ?? notFound('Submission');
    const max = a.maxMarks ?? 100;
    validate([['marks', `must be a number from 0 to ${max}`, typeof body?.marks !== 'number' || body.marks < 0 || body.marks > max]]);
    Object.assign(sub, { marks: body.marks, feedback: body.feedback?.trim() || null, gradedAt: nowIso() });
    const u = db.users.find((x) => x.id === params.studentId);
    return ok({ studentId: u.id, name: u.name, rollNo: u.rollNo ?? null, email: u.email, status: 'submitted', submittedAt: sub.submittedAt, late: new Date(sub.submittedAt) > new Date(a.dueDate), note: sub.note ?? null, marks: sub.marks, feedback: sub.feedback, gradedAt: sub.gradedAt, maxMarks: max });
  }],
  ['GET', '/faculty/activities/:id/submissions/:studentId/files', [F, A], ({ params, query }) => {
    if (!(db.submissions ?? []).some((x) => x.activityId === params.id && x.userId === params.studentId)) notFound('Submission');
    const t = new Date().toISOString();
    const tree = {
      '/': [{ name: 'main.py', path: '/main.py', type: 'file', sizeBytes: 1840, modifiedAt: t }, { name: 'notes.txt', path: '/notes.txt', type: 'file', sizeBytes: 96, modifiedAt: t }, { name: 'src', path: '/src', type: 'folder', sizeBytes: 0, modifiedAt: t }],
      '/src': [{ name: 'util.py', path: '/src/util.py', type: 'file', sizeBytes: 420, modifiedAt: t }],
    };
    return paginate(tree[query.path || '/'] ?? notFound('Path'), { pageSize: 100 });
  }],
  ['GET', '/faculty/activities/:id/submissions/:studentId/files/download', [F, A], ({ query }) => {
    const name = String(query.path).split('/').pop();
    return { status: 200, blob: new Blob([`# ${name}\n# Mock download from CloudLab\n`], { type: 'text/plain' }), filename: name };
  }],
  ['GET', '/faculty/activities', [F, A], () => paginate([...db.activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), { pageSize: 100 })],
  ['PATCH', '/faculty/activities/:id', [F], ({ params, body }) => {
    const a = db.activities.find((x) => x.id === params.id) ?? notFound('Activity');
    if (typeof body?.closed === 'boolean') a.closed = body.closed;
    if (['allow', 'block'].includes(body?.latePolicy)) a.latePolicy = body.latePolicy;
    if (body?.dueDate) a.dueDate = body.dueDate;
    return ok(a);
  }],
  ['POST', '/faculty/activities/:id/submissions/:studentId/reopen', [F], ({ params }) => {
    const sub = (db.submissions ?? []).find((x) => x.activityId === params.id && x.userId === params.studentId) ?? notFound('Submission');
    Object.assign(sub, { marks: null, feedback: null, gradedAt: null });
    return ok({ studentId: params.studentId, status: 'submitted', marks: null });
  }],
  ['POST', '/faculty/activities', [F], ({ user, body }) => {
    validate([
      ['title', 'is required', !body?.title?.trim()],
      ['labId', 'must be an enabled lab', !db.labs.find((l) => l.id === body?.labId && l.enabled && !l.comingSoon)],
      ['dueDate', 'must be a future date', !(body?.dueDate && new Date(body.dueDate) > new Date())],
      ['assignTo', 'pick the class or at least one student', !(body?.assignTo?.type === 'class' || (body?.assignTo?.type === 'students' && body.assignTo.studentIds?.length))],
    ]);
    const count = body.assignTo.type === 'class' ? db.users.filter((u) => u.role === S && u.status === 'active').length : body.assignTo.studentIds.length;
    const act = {
      id: nextId('act'), title: body.title.trim(), description: body.description ?? '', labId: body.labId, datasetId: body.datasetId || null,
      dueDate: body.dueDate, maxMarks: Number.isInteger(body.maxMarks) ? body.maxMarks : 100, latePolicy: body.latePolicy === 'block' ? 'block' : 'allow', closed: false, assignTo: { type: body.assignTo.type, studentIds: body.assignTo.type === 'students' ? body.assignTo.studentIds : [] },
      progress: { assigned: count, inProgress: 0, completed: 0 }, createdBy: user.id, createdAt: nowIso(),
    };
    db.activities.push(act);
    return ok(act, 201);
  }],
  ['GET', '/faculty/activities/:id', [F, A], ({ params }) => ok(db.activities.find((a) => a.id === params.id) ?? notFound('Activity'))],
  ['GET', '/faculty/sessions', [F, A], ({ query }) => {
    let items = db.environments.filter((e) => e.status !== ENV_STATUS.QUEUED && e.status !== ENV_STATUS.REQUESTED);
    if (query.labType) items = items.filter((e) => e.labType === query.labType);
    if (query.from) items = items.filter((e) => e.createdAt >= query.from);
    if (query.to) items = items.filter((e) => e.createdAt <= query.to);
    const rows = items.map((e) => {
      const end = e.stoppedAt ? new Date(e.stoppedAt) : new Date();
      const start = new Date(e.startedAt ?? e.createdAt);
      return { environmentId: e.id, studentName: e.userName, labType: e.labType, status: e.status, durationMinutes: Math.max(0, Math.round((end - start) / MIN)), cpuPercent: e.usage.cpuPercent, memoryPercent: e.usage.memoryPercent };
    });
    return paginate(rows, query);
  }],
  ['GET', '/faculty/usage/summary', [F, A], () => ok({
    mostUsedLabs: [{ labType: 'python', count: 48 }, { labType: 'java', count: 31 }, { labType: 'web', count: 22 }],
    hoursPerStudent: db.users.filter((u) => u.role === S).map((u) => ({ userId: u.id, name: u.name, hours: studentHours(u.id) })).sort((a, b) => b.hours - a.hours),
  })],

  // 7.8 Admin
  ['GET', '/admin/overview', [A], () => {
    const envs = db.environments;
    const count = (s) => envs.filter((e) => e.status === s).length;
    const ws = workers();
    const series = (base, amp) => Array.from({ length: 60 }, (_, i) => ({ t: ago(59 - i), value: Math.round(clamp(base + Math.sin(i / 6) * amp + (Math.random() - 0.5) * amp, 5, 98)) }));
    const usedGb = db.storage.folders.reduce((s, f) => s + f.usedGb, 0);
    return ok({
      stats: {
        activeLabs: count('running') + count('inactive') + count('provisioning'),
        runningContainers: count('running') + count('inactive'),
        cpuPercent: Math.round(ws.reduce((s, w) => s + w.cpuPercent, 0) / ws.length),
        memoryPercent: Math.round(ws.reduce((s, w) => s + w.memoryPercent, 0) / ws.length),
        storagePercent: Math.round((usedGb / db.storage.totalGb) * 100),
      },
      cpuSeries: series(62, 10),
      memorySeries: series(72, 6),
      stateBreakdown: { running: count('running'), inactive: count('inactive'), stopped: count('stopped'), failed: count('failed') },
      alerts: db.alerts,
    });
  }],
  ['GET', '/admin/infrastructure', [A], () => {
    const ws = db.nodes.filter((n) => n.kind === 'worker');
    const usedGb = +db.storage.folders.reduce((s, f) => s + f.usedGb, 0).toFixed(1);
    const live = ws.filter((w) => db.scaling.workers[w.id].power === 'on');
    return ok({
      nodes: db.nodes.map((n) => (n.kind === 'worker' ? { ...n, power: db.scaling.workers[n.id].power, status: db.scaling.workers[n.id].power === 'on' ? n.status : 'offline' } : n)),
      clusterCapacity: { slotsUsed: live.reduce((s, w) => s + w.slotsUsed, 0), slotsTotal: live.reduce((s, w) => s + w.slotsTotal, 0) },
      queue: { length: queue().length, items: queue().map((e) => ({ environmentId: e.id, userName: e.userName, labType: e.labType, waitingSince: e.createdAt })) },
      storage: { bucket: db.storage.bucket, usedGb, totalGb: db.storage.totalGb, folders: db.storage.folders },
    });
  }],
  ['GET', '/admin/scaling', [A], () => ok(scalingStatus())],
  ['PUT', '/admin/scaling', [A], ({ user, body }) => {
    validate([['autoEnabled', 'must be true or false', typeof body?.autoEnabled !== 'boolean']]);
    db.scaling.autoEnabled = body.autoEnabled;
    audit(user, 'scaling.auto', body.autoEnabled ? 'on' : 'off');
    return ok(scalingStatus());
  }],
  ['POST', '/admin/scaling/workers/:id/scale-out', [A], ({ user, params }) => {
    const w = db.scaling.workers[params.id];
    if (!w) fail(404, E.NOT_FOUND, 'Worker not found');
    if (w.power !== 'off') fail(409, E.INVALID_STATE, `${params.id} is already ${w.power}`);
    w.power = 'starting'; w.since = nowIso();
    db.scaling.events.unshift({ id: nextId('evt'), at: nowIso(), workerId: params.id, action: 'scale_out', source: 'manual', reason: `Started by ${user.name}. VM start requested`, ok: true });
    audit(user, 'scaling.scale_out', params.id);
    setTimeout(() => { w.power = 'on'; w.since = nowIso(); db.scaling.events.unshift({ id: nextId('evt'), at: nowIso(), workerId: params.id, action: 'scale_out', source: 'auto', reason: 'Worker is online and accepting labs', ok: true }); }, 4000);
    return ok(scalingStatus());
  }],
  ['POST', '/admin/scaling/workers/:id/scale-in', [A], ({ user, params }) => {
    const w = db.scaling.workers[params.id];
    const node = db.nodes.find((n) => n.id === params.id);
    if (!w) fail(404, E.NOT_FOUND, 'Worker not found');
    if (w.power !== 'on') fail(409, E.INVALID_STATE, `${params.id} is not on (it is ${w.power})`);
    if (node.slotsUsed > 0) fail(409, E.INVALID_STATE, `${node.name} still runs ${node.slotsUsed} lab${node.slotsUsed > 1 ? 's' : ''}. Stop them first`);
    if (Object.values(db.scaling.workers).filter((x) => x.power === 'on').length < 2) fail(409, E.INVALID_STATE, 'At least one worker must stay on');
    w.power = 'off'; w.since = nowIso();
    db.scaling.events.unshift({ id: nextId('evt'), at: nowIso(), workerId: params.id, action: 'scale_in', source: 'manual', reason: `Stopped by ${user.name}. VM deallocation requested`, ok: true });
    audit(user, 'scaling.scale_in', params.id);
    return ok(scalingStatus());
  }],
  ['GET', '/admin/users', [A], ({ query }) => {
    const q = (query.search || '').toLowerCase();
    let items = db.users.map(publicUser);
    if (query.role) items = items.filter((u) => u.role === query.role);
    if (query.status) items = items.filter((u) => u.status === query.status);
    if (q) items = items.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q));
    return paginate(items, query);
  }],
  ['POST', '/admin/users', [A], ({ user, body }) => {
    const email = body?.email?.trim().toLowerCase();
    validate([
      ['name', 'is required', !body?.name?.trim()],
      ['email', 'must be a valid email', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')],
      ['role', 'must be student, faculty or admin', !Object.values(ROLE).includes(body?.role)],
      ['password', 'must be at least 8 characters', (body?.password ?? '').length < 8],
      ['rollNo', 'is required for students', body?.role === S && !body?.rollNo?.trim()],
    ]);
    if (db.users.some((u) => u.email === email)) fail(409, E.EMAIL_EXISTS, 'A user with this email already exists');
    const u = { id: nextId('usr'), name: body.name.trim(), email, role: body.role, status: 'active', rollNo: body.role === S ? body.rollNo.trim() : null, createdAt: nowIso(), lastActiveAt: null, password: body.password };
    db.users.push(u);
    audit(user, 'user.create', `${u.id} ${u.name}`);
    return ok(publicUser(u), 201);
  }],
  ['PATCH', '/admin/users/:id', [A], ({ user, params, body }) => {
    const u = db.users.find((x) => x.id === params.id) ?? notFound('User');
    validate([
      ['role', 'must be student, faculty or admin', body?.role !== undefined && !Object.values(ROLE).includes(body.role)],
      ['status', 'must be active, inactive, pending or rejected', body?.status !== undefined && !Object.values(USER_STATUS).includes(body.status)],
    ]);
    if (u.id === user.id && (body.status === 'inactive' || (body.role && body.role !== A))) fail(409, E.INVALID_STATE, "You can't deactivate or demote your own account");
    if (body.status === USER_STATUS.ACTIVE && [USER_STATUS.PENDING, USER_STATUS.REJECTED].includes(u.status)) { u.approvedBy = user.name; u.approvedAt = nowIso(); }
    for (const k of ['name', 'role', 'status']) if (body[k] !== undefined) u[k] = body[k];
    if (u.role !== S) u.rollNo = null;
    audit(user, 'user.update', `${u.id} ${Object.keys(body).map((k) => `${k}=${body[k]}`).join(', ')}`);
    return ok(publicUser(u));
  }],
  ['GET', '/admin/policy', [A], () => ok(db.policy)],
  ['PUT', '/admin/policy', [A], ({ user, body }) => {
    validate([
      ['autoStopEnabled', 'must be true or false', typeof body?.autoStopEnabled !== 'boolean'],
      ['inactivityMinutes', `must be between ${LIMITS.inactivityMin} and ${LIMITS.inactivityMax}`, !(body?.inactivityMinutes >= LIMITS.inactivityMin && body?.inactivityMinutes <= LIMITS.inactivityMax)],
      ['maxLabsPerWorker', `must be between ${LIMITS.maxLabsPerWorkerMin} and ${LIMITS.maxLabsPerWorkerMax}`, !(body?.maxLabsPerWorker >= LIMITS.maxLabsPerWorkerMin && body?.maxLabsPerWorker <= LIMITS.maxLabsPerWorkerMax)],
    ]);
    const before = { ...db.policy };
    db.policy = { autoStopEnabled: body.autoStopEnabled, inactivityMinutes: body.inactivityMinutes, maxLabsPerWorker: body.maxLabsPerWorker };
    const changed = Object.keys(db.policy).filter((k) => db.policy[k] !== before[k]).map((k) => `${k} ${before[k]} → ${db.policy[k]}`);
    if (changed.length) audit(user, 'policy.update', changed.join(', '));
    return ok(db.policy);
  }],
  ['GET', '/admin/policy/auto-stop-log', [A], ({ query }) => paginate(db.autoStopLog, query)],
  ['GET', '/admin/analytics', [A], () => ok(analytics())],
  ['GET', '/admin/analytics/export', [A], () => {
    const a = analytics();
    const csv = ['date,labsCreated', ...a.labsCreatedPerDay.map((d) => `${d.date},${d.count}`), '', 'template,count', ...a.mostUsedTemplates.map((t) => `${t.name},${t.count}`), '', 'student,hours', ...a.topStudents.map((s) => `${s.name},${s.hours}`)].join('\n');
    return { status: 200, blob: new Blob([csv], { type: 'text/csv' }), filename: `cloudlab-analytics-${nowIso().slice(0, 10)}.csv` };
  }],
  ['GET', '/admin/settings', [A], () => ok(db.settings)],
  ['PUT', '/admin/settings', [A], ({ user, body }) => {
    validate([
      ['region', 'is required', !body?.region],
      ['defaults.cpu', 'must be 1 or 2', ![1, 2].includes(body?.defaults?.cpu)],
      ['defaults.memoryGb', 'must be 1 or 2', ![1, 2].includes(body?.defaults?.memoryGb)],
      ['defaults.storageGb', 'must be between 1 and 5', !(body?.defaults?.storageGb >= 1 && body?.defaults?.storageGb <= 5)],
    ]);
    db.settings = { region: body.region, defaults: { ...body.defaults } };
    audit(user, 'settings.update', `region=${body.region}`);
    return ok(db.settings);
  }],
  ['GET', '/admin/audit-log', [A], ({ query }) => paginate(db.auditLog, query)],
];

function analytics() {
  const perDay = [5, 8, 6, 3, 2, 11, 14, 12, 9, 10, 4, 3, 13, 15];
  return {
    labsCreatedPerDay: perDay.map((count, i) => ({ date: daysAgo(13 - i).slice(0, 10), count })),
    mostUsedTemplates: [
      { labId: 'lab_python', name: 'Python Development', count: 48 },
      { labId: 'lab_java', name: 'Java Development', count: 31 },
      { labId: 'lab_web', name: 'Web Development', count: 22 },
    ],
    topStudents: db.users.filter((u) => u.role === S).map((u) => ({ userId: u.id, name: u.name, hours: studentHours(u.id) })).sort((a, b) => b.hours - a.hours).slice(0, 5),
    avgSessionMinutes: 52,
    counts: { stopped: db.environments.filter((e) => e.status === 'stopped').length + 37, terminated: db.environments.filter((e) => e.status === 'terminated').length + 12 },
  };
}

// ── Router ───────────────────────────────────────────────────────────────────
const compiled = routes.map(([method, path, who, handler]) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  return { method, re, keys, who, handler };
});

/**
 * Handle one request. Returns { status, headers, body } or { status, headers, blob, filename }.
 * `path` is relative to the API base, e.g. "/environments/env_5001".
 */
export async function handleMockRequest({ method, path, query = {}, body, headers = {} }) {
  const requestId = 'req_' + Math.random().toString(36).slice(2, 10);
  const resHeaders = { 'X-Request-Id': requestId };
  try {
    const match = compiled.map((r) => ({ r, m: r.method === method && path.match(r.re) })).find((x) => x.m);
    if (!match) fail(404, E.NOT_FOUND, `No endpoint ${method} ${path}`);
    const { r, m } = match;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let user = null;
    if (r.who !== 'public') {
      user = userFromToken(headers.Authorization);
      if (Array.isArray(r.who) && !r.who.includes(user.role)) forbidden();
    }
    tick(user?.id);
    const res = await r.handler({ user, params, query, body });
    persist();
    return { ...res, headers: resHeaders };
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status, headers: resHeaders, body: { error: { code: err.code, message: err.message, details: err.details } } };
    }
    console.error(`[mock ${requestId}]`, err);
    return { status: 500, headers: resHeaders, body: { error: { code: E.INTERNAL_ERROR, message: 'Something went wrong in the mock server', details: {} } } };
  }
}

// Demo accounts shown on the login page
export const DEMO_ACCOUNTS = {
  student: { email: 'anushka@gbs.edu', password: 'student123' },
  faculty: { email: 'sonia@gbs.edu', password: 'faculty123' },
  admin: { email: 'admin@gbs.edu', password: 'admin123' },
};
