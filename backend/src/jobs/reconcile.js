const { ENV_STATUS: S } = require('../constants');
const { toMs } = require('../lib/time');

/** Keeps the database and Docker in agreement (BRD FR-21): every 60 s and after any restart. */
class Reconciler {
  constructor(ctx) { this.ctx = ctx; }

  async tick() {
    const { db, driver, nodes, envs, log, cfg } = this.ctx;

    // Provisioning that nobody is working on (should not happen, but a crash can leave it behind).
    const stale = await db('environments').where({ status: S.PROVISIONING })
      .where('updated_at', '<', new Date(Date.now() - cfg.jobs.provisioningStaleMs).toISOString())
      .select('id', 'user_id', 'name', 'steps_json', 'current_step');
    const orphans = stale.filter((r) => !envs.running.has(r.id));
    if (orphans.length) { await envs.failInterrupted(orphans, 'Starting the lab was interrupted. Please retry.'); envs.processQueue(); }

    for (const w of await nodes.workers().where({ enabled: 1 })) {
      try { await this._worker(w); } catch (e) { log.warn({ err: e.message, node: w.id }, 'reconcile failed for worker'); }
    }
  }

  async _worker(w) {
    const { db, driver, envs, log } = this.ctx;
    const ping = await driver.ping(w);
    if (!ping.ok) return; // cannot judge anything while the worker is unreachable
    const containers = await driver.list(w);
    const byEnv = new Map();
    for (const c of containers) { if (!byEnv.has(c.envId)) byEnv.set(c.envId, []); byEnv.get(c.envId).push(c); }

    // 1) database says live, Docker disagrees
    const live = await db('environments').where({ worker_id: w.id }).whereIn('status', [S.RUNNING, S.INACTIVE]);
    for (const e of live) {
      if (envs.running.has(e.id)) continue;
      const c = (byEnv.get(e.id) || []).find((x) => x.id === e.container_id) || (byEnv.get(e.id) || [])[0];
      if (!c || !c.running) {
        log.warn({ envId: e.id, container: e.container_id, oom: c?.oomKilled }, 'reconcile: lab is not running in Docker');
        await envs.stopEnv(e.id, c?.oomKilled ? 'memory_limit' : 'reconciliation', { skipDriver: true }).catch(() => {});
        if (!c) await db('environments').where({ id: e.id }).update({ container_id: null, host_port: null });
      }
    }

    // 2) Docker has containers the database does not expect
    for (const c of containers) {
      const e = await db('environments').where({ id: c.envId }).first();
      if (e && (e.status === S.PROVISIONING || envs.running.has(e.id))) continue; // being created right now
      if (!e || e.status === S.TERMINATED || e.status === S.FAILED || (e.container_id && e.container_id !== c.id)) {
        log.warn({ container: c.id, envId: c.envId }, 'reconcile: removing orphan container');
        await driver.remove(w, c.id).catch((err) => log.warn({ err: err.message }, 'orphan removal failed'));
      } else if (c.running && (e.status === S.STOPPED || e.status === S.QUEUED)) {
        log.warn({ container: c.id, envId: c.envId }, 'reconcile: stopping container of a stopped lab');
        await driver.stop(w, c.id).catch((err) => log.warn({ err: err.message }, 'stop failed'));
      }
    }

    // 3) stopped labs whose container vanished: free the port, the next start recreates it
    const stopped = await db('environments').where({ worker_id: w.id, status: S.STOPPED }).whereNotNull('container_id');
    for (const e of stopped) {
      if (!(byEnv.get(e.id) || []).some((c) => c.id === e.container_id)) {
        await db('environments').where({ id: e.id }).update({ container_id: null, host_port: null });
      }
    }
  }
}

module.exports = { Reconciler, toMs };
