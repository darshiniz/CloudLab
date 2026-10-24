const { nowIso } = require('../lib/time');

class AuditService {
  constructor(ctx) { this.ctx = ctx; }

  /** Admin-visible audit trail. actor is a user row/object or null for the system. */
  async log(actor, action, target) {
    try {
      await this.ctx.db('audit_log').insert({
        actor_id: actor?.id ?? null,
        actor_name: actor?.name ?? 'System',
        action,
        target: String(target).slice(0, 190),
        at: nowIso(),
      });
    } catch (e) {
      this.ctx.log.warn({ err: e.message }, 'audit log write failed');
    }
  }

  /** Per-environment activity feed (shown to faculty as "recent activity"). */
  async event(envId, userId, type, message) {
    try {
      await this.ctx.db('env_events').insert({ env_id: envId, user_id: userId, type, message: String(message).slice(0, 500), at: nowIso() });
    } catch (e) {
      this.ctx.log.warn({ err: e.message }, 'env event write failed');
    }
  }
}

module.exports = { AuditService };
