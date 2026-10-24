const express = require('express');
const { z, parse, optStr, optBool, paging, pagingShape } = require('../lib/validate');
const { ok, list, noContent } = require('../lib/respond');
const { ROLE, ENV_STATUS, LAB_TYPE, SIZE, values } = require('../constants');
const { authenticate, requireRole } = require('../middleware/auth');

const createSchema = z.object({
  labId: z.string().min(1),
  name: z.string().trim().min(3).max(40),
  size: z.enum(values(SIZE)),
  durationMinutes: z.number().int().min(15).max(240),
});

const listSchema = z.object({
  ...pagingShape,
  status: optStr, labType: z.enum(values(LAB_TYPE)).optional().or(z.literal('').transform(() => undefined)),
  userId: optStr, workerId: optStr, includeTerminated: optBool,
});

module.exports = (ctx) => {
  const r = express.Router();
  const envs = ctx.envs;
  r.use('/environments', authenticate(ctx));

  r.get('/environments', async (req, res) => {
    const q = parse(listSchema, req.query);
    const { page, pageSize, offset } = paging(req.query);
    let status;
    if (q.status) {
      status = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = status.find((s) => !values(ENV_STATUS).includes(s));
      if (bad) throw require('../lib/errors').E.validation({ status: `must be one of: ${values(ENV_STATUS).join(', ')}` });
    }
    const { items, total } = await envs.list(req.user, {
      status, labType: q.labType, userId: q.userId, workerId: q.workerId, includeTerminated: q.includeTerminated, pageSize, offset,
    });
    list(res, items, { page, pageSize, total });
  });

  r.post('/environments', requireRole(ROLE.STUDENT), async (req, res) => {
    const b = parse(createSchema, req.body);
    ok(res, await envs.create(req.user, b), undefined, 202);
  });

  r.get('/environments/:id', requireRole(ROLE.STUDENT, ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    ok(res, await envs.get(req.user, req.params.id));
  });

  r.post('/environments/:id/start', requireRole(ROLE.STUDENT, ROLE.ADMIN), async (req, res) => {
    ok(res, await envs.start(req.user, req.params.id), undefined, 202);
  });
  r.post('/environments/:id/stop', requireRole(ROLE.STUDENT, ROLE.ADMIN), async (req, res) => {
    ok(res, await envs.stop(req.user, req.params.id));
  });
  r.post('/environments/:id/restart', requireRole(ROLE.STUDENT, ROLE.ADMIN), async (req, res) => {
    ok(res, await envs.restart(req.user, req.params.id), undefined, 202);
  });
  r.delete('/environments/:id', requireRole(ROLE.STUDENT, ROLE.ADMIN), async (req, res) => {
    ok(res, await envs.remove(req.user, req.params.id));
  });

  r.post('/environments/:id/heartbeat', requireRole(ROLE.STUDENT), async (req, res) => {
    // Optional body { keepRunning: true } is the "Keep Running" button (see CONTRACT_NOTES.md).
    const b = parse(z.object({ keepRunning: z.boolean().optional() }), req.body ?? {});
    await envs.heartbeat(req.user, req.params.id, b);
    noContent(res);
  });

  r.get('/environments/:id/access', requireRole(ROLE.STUDENT), async (req, res) => {
    ok(res, await envs.access(req.user, req.params.id));
  });

  r.get('/environments/:id/metrics', requireRole(ROLE.STUDENT, ROLE.ADMIN), async (req, res) => {
    ok(res, await envs.metrics(req.user, req.params.id));
  });

  r.post('/environments/:id/datasets', requireRole(ROLE.STUDENT), async (req, res) => {
    const b = parse(z.object({ datasetId: z.string().min(1) }), req.body);
    ok(res, await envs.mountDataset(req.user, req.params.id, b.datasetId));
  });

  return r;
};
