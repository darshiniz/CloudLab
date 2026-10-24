const express = require('express');
const rateLimit = require('express-rate-limit');
const { z, parse } = require('../lib/validate');
const { E } = require('../lib/errors');
const { ok, noContent } = require('../lib/respond');
const ser = require('../lib/serializers');
const { USER_STATUS } = require('../constants');
const { nowIso } = require('../lib/time');
const { authenticate } = require('../middleware/auth');

module.exports = (ctx) => {
  const r = express.Router();
  const limiter = rateLimit({
    windowMs: 60_000, limit: ctx.cfg.limits.loginRatePerMin, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next) => next(E.rateLimited()),
  });

  r.get('/health', (req, res) => ok(res, { status: 'ok', time: nowIso() }));

  r.post('/auth/login', limiter, async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    const user = await ctx.users.byEmail(body.email);
    const good = await ctx.auth.verifyPassword(body.password, user?.password_hash);
    if (!user || !good) throw E.invalidCredentials();
    if (user.status !== USER_STATUS.ACTIVE) throw E.forbidden('This account is deactivated. Contact the administrator.');
    const { token, expiresIn } = ctx.auth.sign(user);
    await ctx.db('users').where({ id: user.id }).update({ last_active_at: nowIso() });
    await ctx.audit.log(user, 'auth.login', user.id);
    ok(res, { token, expiresIn, user: ser.user({ ...user, last_active_at: nowIso() }) });
  });

  r.get('/auth/me', authenticate(ctx), (req, res) => ok(res, ser.user(req.user)));

  r.post('/auth/logout', authenticate(ctx), async (req, res) => {
    await ctx.auth.revoke(req.token);
    noContent(res);
  });

  return r;
};
