const { NODE_STATUS, ENV_STATUS: S, SEVERITY } = require('../constants');
const { nowIso, toMs } = require('../lib/time');

/** Samples CPU/memory of the control VM, each worker and each lab every 30 s. */
class Monitor {
  constructor(ctx) { this.ctx = ctx; this.lastPrune = 0; }

  async ensureAlert(key, severity, message) {
    const { db } = this.ctx;
    const open = await db('alerts').where({ alert_key: key }).whereNull('resolved_at').first();
    if (open) {
      if (open.severity !== severity || open.message !== message) await db('alerts').where({ seq: open.seq }).update({ severity, message });
      return;
    }
    await db('alerts').insert({ alert_key: key, severity, message, created_at: nowIso() });
  }
  async resolveAlert(key) {
    await this.ctx.db('alerts').where({ alert_key: key }).whereNull('resolved_at').update({ resolved_at: nowIso() });
  }

  async tick() {
    const { db, driver, nodes, cfg, log } = this.ctx;
    const now = nowIso();

    // control VM (this machine)
    const c = nodes.controlLoad();
    await db('nodes').where({ id: 'control' }).update({ cpu_percent: c.cpu, memory_percent: c.mem, status: NODE_STATUS.ONLINE, last_seen_at: now });
    await db('metric_samples').insert({ node_id: 'control', cpu: c.cpu, mem: c.mem, at: now });

    for (const w of await nodes.workers().where({ enabled: 1 })) {
      try { await this._sampleWorker(w, now); } catch (e) { log.warn({ err: e.message, node: w.id }, 'worker sampling failed'); }
    }

    const queued = Number((await db('environments').where({ status: S.QUEUED }).count({ n: '*' }).first()).n);
    if (queued > 0) await this.ensureAlert('queue', SEVERITY.INFO, `${queued} lab request${queued > 1 ? 's' : ''} waiting in the queue`);
    else await this.resolveAlert('queue');

    if (Date.now() - this.lastPrune > 3600_000) {
      this.lastPrune = Date.now();
      const cutoff = new Date(Date.now() - cfg.jobs.metricRetentionDays * 86400_000).toISOString();
      await db('metric_samples').where('at', '<', cutoff).delete();
      await db('alerts').whereNotNull('resolved_at').where('resolved_at', '<', cutoff).delete();
    }
  }

  async _sampleWorker(w, now) {
    const { db, driver, cfg } = this.ctx;
    const ping = await driver.ping(w);
    if (!ping.ok) {
      await db('nodes').where({ id: w.id }).update({ status: NODE_STATUS.OFFLINE, cpu_percent: 0, memory_percent: 0 });
      await this.ensureAlert(`offline:${w.id}`, SEVERITY.CRITICAL, `${w.name} is unreachable`);
      return;
    }
    await this.resolveAlert(`offline:${w.id}`);
    const st = await driver.stats(w);
    const live = await db('environments').where({ worker_id: w.id }).whereIn('status', [S.RUNNING, S.INACTIVE]);
    const byId = new Map(live.map((e) => [e.id, e]));
    let cores = 0;
    let memBytes = cfg.jobs.workerBaselineMemMb * 1024 ** 2;

    for (const s of st.containers) {
      const e = byId.get(s.envId);
      if (!e) continue;
      const cpuPct = Math.min(100, (s.cpuCores / e.cpu) * 100);
      const memPct = Math.min(100, s.memoryPercent);
      cores += s.cpuCores;
      memBytes += (memPct / 100) * e.memory_gb * 1024 ** 3;
      const upd = { usage_cpu: cpuPct, usage_mem: memPct, usage_at: now };
      // BRD BR-11: CPU use at or above the threshold counts as activity.
      if (cpuPct >= cfg.jobs.cpuActiveThreshold) {
        upd.last_activity_at = now;
        if (e.status === S.INACTIVE) upd.status = S.RUNNING;
      }
      await db('environments').where({ id: e.id }).update(upd);
      await db('usage_sessions').where({ env_id: e.id }).whereNull('ended_at')
        .update({ cpu_sum: db.raw('cpu_sum + ?', [cpuPct]), mem_sum: db.raw('mem_sum + ?', [memPct]), samples: db.raw('samples + 1') });
    }

    const nodeCpu = Math.min(100, (cores / st.ncpu) * 100);
    const nodeMem = Math.min(100, (memBytes / st.memTotalBytes) * 100);
    const status = nodeMem > 90 || nodeCpu > 95 || (ping.latencyMs ?? 0) > 3000 ? NODE_STATUS.DEGRADED : NODE_STATUS.ONLINE;
    await db('nodes').where({ id: w.id }).update({ cpu_percent: nodeCpu, memory_percent: nodeMem, status, last_seen_at: now });
    await db('metric_samples').insert({ node_id: w.id, cpu: nodeCpu, mem: nodeMem, at: now });

    for (const [kind, v, label] of [['mem', nodeMem, 'memory'], ['cpu', nodeCpu, 'CPU']]) {
      const key = `${kind}:${w.id}`;
      if (v > 85) await this.ensureAlert(key, v > 95 ? SEVERITY.CRITICAL : SEVERITY.WARNING, `${w.name} ${label} above 85%`);
      else await this.resolveAlert(key);
    }
  }
}

module.exports = { Monitor, toMs };
