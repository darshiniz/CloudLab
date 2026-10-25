const { E } = require('../lib/errors');
const { nowIso, pub } = require('../lib/time');
const { ENV_STATUS: S, SLOT_STATUSES } = require('../constants');

const POWER = { ON: 'on', STARTING: 'starting', STOPPING: 'stopping', OFF: 'off' };

/**
 * Autoscaler for worker VMs.
 *   Scale out: labs have been waiting in the queue for SCALE_OUT_AFTER_SEC and a worker VM is stopped -> start it.
 *   Scale in:  a worker has had no labs for SCALE_IN_IDLE_MIN, nothing is queued and more than MIN_WORKERS are on -> deallocate it.
 * Manual buttons use the same code. A worker that is "stopping" or "off" never receives new labs (see
 * EnvironmentService._reserve), and a worker with live labs is never stopped. Cool-down and hysteresis prevent flapping.
 */
class Scaler {
  constructor(ctx) {
    this.ctx = ctx;
    this.queueSince = null;
    this.idleSince = new Map(); // nodeId -> ms
    this.lastActionAt = 0;
    this.busy = new Set();
    this.warnedStart = new Set();
  }

  get cloud() { return this.ctx.cloud; }
  get available() { return !!this.ctx.cloud; }

  async init() {
    const { db, cfg } = this.ctx;
    for (const w of cfg.workers) {
      if (!(await db('scaling_state').where({ node_id: w.id }).first())) {
        await db('scaling_state').insert({ node_id: w.id, state: POWER.ON, changed_at: nowIso() });
      }
    }
    if (!(await db('scaling_config').where({ id: 1 }).first())) {
      await db('scaling_config').insert({ id: 1, auto_enabled: cfg.autoscale.enabledAtStart && this.available ? 1 : 0 });
    }
  }

  async autoEnabled() { return !!(await this.ctx.db('scaling_config').where({ id: 1 }).first())?.auto_enabled; }
  async setAuto(on) {
    if (on && !this.available) throw E.invalidState('No cloud provider is configured (set CLOUD_PROVIDER), so automatic scaling is unavailable');
    await this.ctx.db('scaling_config').where({ id: 1 }).update({ auto_enabled: on ? 1 : 0 });
    this.queueSince = null;
    this.idleSince.clear();
  }

  async states(trx = this.ctx.db) {
    const rows = await trx('scaling_state');
    return new Map(rows.map((r) => [r.node_id, r]));
  }
  async powerOf(nodeId) { return (await this.ctx.db('scaling_state').where({ node_id: nodeId }).first())?.state || POWER.ON; }
  async _set(nodeId, state, trx = this.ctx.db) {
    await trx('scaling_state').where({ node_id: nodeId }).update({ state, changed_at: nowIso() });
  }

  /** Called by the monitor when a worker that was "starting" answers: it is part of the cluster now. */
  async markOn(nodeId) {
    if ((await this.powerOf(nodeId)) !== POWER.STARTING) return;
    await this._set(nodeId, POWER.ON);
    this.warnedStart.delete(nodeId);
    await this._event(nodeId, 'scale_out', 'auto', 'Worker is online and accepting labs', true);
    this.ctx.envs.processQueue();
  }

  async _event(nodeId, action, source, reason, ok = true) {
    await this.ctx.db('scaling_events').insert({ at: nowIso(), node_id: nodeId, action, source, reason: String(reason).slice(0, 400), ok: ok ? 1 : 0 });
    this.ctx.log.info({ nodeId, action, source, reason, ok }, 'scaling');
  }

  _worker(nodeId) {
    const w = this.ctx.cfg.workers.find((x) => x.id === nodeId);
    if (!w) throw E.notFound('Worker not found');
    return w;
  }

  /** Start a stopped worker VM. */
  async scaleOut(nodeId, { source = 'manual', reason = 'Started by an administrator' } = {}) {
    const w = this._worker(nodeId);
    if (!this.available) throw E.invalidState('No cloud provider is configured (set CLOUD_PROVIDER)');
    if (this.busy.has(nodeId)) throw E.invalidState('A scaling operation is already running for this worker');
    this.busy.add(nodeId);
    try {
      const state = await this.powerOf(nodeId);
      if (state === POWER.ON || state === POWER.STARTING) throw E.invalidState(`${w.name} is already ${state === POWER.ON ? 'on' : 'starting'}`);
      if (state === POWER.STOPPING) throw E.invalidState(`${w.name} is still shutting down. Try again in a minute`);
      await this._set(nodeId, POWER.STARTING);
      try {
        await this.cloud.startVm(w.vmName);
      } catch (e) {
        await this._set(nodeId, POWER.OFF);
        await this._event(nodeId, 'scale_out', source, `Start failed: ${e.message}`, false);
        throw E.invalidState(`The cloud refused to start ${w.name}: ${e.message}`);
      }
      this.lastActionAt = Date.now();
      await this._event(nodeId, 'scale_out', source, `${reason}. VM start requested`, true);
    } finally { this.busy.delete(nodeId); }
  }

  /** Stop (deallocate) an idle worker VM. Refuses while it has live labs. */
  async scaleIn(nodeId, { source = 'manual', reason = 'Stopped by an administrator' } = {}) {
    const w = this._worker(nodeId);
    if (!this.available) throw E.invalidState('No cloud provider is configured (set CLOUD_PROVIDER)');
    if (this.busy.has(nodeId)) throw E.invalidState('A scaling operation is already running for this worker');
    this.busy.add(nodeId);
    try {
      const { db } = this.ctx;
      // Decide atomically with lab placement: _reserve locks the same node rows.
      await db.transaction(async (trx) => {
        const state = (await trx('scaling_state').where({ node_id: nodeId }).first())?.state || POWER.ON;
        if (state !== POWER.ON) throw E.invalidState(`${w.name} is not on (it is ${state})`);
        await trx('nodes').where({ kind: 'worker' }).forUpdate().select('id');
        const used = (await this.ctx.nodes.slotsUsedMap(trx)).get(nodeId) || 0;
        if (used > 0) throw E.invalidState(`${w.name} still runs ${used} lab${used > 1 ? 's' : ''}. Stop them first`);
        const states = await this.states(trx);
        const others = this.ctx.cfg.workers.filter((x) => x.id !== nodeId && (states.get(x.id)?.state || POWER.ON) !== POWER.OFF && (states.get(x.id)?.state || POWER.ON) !== POWER.STOPPING);
        if (others.length < this.ctx.cfg.autoscale.minWorkers) throw E.invalidState('At least one worker must stay on');
        await this._set(nodeId, POWER.STOPPING, trx);
      });
      try {
        await this.cloud.deallocateVm(w.vmName);
      } catch (e) {
        await this._set(nodeId, POWER.ON);
        await this._event(nodeId, 'scale_in', source, `Stop failed: ${e.message}`, false);
        throw E.invalidState(`The cloud refused to stop ${w.name}: ${e.message}`);
      }
      await this._set(nodeId, POWER.OFF);
      this.lastActionAt = Date.now();
      this.idleSince.delete(nodeId);
      await this._event(nodeId, 'scale_in', source, `${reason}. VM deallocation requested`, true);
    } finally { this.busy.delete(nodeId); }
  }

  /**
   * Keeps the app's idea of each worker's power in line with the real VM, so the daily schedule (VMs started at
   * 08:50 and shut down at 17:00 by Azure, outside this app) does not leave a worker marked "off" while it runs or
   * "on" while it is deallocated. Runs whether or not auto-scaling is switched on. Skips workers that changed state
   * in the last few minutes, because Azure reports the old power state for a while after start/deallocate requests.
   */
  async syncPower(now = Date.now()) {
    if (!this.available) return;
    const states = await this.states();
    for (const w of this.ctx.cfg.workers) {
      const st = states.get(w.id);
      if (!st || this.busy.has(w.id) || now - Date.parse(st.changed_at) < 5 * 60_000) continue;
      let vm;
      try { vm = await this.cloud.powerState(w.vmName); } catch (e) { this.ctx.log.warn({ err: e.message, vm: w.vmName }, 'could not read VM power state'); continue; }
      if ((st.state === POWER.OFF) && vm === 'running') {
        await this._set(w.id, POWER.STARTING); // the monitor marks it on once Docker answers
        await this._event(w.id, 'scale_out', 'schedule', 'VM was started outside the app (daily schedule or portal)', true);
      } else if (st.state === POWER.ON && ['deallocated', 'deallocating', 'stopped', 'stopping'].includes(vm)) {
        await this._set(w.id, POWER.OFF);
        await this._event(w.id, 'scale_in', 'schedule', 'VM was stopped outside the app (daily schedule or portal)', true);
      }
    }
  }

  /** One decision cycle. `now` is injectable for tests. */
  async tick(now = Date.now()) {
    if (!this.available || !(await this.autoEnabled())) { this.queueSince = null; this.idleSince.clear(); return; }
    const { db, cfg } = this.ctx;
    const a = cfg.autoscale;
    const states = await this.states();
    const power = (id) => states.get(id)?.state || POWER.ON;

    // A worker that was asked to start but never answers: say so once, keep waiting (it may still be booting).
    for (const w of cfg.workers) {
      const st = states.get(w.id);
      if (st?.state === POWER.STARTING && now - Date.parse(st.changed_at) > a.startTimeoutSec * 1000 && !this.warnedStart.has(w.id)) {
        this.warnedStart.add(w.id);
        await this._event(w.id, 'scale_out', 'auto', `Worker did not come online within ${a.startTimeoutSec}s. Check the VM in the cloud portal`, false);
      }
    }

    const queued = Number((await db('environments').where({ status: S.QUEUED }).count({ n: '*' }).first()).n);
    if (queued > 0) this.queueSince = this.queueSince ?? now; else this.queueSince = null;
    if (now - this.lastActionAt < a.cooldownSec * 1000) return;

    const starting = cfg.workers.filter((w) => power(w.id) === POWER.STARTING);
    if (queued > 0) {
      this.idleSince.clear();
      if (starting.length === 0 && now - this.queueSince >= a.scaleOutAfterSec * 1000) {
        const off = cfg.workers.find((w) => power(w.id) === POWER.OFF);
        if (off) {
          await this.scaleOut(off.id, { source: 'auto', reason: `${queued} lab${queued > 1 ? 's' : ''} waited in the queue for ${Math.round((now - this.queueSince) / 1000)}s` }).catch((e) => this.ctx.log.warn({ err: e.message }, 'auto scale-out failed'));
        }
      }
      return;
    }

    // Nothing is waiting: consider shutting an idle worker down (highest id first, so worker-1 is the last one standing).
    const used = await this.ctx.nodes.slotsUsedMap();
    const on = cfg.workers.filter((w) => power(w.id) === POWER.ON);
    for (const w of on) {
      if ((used.get(w.id) || 0) === 0) { if (!this.idleSince.has(w.id)) this.idleSince.set(w.id, now); } else this.idleSince.delete(w.id);
    }
    if (on.length + starting.length <= a.minWorkers) return;
    const ripe = [...on].reverse().find((w) => this.idleSince.has(w.id) && now - this.idleSince.get(w.id) >= a.scaleInIdleMin * 60_000);
    if (ripe) {
      await this.scaleIn(ripe.id, { source: 'auto', reason: `No labs on this worker for ${Math.round((now - this.idleSince.get(ripe.id)) / 60000)} min and nothing queued` }).catch((e) => this.ctx.log.warn({ err: e.message }, 'auto scale-in failed'));
    }
  }

  /** Payload for GET /admin/scaling. */
  async status() {
    const { db, cfg } = this.ctx;
    const states = await this.states();
    const used = await this.ctx.nodes.slotsUsedMap();
    const nodes = new Map((await db('nodes').where({ kind: 'worker' })).map((n) => [n.id, n]));
    const events = await db('scaling_events').orderBy('seq', 'desc').limit(25);
    return {
      provider: cfg.cloud.provider === 'none' ? null : cfg.cloud.provider,
      available: this.available,
      autoEnabled: await this.autoEnabled(),
      rules: {
        scaleOutAfterSeconds: cfg.autoscale.scaleOutAfterSec,
        scaleInAfterMinutes: cfg.autoscale.scaleInIdleMin,
        minWorkers: cfg.autoscale.minWorkers,
        cooldownSeconds: cfg.autoscale.cooldownSec,
      },
      workers: cfg.workers.map((w) => ({
        id: w.id, name: w.name, vmName: w.vmName,
        power: states.get(w.id)?.state || POWER.ON,
        since: pub(states.get(w.id)?.changed_at) || null,
        status: nodes.get(w.id)?.status || 'offline',
        slotsUsed: used.get(w.id) || 0,
      })),
      events: events.map((e) => ({ id: `evt_${e.seq}`, at: pub(e.at), workerId: e.node_id, action: e.action, source: e.source, reason: e.reason, ok: !!e.ok })),
    };
  }
}

module.exports = { Scaler, POWER, SLOT_STATUSES };
