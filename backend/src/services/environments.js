const fsp = require('fs/promises');
const path = require('path');
const {
  ENV_STATUS: S, STEPS, STEP_STATE, SIZE_PRESETS, SLOT_STATUSES, ACTIVE_STATUSES, ROLE,
} = require('../constants');
const { newId } = require('../lib/ids');
const { nowIso, mono, toMs, isoFromMs, pub } = require('../lib/time');
const { E } = require('../lib/errors');
const ser = require('../lib/serializers');

// What a student sees when a provisioning step fails. Technical detail goes to the log and audit trail.
const FRIENDLY = [
  'The request could not be validated.',
  'The worker server could not be reached.',
  'The lab image could not be prepared.',
  'The container could not be created.',
  'The CPU and memory limits could not be applied.',
  'The storage could not be mounted.',
  'The lab did not become ready in time.',
];

const STOP_TEXT = {
  user: (n) => `Stopped lab "${n}"`,
  admin: (n) => `Lab "${n}" was stopped by an administrator`,
  idle: (n, x) => `Lab "${n}" stopped automatically after ${x.idleMinutes} minutes of inactivity`,
  session: (n) => `Lab "${n}" stopped: requested session time reached`,
  scheduled: (n) => `Lab "${n}" stopped by the daily scheduled shutdown`,
  reconciliation: (n) => `Lab "${n}" stopped: its container was no longer running`,
  memory_limit: (n) => `Lab "${n}" stopped: it used more memory than its limit`,
  deactivated: (n) => `Lab "${n}" stopped: the account was deactivated`,
};

const initSteps = (activeIdx = -1) =>
  STEPS.map((s, i) => ({ key: s.key, label: s.label, state: i === activeIdx ? STEP_STATE.ACTIVE : STEP_STATE.PENDING }));

class EnvironmentService {
  constructor(ctx) {
    this.ctx = ctx;
    this.locks = new Map(); // envId -> promise chain (one operation at a time per environment)
    this.cancelled = new Set(); // envIds whose provisioning should stop at the next step
    this.running = new Set(); // envIds being provisioned by this process right now
    this.queueBusy = false;
    this.queueAgain = false;
  }

  // ---- plumbing ------------------------------------------------------------------------------
  async withLock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    const chain = prev.then(() => mine);
    this.locks.set(id, chain);
    await prev;
    try { return await fn(); } finally {
      release();
      if (this.locks.get(id) === chain) this.locks.delete(id);
    }
  }

  _q(db = this.ctx.db) {
    return db('environments as e').join('users as u', 'u.id', 'e.user_id').select('e.*', 'u.name as user_name', 'u.role as user_role');
  }
  row(id, db) { return this._q(db).where('e.id', id).first(); }

  async queuePositions() {
    const rows = await this.ctx.db('environments').where({ status: S.QUEUED }).orderBy('queued_seq').pluck('id');
    return new Map(rows.map((id, i) => [id, i + 1]));
  }

  async view(idOrRow) {
    const row = typeof idOrRow === 'string' ? await this.row(idOrRow) : idOrRow;
    const policy = await this.ctx.policy.get();
    const pos = row.status === S.QUEUED ? (await this.queuePositions()).get(row.id) ?? null : null;
    return ser.env(row, { queuePosition: pos, policy });
  }

  // ---- queries -------------------------------------------------------------------------------
  async list(user, f) {
    const q = this._q();
    if (user.role === ROLE.STUDENT) q.where('e.user_id', user.id);
    else {
      if (user.role === ROLE.FACULTY) q.where('u.role', ROLE.STUDENT);
      if (f.userId) q.where('e.user_id', f.userId);
      if (f.workerId && user.role === ROLE.ADMIN) q.where('e.worker_id', f.workerId);
    }
    if (f.labType) q.where('e.lab_type', f.labType);
    if (f.status?.length) q.whereIn('e.status', f.status);
    else if (!f.includeTerminated) q.whereNot('e.status', S.TERMINATED);
    const total = Number((await q.clone().clearSelect().count({ n: '*' }).first()).n);
    const rows = await q.orderBy('e.created_at', 'desc').orderBy('e.id').limit(f.pageSize).offset(f.offset);
    const policy = await this.ctx.policy.get();
    const pos = await this.queuePositions();
    return { items: rows.map((r) => ser.env(r, { queuePosition: pos.get(r.id) ?? null, policy })), total };
  }

  /** GET one: students see their own, faculty see students', admins see all. Others get 404. */
  async get(user, id) {
    const row = await this.row(id);
    if (!row) throw E.notFound('Environment not found');
    if (user.role === ROLE.STUDENT && row.user_id !== user.id) throw E.notFound('Environment not found');
    if (user.role === ROLE.FACULTY && row.user_role !== ROLE.STUDENT) throw E.notFound('Environment not found');
    return this.view(row);
  }

  async _writable(user, id) {
    const row = await this.row(id);
    if (!row || (user.role === ROLE.STUDENT && row.user_id !== user.id)) throw E.notFound('Environment not found');
    return row;
  }
  async _owned(user, id) {
    const row = await this.row(id);
    if (!row || row.user_id !== user.id) throw E.notFound('Environment not found');
    return row;
  }

  // ---- slots & queue (BRD BR-09: reserve in one transaction before any container exists) -----
  async _allocPort(trx, workerId, env) {
    if (env.container_id && env.worker_id === workerId && env.host_port) return env.host_port; // stopped container keeps its port
    const used = new Set(await trx('environments').where({ worker_id: workerId }).whereNotNull('host_port').whereNot({ id: env.id }).pluck('host_port'));
    const { hostPortMin: lo, hostPortMax: hi } = this.ctx.cfg;
    for (let p = lo; p <= hi; p++) if (!used.has(p)) return p;
    return null;
  }

  /** Decide what happens to a request: take a slot, wait in the queue, or be refused. Must run inside trx. */
  async _reserve(trx, env, { ignoreQueue = false } = {}) {
    const policy = await this.ctx.policy.row(trx);
    const workers = await trx('nodes').where({ kind: 'worker', enabled: 1 }).forUpdate().orderBy('id');
    const used = await this.ctx.nodes.slotsUsedMap(trx);
    const queued = Number((await trx('environments').where({ status: S.QUEUED }).count({ n: '*' }).first()).n);
    let cands = workers.filter((w) => w.status !== 'offline' && (used.get(w.id) || 0) < policy.max_labs_per_worker);
    if (!ignoreQueue && queued > 0) cands = []; // first come, first served
    cands.sort((a, b) => (a.id === env.worker_id ? -1 : b.id === env.worker_id ? 1 : (used.get(a.id) || 0) - (used.get(b.id) || 0)));
    for (const w of cands) {
      const port = await this._allocPort(trx, w.id, env);
      if (port != null) return { kind: 'slot', worker: w, hostPort: port };
    }
    if (ignoreQueue) return { kind: 'queue' };
    if (queued >= this.ctx.cfg.limits.maxQueueLength) return { kind: 'full' };
    return { kind: 'queue' };
  }

  async _applySlot(trx, env, r) {
    let removeOld = null;
    const upd = {
      status: S.PROVISIONING, worker_id: r.worker.id, host_port: r.hostPort, queued_seq: null,
      steps_json: JSON.stringify(initSteps(0)), current_step: 1, failure_reason: null, updated_at: nowIso(),
    };
    if (env.container_id && env.worker_id && env.worker_id !== r.worker.id) {
      removeOld = { nodeId: env.worker_id, containerId: env.container_id };
      upd.container_id = null;
    }
    await trx('environments').where({ id: env.id }).update(upd);
    return removeOld;
  }

  async _assertActiveLimit(trx, userId, excludeId) {
    const q = trx('environments').where({ user_id: userId }).whereIn('status', ACTIVE_STATUSES);
    if (excludeId) q.whereNot({ id: excludeId });
    const n = Number((await q.count({ n: '*' }).first()).n);
    const max = this.ctx.cfg.limits.maxActiveEnvsPerStudent;
    if (n >= max) throw E.invalidState(`You already have ${n} active labs (limit ${max}). Stop or delete one first.`);
  }

  async processQueue() {
    if (this.queueBusy) { this.queueAgain = true; return; }
    this.queueBusy = true;
    try {
      do {
        this.queueAgain = false;
        for (;;) {
          const started = await this.ctx.db.transaction(async (trx) => {
            const head = await trx('environments').where({ status: S.QUEUED }).orderBy('queued_seq').first();
            if (!head) return null;
            const r = await this._reserve(trx, head, { ignoreQueue: true });
            if (r.kind !== 'slot') return null;
            const removeOld = await this._applySlot(trx, head, r);
            return { id: head.id, removeOld };
          });
          if (!started) break;
          this._runDetached(started.id, { removeOld: started.removeOld });
        }
      } while (this.queueAgain);
    } catch (e) {
      this.ctx.log.error({ err: e.message }, 'queue processing failed');
    } finally {
      this.queueBusy = false;
    }
  }

  // ---- create / start / restart --------------------------------------------------------------
  async create(user, { labId, name, size, durationMinutes }) {
    const { db } = this.ctx;
    const lab = await db('labs').where({ id: labId }).first();
    if (!lab) throw E.validation({ labId: 'does not exist' });
    if (!lab.enabled || lab.coming_soon) throw E.validation({ labId: 'is not available yet' });
    const preset = SIZE_PRESETS[size];
    const id = newId('env');
    const now = nowIso();
    const base = {
      id, name, user_id: user.id, lab_id: lab.id, lab_type: lab.type, status: S.REQUESTED, size,
      cpu: Math.min(preset.cpu, lab.cpu), memory_gb: Math.min(preset.memoryGb, lab.memory_gb), storage_gb: lab.storage_gb,
      docker_image: lab.docker_image, steps_json: JSON.stringify(initSteps()), current_step: 0,
      duration_minutes: durationMinutes, created_at: now, updated_at: now,
    };
    const out = await db.transaction(async (trx) => {
      await this._assertActiveLimit(trx, user.id, null);
      await trx('environments').insert(base);
      const r = await this._reserve(trx, base);
      if (r.kind === 'full') throw E.capacityFull();
      if (r.kind === 'queue') {
        await trx('environments').where({ id }).update({ status: S.QUEUED, queued_seq: mono(), updated_at: now });
        return { queued: true };
      }
      await this._applySlot(trx, base, r);
      return { queued: false };
    });
    await this.ctx.audit.event(id, user.id, 'created', `Created lab "${name}" (${lab.type})`);
    if (!out.queued) this._runDetached(id);
    return this.view(id);
  }

  async start(user, id) {
    const env = await this._writable(user, id);
    if (env.status !== S.STOPPED) throw E.invalidState(`Cannot start a lab that is ${env.status}`);
    return this._activate(env);
  }

  async restart(user, id) {
    const env = await this._writable(user, id);
    if (env.status === S.RUNNING || env.status === S.INACTIVE) {
      // Keeps its slot: running -> provisioning -> running.
      const now = nowIso();
      const n = await this.ctx.db('environments').where({ id }).whereIn('status', [S.RUNNING, S.INACTIVE]).update({
        status: S.PROVISIONING, steps_json: JSON.stringify(initSteps(0)), current_step: 1, failure_reason: null, updated_at: now,
      });
      if (!n) throw E.invalidState('Lab changed state, please try again');
      await this._closeSession(id, now);
      await this.ctx.audit.event(id, env.user_id, 'restarted', `Restarted lab "${env.name}"`);
      this._runDetached(id, { restart: true });
      return this.view(id);
    }
    if (env.status === S.STOPPED || env.status === S.FAILED) return this._activate(env);
    throw E.invalidState(`Cannot restart a lab that is ${env.status}`);
  }

  async _activate(env) {
    const { db } = this.ctx;
    const out = await db.transaction(async (trx) => {
      const cur = await trx('environments').where({ id: env.id }).first();
      if (!cur || (cur.status !== S.STOPPED && cur.status !== S.FAILED)) throw E.invalidState('Lab changed state, please try again');
      await this._assertActiveLimit(trx, cur.user_id, cur.id);
      const r = await this._reserve(trx, cur);
      if (r.kind === 'full') throw E.capacityFull();
      if (r.kind === 'queue') {
        await trx('environments').where({ id: cur.id }).update({
          status: S.QUEUED, queued_seq: mono(), steps_json: JSON.stringify(initSteps()), current_step: 0, failure_reason: null, updated_at: nowIso(),
        });
        return { queued: true };
      }
      const removeOld = await this._applySlot(trx, cur, r);
      return { queued: false, removeOld };
    });
    await this.ctx.audit.event(env.id, env.user_id, 'started', `Starting lab "${env.name}"`);
    if (!out.queued) this._runDetached(env.id, { removeOld: out.removeOld });
    return this.view(env.id);
  }

  // ---- stop / delete -------------------------------------------------------------------------
  async stop(user, id) {
    const env = await this._writable(user, id);
    if (env.status !== S.RUNNING && env.status !== S.INACTIVE) throw E.invalidState(`Cannot stop a lab that is ${env.status}`);
    return this.stopEnv(id, user.role === ROLE.ADMIN && env.user_id !== user.id ? 'admin' : 'user');
  }

  /** Stop a live environment. reason: user|admin|idle|session|scheduled|reconciliation|memory_limit|deactivated. */
  async stopEnv(id, reason, { skipDriver = false, idleMinutes = 0 } = {}) {
    const { db, driver, log } = this.ctx;
    const done = await this.withLock(id, async () => {
      const env = await this.row(id);
      if (!env || (env.status !== S.RUNNING && env.status !== S.INACTIVE)) {
        throw E.invalidState(`Cannot stop a lab that is ${env?.status ?? 'missing'}`);
      }
      if (!skipDriver && env.container_id && env.worker_id) {
        try { await driver.stop(await this.ctx.nodes.get(env.worker_id), env.container_id); } catch (e) {
          // Reconciliation stops any container that is still running for a stopped environment.
          log.warn({ err: e.message, envId: id }, 'docker stop failed; marking stopped anyway');
        }
      }
      const now = nowIso();
      await db('environments').where({ id }).update({
        status: S.STOPPED, stopped_at: now, stop_reason: reason, usage_cpu: 0, usage_mem: 0, updated_at: now,
      });
      await this._closeSession(id, now);
      const text = (STOP_TEXT[reason] || STOP_TEXT.user)(env.name, { idleMinutes });
      await this.ctx.audit.event(id, env.user_id, 'stopped', text);
      if (reason === 'idle') {
        await db('auto_stop_log').insert({ env_id: id, user_name: env.user_name, lab_type: env.lab_type, stopped_at: now, idle_minutes: Math.round(idleMinutes) });
      }
      return env;
    });
    this.processQueue();
    return this.view(done.id);
  }

  async remove(user, id) {
    const env = await this._writable(user, id);
    if (env.status === S.TERMINATED) throw E.invalidState('Lab is already deleted');
    return this.terminate(id, user.role === ROLE.ADMIN && env.user_id !== user.id ? 'admin' : 'user');
  }

  /** Remove the container and mark terminated. Workspace files are never touched (BR-06). */
  async terminate(id, reason) {
    const { db, driver, log } = this.ctx;
    const cur = await this.row(id);
    if (cur?.status === S.PROVISIONING) this.cancelled.add(id);
    let env;
    try {
      env = await this.withLock(id, async () => {
      const e = await this.row(id);
      if (!e || e.status === S.TERMINATED) throw E.invalidState('Lab is already deleted');
      if (e.container_id && e.worker_id) {
        try { await driver.remove(await this.ctx.nodes.get(e.worker_id), e.container_id); } catch (err) {
          log.warn({ err: err.message, envId: id }, 'docker rm failed during delete');
        }
      }
      const now = nowIso();
      const wasLive = SLOT_STATUSES.includes(e.status);
      await db('environments').where({ id }).update({
        status: S.TERMINATED, container_id: null, host_port: null, worker_id: null, queued_seq: null,
        stopped_at: wasLive || !e.stopped_at ? now : e.stopped_at, stop_reason: reason, usage_cpu: 0, usage_mem: 0, updated_at: now,
        current_step: e.current_step, failure_reason: null,
      });
      await this._closeSession(id, now);
      await this.ctx.audit.event(id, e.user_id, 'deleted', `Deleted lab "${e.name}"`);
      return e;
      });
    } finally {
      this.cancelled.delete(id);
    }
    this.processQueue();
    return this.view(env.id);
  }

  // ---- heartbeat, access, metrics, datasets --------------------------------------------------
  async heartbeat(user, id, { keepRunning = false } = {}) {
    const env = await this._owned(user, id);
    if (env.status !== S.RUNNING && env.status !== S.INACTIVE) throw E.invalidState(`Lab is ${env.status}`);
    const now = nowIso();
    const upd = { last_heartbeat_at: now };
    if (keepRunning || this.ctx.cfg.jobs.heartbeatCountsAsActivity) {
      upd.last_activity_at = now;
      if (env.status === S.INACTIVE) upd.status = S.RUNNING;
    }
    await this.ctx.db('environments').where({ id }).update(upd);
    this.ctx.users.touch(user.id);
  }

  async access(user, id) {
    const env = await this._owned(user, id);
    if (env.status !== S.RUNNING && env.status !== S.INACTIVE) throw E.invalidState(`Lab is ${env.status}, not running`);
    const cap = Date.now() + 8 * 3600 * 1000;
    const expMs = Math.min(env.session_expires_at ? toMs(env.session_expires_at) : cap, cap);
    const token = this.ctx.auth.signWorkspaceToken(user.id, env.id, expMs);
    const url = `${this.ctx.cfg.publicBaseUrl}/lab/${env.id}/?wt=${token}&folder=/workspace`;
    // The IDE has an integrated terminal, so the terminal URL opens the same workspace.
    return { workspaceUrl: url, terminalUrl: url, expiresAt: pub(isoFromMs(expMs)) };
  }

  async metrics(user, id) {
    const env = user.role === ROLE.ADMIN ? await this._writable(user, id) : await this._owned(user, id);
    const live = env.status === S.RUNNING || env.status === S.INACTIVE;
    const used = await this.ctx.storage.usedBytes(env.user_id);
    const limit = env.storage_gb * 1024 ** 3;
    return {
      cpuPercent: live ? Math.round(env.usage_cpu) : 0,
      memoryPercent: live ? Math.round(env.usage_mem) : 0,
      diskPercent: Math.min(100, Math.round((used / limit) * 100)),
      sampledAt: pub(env.usage_at || nowIso()),
    };
  }

  async mountDataset(user, id, datasetId) {
    const env = await this._owned(user, id);
    if (env.status !== S.RUNNING && env.status !== S.INACTIVE) throw E.invalidState('Datasets can be mounted only while the lab is running');
    const ds = await this.ctx.db('datasets').where({ id: datasetId }).first();
    if (!ds || (ds.scope === 'mine' && ds.uploaded_by !== user.id)) throw E.notFound('Dataset not found');
    try { await fsp.stat(path.join(this.ctx.cfg.storage.root, ds.rel_path)); } catch { throw E.invalidState('The dataset file is missing from storage'); }
    // /data/shared and /data/mine are bind-mounted when the container is created, so the file is already visible.
    await this.ctx.db('env_datasets').insert({ env_id: id, dataset_id: datasetId, mounted_at: nowIso() }).onConflict(['env_id', 'dataset_id']).ignore();
    await this.ctx.audit.event(id, env.user_id, 'dataset', `Mounted dataset ${ds.name}`);
    return { mountPath: ser.dataset(ds).mountPath };
  }

  /** Used by the workspace proxy. Returns null when the lab is not reachable. */
  async workspaceTarget(envId) {
    const env = await this.row(envId);
    if (!env || (env.status !== S.RUNNING && env.status !== S.INACTIVE) || !env.worker_id || !env.host_port) return null;
    const node = await this.ctx.nodes.get(env.worker_id);
    return { env, host: node.internal_ip || '127.0.0.1', port: env.host_port };
  }

  // ---- sessions ------------------------------------------------------------------------------
  async _openSession(env, at) {
    await this.ctx.db('usage_sessions').insert({ env_id: env.id, user_id: env.user_id, lab_type: env.lab_type, started_at: at });
  }
  async _closeSession(envId, at) {
    await this.ctx.db('usage_sessions').where({ env_id: envId }).whereNull('ended_at').update({ ended_at: at });
  }

  // ---- provisioning engine -------------------------------------------------------------------
  _runDetached(id, opts = {}) {
    this._run(id, opts).catch((e) => this.ctx.log.error({ err: e.message, envId: id }, 'provisioning crashed'));
  }

  async _run(id, opts) {
    this.running.add(id);
    try { await this.withLock(id, () => this._runLocked(id, opts)); } finally { this.running.delete(id); }
  }

  async _saveSteps(id, steps, current) {
    await this.ctx.db('environments').where({ id, status: S.PROVISIONING }).update({
      steps_json: JSON.stringify(steps), current_step: current, updated_at: nowIso(),
    });
  }

  async _runLocked(id, { restart = false, removeOld = null } = {}) {
    const { db, driver, cfg, log, storage } = this.ctx;
    let env = await this.row(id);
    if (!env || env.status !== S.PROVISIONING) return; // deleted or changed before we got the lock
    const node = await this.ctx.nodes.get(env.worker_id);
    const steps = initSteps();
    let idx = 0;

    if (removeOld) {
      const old = await this.ctx.nodes.get(removeOld.nodeId);
      driver.remove(old, removeOld.containerId).catch((e) => log.warn({ err: e.message }, 'could not remove old container'));
    }

    const fns = [
      async () => { // validate
        const u = await db('users').where({ id: env.user_id }).first();
        const lab = await db('labs').where({ id: env.lab_id }).first();
        if (!u || u.status !== 'active') throw new Error('account is not active');
        if (!lab) throw new Error('lab template no longer exists');
      },
      async () => { // checkResources: the slot was reserved in the transaction; make sure the worker is reachable
        const p = await driver.ping(node);
        if (!p.ok) throw new Error(`worker unreachable: ${p.error}`);
        await driver.prepareNode(node);
      },
      async () => { await driver.ensureImage(node, env.docker_image); }, // selectTemplate
      async () => { // createContainer
        await storage.ensureStudent(env.user_id);
        if (env.container_id) {
          const info = await driver.inspect(node, env.container_id);
          if (info.exists) return; // reuse the stopped container
          await db('environments').where({ id }).update({ container_id: null });
        }
        const spec = this._spec(env, node);
        await driver.remove(node, spec.name).catch(() => {}); // leftover with the same name from a crash
        const cid = await driver.create(node, spec);
        env.container_id = cid;
        await db('environments').where({ id }).update({ container_id: cid });
      },
      async () => { // allocateResources: verify Docker really applied the limits
        const info = await driver.inspect(node, env.container_id);
        const wantCpu = Math.round(env.cpu * 1e9);
        const wantMem = Math.round(env.memory_gb * 1024 ** 3);
        if (!info.exists) throw new Error('container disappeared');
        if (Math.abs(info.nanoCpus - wantCpu) > wantCpu * 0.01) throw new Error(`cpu limit ${info.nanoCpus} != ${wantCpu}`);
        if (Math.abs(info.memoryBytes - wantMem) > wantMem * 0.01) throw new Error(`memory limit ${info.memoryBytes} != ${wantMem}`);
        if (!(info.pidsLimit > 0)) throw new Error('pids limit not applied');
      },
      async () => { // mountStorage
        const info = await driver.inspect(node, env.container_id);
        const dst = new Set(info.mounts.map((m) => m.destination));
        for (const need of ['/workspace', '/data/shared', '/data/mine']) if (!dst.has(need)) throw new Error(`missing mount ${need}`);
      },
      async () => { // startEnvironment
        let info = await driver.inspect(node, env.container_id);
        if (restart && info.running) { await driver.stop(node, env.container_id); info = { ...info, running: false }; }
        if (!info.running) await driver.start(node, env.container_id);
        const deadline = Date.now() + cfg.driver.healthTimeoutMs;
        for (;;) {
          if (this.cancelled.has(id)) return;
          if (await driver.waitHealthy(node, env.host_port, 3000)) return;
          if (Date.now() > deadline) throw new Error('health check timed out');
        }
      },
    ];

    for (let i = 0; i < fns.length; i++) {
      if (this.cancelled.has(id)) return; // terminate() is waiting for the lock and will clean up
      for (let j = 0; j < steps.length; j++) steps[j].state = j < i ? STEP_STATE.DONE : j === i ? STEP_STATE.ACTIVE : STEP_STATE.PENDING;
      await this._saveSteps(id, steps, i + 1);
      try {
        await fns[i]();
      } catch (e) {
        await this._fail(id, steps, i, e);
        return;
      }
    }
    if (this.cancelled.has(id)) return;

    const now = nowIso();
    steps.forEach((s) => { s.state = STEP_STATE.DONE; });
    const dur = env.duration_minutes;
    const n = await db('environments').where({ id, status: S.PROVISIONING }).update({
      status: S.RUNNING, steps_json: JSON.stringify(steps), current_step: steps.length,
      started_at: now, stopped_at: null, last_activity_at: now, last_heartbeat_at: now, usage_at: now,
      session_expires_at: isoFromMs(Date.now() + dur * 60_000), stop_reason: null, failure_reason: null, updated_at: now,
    });
    if (!n) return;
    await this._openSession(env, now);
    await this.ctx.audit.event(id, env.user_id, 'running', `Lab "${env.name}" is running`);
    this.ctx.users.touch(env.user_id);
  }

  _spec(env, node) {
    const { cfg, storage } = this.ctx;
    const p = storage.workerPaths(env.user_id);
    return {
      name: `cl-${env.id}`, envId: env.id, userId: env.user_id, image: env.docker_image,
      cpu: env.cpu, memoryGb: env.memory_gb, pidsLimit: cfg.driver.pidsLimit,
      bindIp: node.internal_ip || '127.0.0.1', hostPort: env.host_port, containerPort: cfg.driver.containerPort,
      mounts: [
        { src: p.workspace, dst: '/workspace' },
        { src: p.shared, dst: '/data/shared', ro: true },
        { src: p.mine, dst: '/data/mine' },
      ],
      env: { CLOUDLAB_ENV_ID: env.id, CLOUDLAB_USER_ID: env.user_id, CLOUDLAB_LAB_TYPE: env.lab_type },
    };
  }

  async _fail(id, steps, idx, err) {
    const { db, driver, log } = this.ctx;
    log.error({ envId: id, step: steps[idx].key, err: err.message }, 'provisioning step failed');
    steps[idx].state = STEP_STATE.FAILED;
    const env = await this.row(id);
    if (!env || env.status !== S.PROVISIONING) return;
    if (env.container_id && env.worker_id) {
      try { await driver.remove(await this.ctx.nodes.get(env.worker_id), env.container_id); } catch { /* reconciliation removes it */ }
    }
    const reason = `${FRIENDLY[idx]} Please retry, or contact the administrator if it keeps happening.`;
    const now = nowIso();
    await db('environments').where({ id }).update({
      status: S.FAILED, steps_json: JSON.stringify(steps), current_step: idx + 1, failure_reason: reason,
      worker_id: null, container_id: null, host_port: null, stop_reason: 'failure', updated_at: now,
    });
    await this.ctx.audit.event(id, env.user_id, 'failed', `Lab "${env.name}" failed to start: ${FRIENDLY[idx]}`);
    await this.ctx.audit.log(null, 'environment.provisioning_failed', `${id} step=${steps[idx].key} ${String(err.message).slice(0, 120)}`);
    this.processQueue();
  }

  // ---- startup recovery ----------------------------------------------------------------------
  /** Provisioning cannot survive a restart of this process: fail those labs so their slots are freed. */
  async recover() {
    const rows = await this.ctx.db('environments').where({ status: S.PROVISIONING }).select('id', 'user_id', 'name', 'steps_json', 'current_step');
    await this.failInterrupted(rows, 'The server restarted while the lab was starting. Please retry.');
    this.processQueue();
  }

  async failInterrupted(rows, message) {
    for (const r of rows) {
      const steps = JSON.parse(r.steps_json);
      const i = Math.max(0, (r.current_step || 1) - 1);
      steps[i].state = STEP_STATE.FAILED;
      await this.ctx.db('environments').where({ id: r.id }).update({
        status: S.FAILED, steps_json: JSON.stringify(steps), failure_reason: message,
        worker_id: null, container_id: null, host_port: null, stop_reason: 'failure', updated_at: nowIso(),
      });
    }
    if (rows.length) this.ctx.log.warn({ count: rows.length }, 'failed interrupted provisioning');
  }
}

module.exports = { EnvironmentService, initSteps };
