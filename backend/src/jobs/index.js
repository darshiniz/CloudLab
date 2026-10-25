const { Monitor } = require('./monitor');
const { AutoStop } = require('./autostop');
const { Reconciler } = require('./reconcile');

/** Runs the background jobs on timers. Ticks never overlap and never crash the process. */
class Jobs {
  constructor(ctx) {
    this.ctx = ctx;
    this.monitor = new Monitor(ctx);
    this.autoStop = new AutoStop(ctx);
    this.reconciler = new Reconciler(ctx);
    this.timers = [];
    this.busy = new Set();
  }

  _wrap(name, fn) {
    return async () => {
      if (this.busy.has(name)) return;
      this.busy.add(name);
      try { await fn(); } catch (e) { this.ctx.log.error({ err: e.message, job: name }, 'job failed'); } finally { this.busy.delete(name); }
    };
  }

  start() {
    const { jobs } = this.ctx.cfg;
    const defs = [
      ['monitor', () => this.monitor.tick(), jobs.monitorIntervalMs],
      ['reconcile', () => this.reconciler.tick(), jobs.reconcileIntervalMs],
      ['autostop', () => this.autoStop.tick(), jobs.autoStopIntervalMs],
      ['queue', () => this.ctx.envs.processQueue(), jobs.queueIntervalMs],
      ['autoscale', () => this.ctx.scaler.tick(), this.ctx.cfg.autoscale.intervalMs],
      ['powersync', () => this.ctx.scaler.syncPower(), 60_000],
      ['purge', () => this.ctx.auth.purgeRevoked(), 3600_000],
    ];
    for (const [name, fn, every] of defs) {
      const run = this._wrap(name, fn);
      this.timers.push(setInterval(run, every).unref());
    }
    // First pass right away: fresh node status and a reconcile after every restart.
    this._wrap('monitor', () => this.monitor.tick())();
    setTimeout(this._wrap('reconcile', () => this.reconciler.tick()), 1500).unref();
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; }
}

module.exports = { Jobs };
