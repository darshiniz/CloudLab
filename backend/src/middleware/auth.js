const { E } = require('../lib/errors');
const { USER_STATUS } = require('../constants');

/** Verifies the Bearer token and loads the user. A deactivated account is rejected immediately (BR-12). */
function authenticate(ctx) {
  return async (req, res, next) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) throw E.unauthenticated('Missing or malformed Authorization header');
    const payload = await ctx.auth.verify(m[1]);
    const user = await ctx.users.byId(payload.sub);
    if (!user) throw E.unauthenticated('Account no longer exists');
    if (user.status !== USER_STATUS.ACTIVE) throw E.unauthenticated('Account is not active');
    req.user = user;
    req.token = payload;
    ctx.users.touch(user.id);
    next();
  };
}

const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : next(E.forbidden()));

module.exports = { authenticate, requireRole };
