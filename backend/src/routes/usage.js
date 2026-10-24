const express = require('express');
const { z, parse, optInt } = require('../lib/validate');
const { ok } = require('../lib/respond');
const { ROLE } = require('../constants');
const { authenticate, requireRole } = require('../middleware/auth');

module.exports = (ctx) => {
  const r = express.Router();
  r.get('/usage/me', authenticate(ctx), requireRole(ROLE.STUDENT), async (req, res) => {
    const q = parse(z.object({ weeks: optInt(1, 52) }), req.query);
    ok(res, await ctx.reports.usageMe(req.user.id, q.weeks ?? 8));
  });
  return r;
};
