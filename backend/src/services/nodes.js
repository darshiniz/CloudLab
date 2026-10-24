const os = require('os');
const { NODE_STATUS, SLOT_STATUSES } = require('../constants');

class NodeService {
  constructor(ctx) { this.ctx = ctx; this._cpu = null; }

  /** Create control + worker node rows from config (idempotent). */
  async init() {
    const { db, cfg } = this.ctx;
    const base = { machine_type: cfg.machineType, region: cfg.region, status: NODE_STATUS.ONLINE };
    if (!(await db('nodes').where({ id: 'control' }).first())) {
      await db('nodes').insert({ id: 'control', name: 'Control / API VM', kind: 'control', ...base, enabled: 1 });
    }
    for (const w of cfg.workers) {
      const row = await db('nodes').where({ id: w.id }).first();
      const vals = { docker_host: w.dockerHost || null, internal_ip: w.internalIp || null };
      if (!row) await db('nodes').insert({ id: w.id, name: w.name, kind: 'worker', ...base, enabled: 1, ...vals });
      else await db('nodes').where({ id: w.id }).update(vals); // config is the source of truth for addresses
    }
  }

  workers() { return this.ctx.db('nodes').where({ kind: 'worker' }).orderBy('id'); }
  get(id) { return this.ctx.db('nodes').where({ id }).first(); }

  async slotsUsedMap(trx = this.ctx.db) {
    const rows = await trx('environments').whereIn('status', SLOT_STATUSES).whereNotNull('worker_id')
      .groupBy('worker_id').select('worker_id').count({ n: '*' });
    return new Map(rows.map((r) => [r.worker_id, Number(r.n)]));
  }

  /** CPU % of this (control) machine since the previous call. */
  controlLoad() {
    const cpus = os.cpus();
    const total = cpus.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
    const idle = cpus.reduce((a, c) => a + c.times.idle, 0);
    let cpu = 0;
    if (this._cpu) {
      const dt = total - this._cpu.total;
      const di = idle - this._cpu.idle;
      cpu = dt > 0 ? Math.max(0, Math.min(100, (1 - di / dt) * 100)) : 0;
    }
    this._cpu = { total, idle };
    const mem = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
    return { cpu, mem };
  }

  serialize(row, used, total) {
    const isWorker = row.kind === 'worker';
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      machineType: row.machine_type,
      region: row.region,
      status: row.status,
      cpuPercent: Math.round(row.cpu_percent),
      memoryPercent: Math.round(row.memory_percent),
      slotsUsed: isWorker ? used : null,
      slotsTotal: isWorker ? total : null,
    };
  }
}

module.exports = { NodeService };
