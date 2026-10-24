const { newId } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { E } = require('../lib/errors');
const ser = require('../lib/serializers');
const { ROLE, USER_STATUS, ACTIVE_STATUSES } = require('../constants');

class UserService {
  constructor(ctx) { this.ctx = ctx; this.touched = new Map(); }

  /** Remember when a user was last seen (at most one write per minute per user). */
  touch(userId) {
    const last = this.touched.get(userId) || 0;
    if (Date.now() - last < 60_000) return;
    this.touched.set(userId, Date.now());
    this.ctx.db('users').where({ id: userId }).update({ last_active_at: nowIso() }).catch(() => {});
  }

  async byEmail(email) { return this.ctx.db('users').whereRaw('lower(email) = ?', [String(email).toLowerCase()]).first(); }
  byId(id) { return this.ctx.db('users').where({ id }).first(); }

  async create({ name, email, role, password, rollNo }, actor) {
    const { db, auth } = this.ctx;
    if (await this.byEmail(email)) throw E.emailExists();
    if (role === ROLE.STUDENT) {
      if (!rollNo) throw E.validation({ rollNo: 'is required for students' });
      if (await db('users').where({ roll_no: rollNo }).first()) throw E.validation({ rollNo: 'is already used by another student' });
    }
    const row = {
      id: newId('user'), name: name.trim(), email: email.toLowerCase(), password_hash: await auth.hash(password),
      role, status: USER_STATUS.ACTIVE, roll_no: role === ROLE.STUDENT ? rollNo : null, created_at: nowIso(), last_active_at: null,
    };
    await db('users').insert(row);
    if (actor) await this.ctx.audit.log(actor, 'user.create', `${row.id} (${row.role})`);
    return ser.user(row);
  }

  async list({ role, status, search, offset, pageSize }) {
    const q = this.ctx.db('users');
    if (role) q.where({ role });
    if (status) q.where({ status });
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      q.where((b) => b.whereRaw('lower(name) like ?', [like]).orWhereRaw('lower(email) like ?', [like]).orWhereRaw('lower(coalesce(roll_no, \'\')) like ?', [like]));
    }
    const total = Number((await q.clone().count({ n: '*' }).first()).n);
    const rows = await q.orderBy('created_at', 'desc').orderBy('id').limit(pageSize).offset(offset);
    return { items: rows.map(ser.user), total };
  }

  async patch(id, body, actor) {
    const { db } = this.ctx;
    const u = await this.byId(id);
    if (!u) throw E.notFound('User not found');
    const upd = {};
    if (body.name !== undefined) upd.name = body.name.trim();
    if (body.role !== undefined && body.role !== u.role) {
      if (u.id === actor.id) throw E.invalidState('You cannot change your own role');
      upd.role = body.role;
      if (body.role === ROLE.STUDENT && !u.roll_no) throw E.validation({ role: 'a student needs a roll number first' });
      if (body.role !== ROLE.STUDENT) upd.roll_no = null;
    }
    if (body.status !== undefined && body.status !== u.status) {
      if (u.id === actor.id && body.status === USER_STATUS.INACTIVE) throw E.invalidState('You cannot deactivate your own account');
      upd.status = body.status;
    }
    if (!Object.keys(upd).length) return ser.user(u);
    if (upd.role && u.role === ROLE.ADMIN && upd.role !== ROLE.ADMIN) await this._assertAnotherAdmin(u.id);
    if (upd.status === USER_STATUS.INACTIVE && u.role === ROLE.ADMIN) await this._assertAnotherAdmin(u.id);
    await db('users').where({ id }).update(upd);
    await this.ctx.audit.log(actor, 'user.update', `${id} ${JSON.stringify(upd)}`);
    // A deactivated account loses access immediately (BR-12): stop its labs too.
    if (upd.status === USER_STATUS.INACTIVE) this._stopLabsOf(id);
    return ser.user(await this.byId(id));
  }

  async _assertAnotherAdmin(exceptId) {
    const n = Number((await this.ctx.db('users').where({ role: ROLE.ADMIN, status: USER_STATUS.ACTIVE }).whereNot({ id: exceptId }).count({ n: '*' }).first()).n);
    if (n < 1) throw E.invalidState('At least one active administrator is required');
  }

  _stopLabsOf(userId) {
    (async () => {
      const rows = await this.ctx.db('environments').where({ user_id: userId }).whereIn('status', ACTIVE_STATUSES).select('id', 'status');
      for (const r of rows) {
        try {
          if (r.status === 'running' || r.status === 'inactive') await this.ctx.envs.stopEnv(r.id, 'deactivated');
          else await this.ctx.envs.terminate(r.id, 'deactivated');
        } catch (e) { this.ctx.log.warn({ err: e.message, envId: r.id }, 'could not stop lab of deactivated user'); }
      }
    })();
  }
}

module.exports = { UserService };
