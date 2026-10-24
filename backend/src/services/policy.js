const { E } = require('../lib/errors');

class PolicyService {
  constructor(ctx) { this.ctx = ctx; }

  /** Ensure the single policy and settings rows exist. */
  async init() {
    const { db, cfg } = this.ctx;
    if (!(await db('policy').where({ id: 1 }).first())) {
      await db('policy').insert({
        id: 1,
        auto_stop_enabled: cfg.limits.defaultAutoStopEnabled ? 1 : 0,
        inactivity_minutes: cfg.limits.defaultInactivityMinutes,
        max_labs_per_worker: cfg.limits.defaultMaxLabsPerWorker,
      });
    }
    if (!(await db('settings').where({ id: 1 }).first())) {
      await db('settings').insert({ id: 1, region: cfg.region, default_cpu: 1, default_memory_gb: 1, default_storage_gb: 5 });
    }
  }

  /** Raw row (snake_case) for internal use. */
  async row(trx = this.ctx.db) { return trx('policy').where({ id: 1 }).first(); }

  async get() {
    const r = await this.row();
    return { autoStopEnabled: !!r.auto_stop_enabled, inactivityMinutes: r.inactivity_minutes, maxLabsPerWorker: r.max_labs_per_worker };
  }

  async put(body) {
    await this.ctx.db('policy').where({ id: 1 }).update({
      auto_stop_enabled: body.autoStopEnabled ? 1 : 0,
      inactivity_minutes: body.inactivityMinutes,
      max_labs_per_worker: body.maxLabsPerWorker,
    });
    return this.get();
  }

  async getSettings() {
    const r = await this.ctx.db('settings').where({ id: 1 }).first();
    return { region: r.region, defaults: { cpu: r.default_cpu, memoryGb: r.default_memory_gb, storageGb: r.default_storage_gb } };
  }

  async putSettings(body) {
    await this.ctx.db('settings').where({ id: 1 }).update({
      region: body.region,
      default_cpu: body.defaults.cpu,
      default_memory_gb: body.defaults.memoryGb,
      default_storage_gb: body.defaults.storageGb,
    });
    return this.getSettings();
  }
}

module.exports = { PolicyService, E };
