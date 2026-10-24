const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { E } = require('../lib/errors');

const ALG = ['HS256'];

class AuthService {
  constructor(ctx) {
    this.ctx = ctx;
    this.secret = ctx.cfg.jwt.secret;
    this.dummyHash = bcrypt.hashSync('not-a-real-password', 10);
  }

  hash(password) { return bcrypt.hash(password, 10); }

  /** Constant-ish time: always runs one bcrypt compare, even for unknown users. */
  async verifyPassword(password, hash) { return bcrypt.compare(password, hash || this.dummyHash).then((ok) => ok && !!hash); }

  /** Session token. Claims: sub (user id), role, exp, jti. */
  sign(user) {
    const expiresIn = this.ctx.cfg.jwt.expiresInSec;
    const token = jwt.sign({ role: user.role }, this.secret, {
      algorithm: ALG[0], subject: user.id, expiresIn, jwtid: crypto.randomBytes(12).toString('hex'),
    });
    return { token, expiresIn };
  }

  async verify(token) {
    let payload;
    try { payload = jwt.verify(token, this.secret, { algorithms: ALG }); } catch { throw E.unauthenticated('Invalid or expired token'); }
    if (payload.typ === 'ws') throw E.unauthenticated('Invalid token');
    if (!payload.sub || !payload.jti) throw E.unauthenticated('Invalid token');
    const revoked = await this.ctx.db('revoked_tokens').where({ jti: payload.jti }).first();
    if (revoked) throw E.unauthenticated('Session has ended');
    return payload;
  }

  async revoke(payload) {
    await this.ctx.db('revoked_tokens').insert({ jti: payload.jti, exp_ms: payload.exp * 1000 }).onConflict('jti').ignore();
  }

  async purgeRevoked() { await this.ctx.db('revoked_tokens').where('exp_ms', '<', Date.now()).delete(); }

  /** Short-lived token that only opens one workspace (used by /lab/:envId). */
  signWorkspaceToken(userId, envId, expiresAtMs) {
    const sec = Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000));
    return jwt.sign({ typ: 'ws', env: envId }, this.secret, { algorithm: ALG[0], subject: userId, expiresIn: sec });
  }

  verifyWorkspaceToken(token) {
    try {
      const p = jwt.verify(token, this.secret, { algorithms: ALG });
      return p.typ === 'ws' ? p : null;
    } catch { return null; }
  }
}

module.exports = { AuthService };
