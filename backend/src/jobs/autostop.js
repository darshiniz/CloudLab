const { ENV_STATUS: S } = require('../constants');
const { isoFromMs, toMs } = require('../lib/time');

/** Marks idle labs "inactive" (warning window) and stops them when the policy says so. */
class AutoStop {
  constructor(ctx) { this.ctx = ctx; }

  /** Today's scheduled stop moment in ms (UTC), or null when disabled. */
  scheduledStopMs(nowMs = Date.now()) {
    const { jobs } = this.ctx.cfg;
    if (!jobs.scheduledStopEnabled) return null;
    const [hh, mm] = jobs.scheduledStopTime.split(':').map(Number);
    const off = jobs.scheduledStopUtcOffsetMin * 60_000;
    const local = nowMs + off;
    const dayStartLocal = local - (((local % 86400_000) + 86400_000) % 86400_000);
    return dayStartLocal + (hh * 60 + mm) * 60_000 - off;
  }

  async tick(nowMs = Date.now()) {
    const { db, storage, cfg, log, envs } = this.ctx;
    const policy = await this.ctx.policy.get();
    const live = await envs._q().whereIn('e.status', [S.RUNNING, S.INACTIVE]);
    const stopAt = this.scheduledStopMs(nowMs);

    for (const e of live) {
      try {
        // File changes in the workspace count as activity (BRD BR-11).
        let last = toMs(e.last_activity_at) || toMs(e.started_at) || nowMs;
        const mt = await storage.latestMtime(storage.projectsDir(e.user_id));
        if (mt > last) {
          last = Math.min(mt, nowMs);
          await db('environments').where({ id: e.id }).update({ last_activity_at: isoFromMs(last) });
        }

        if (e.session_expires_at && toMs(e.session_expires_at) <= nowMs) { await envs.stopEnv(e.id, 'session'); continue; }
        if (stopAt && nowMs >= stopAt && toMs(e.started_at) < stopAt) { await envs.stopEnv(e.id, 'scheduled'); continue; }

        if (!policy.autoStopEnabled) {
          if (e.status === S.INACTIVE) await db('environments').where({ id: e.id }).update({ status: S.RUNNING });
          continue;
        }
        const idleMin = (nowMs - last) / 60_000;
        if (idleMin >= policy.inactivityMinutes) { await envs.stopEnv(e.id, 'idle', { idleMinutes: idleMin }); continue; }
        const warnFrom = Math.max(0, policy.inactivityMinutes - cfg.jobs.inactiveWarningMinutes);
        if (idleMin >= warnFrom && e.status === S.RUNNING) await db('environments').where({ id: e.id, status: S.RUNNING }).update({ status: S.INACTIVE });
        else if (idleMin < warnFrom && e.status === S.INACTIVE) await db('environments').where({ id: e.id, status: S.INACTIVE }).update({ status: S.RUNNING });
      } catch (err) {
        log.warn({ err: err.message, envId: e.id }, 'auto-stop check failed');
      }
    }
  }
}

module.exports = { AutoStop };
