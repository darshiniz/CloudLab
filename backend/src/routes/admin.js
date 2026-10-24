const express = require('express');
const { z, parse, optStr, optDate, paging, pagingShape } = require('../lib/validate');
const { E } = require('../lib/errors');
const { ok, list } = require('../lib/respond');
const ser = require('../lib/serializers');
const { pub } = require('../lib/time');
const { ROLE, USER_STATUS, ENV_STATUS: S, values } = require('../constants');
const { authenticate, requireRole } = require('../middleware/auth');

const emptyToUndef = (e) => e.optional().or(z.literal('').transform(() => undefined));
const createUser = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().max(190).pipe(z.email()),
  role: z.enum(values(ROLE)),
  password: z.string().min(8).max(100),
  rollNo: z.string().trim().min(1).max(32).nullish(),
});
const patchUser = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(values(ROLE)).optional(),
  status: z.enum(values(USER_STATUS)).optional(),
});
const policySchema = z.object({
  autoStopEnabled: z.boolean(),
  inactivityMinutes: z.number().int().min(15).max(120),
  maxLabsPerWorker: z.number().int().min(1).max(8),
});
const settingsSchema = z.object({
  region: z.string().trim().min(2).max(40),
  defaults: z.object({
    cpu: z.number().min(0.25).max(4), memoryGb: z.number().min(0.25).max(8), storageGb: z.number().min(1).max(50),
  }),
});

module.exports = (ctx) => {
  const r = express.Router();
  const { db } = ctx;
  r.use('/admin', authenticate(ctx), requireRole(ROLE.ADMIN));

  r.get('/admin/overview', async (req, res) => {
    const counts = Object.fromEntries((await db('environments').groupBy('status').select('status').count({ n: '*' })).map((c) => [c.status, Number(c.n)]));
    const n = (k) => counts[k] || 0;
    const workers = (await ctx.nodes.workers()).filter((w) => w.enabled);
    const avg = (k) => (workers.length ? workers.reduce((a, w) => a + w[k], 0) / workers.length : 0);
    const sizes = await ctx.reports.folderSizes();
    const alerts = await db('alerts').whereNull('resolved_at').orderBy('seq', 'desc').limit(20);
    ok(res, {
      stats: {
        activeLabs: n(S.RUNNING) + n(S.INACTIVE) + n(S.PROVISIONING),
        runningContainers: n(S.RUNNING) + n(S.INACTIVE),
        cpuPercent: Math.round(avg('cpu_percent')),
        memoryPercent: Math.round(avg('memory_percent')),
        storagePercent: Math.min(100, Math.round((sizes.total / ctx.cfg.storage.totalGb) * 100)),
      },
      ...(await ctx.reports.series()),
      stateBreakdown: { running: n(S.RUNNING), inactive: n(S.INACTIVE), stopped: n(S.STOPPED), failed: n(S.FAILED) },
      alerts: alerts.map((a) => ({ id: `alt_${a.seq}`, severity: a.severity, message: a.message, createdAt: pub(a.created_at) })),
    });
  });

  r.get('/admin/infrastructure', async (req, res) => {
    const policy = await ctx.policy.row();
    const used = await ctx.nodes.slotsUsedMap();
    const rows = await db('nodes').orderBy('kind').orderBy('id'); // control first (alphabetical), then workers
    const nodes = rows.map((n) => ctx.nodes.serialize(n, used.get(n.id) || 0, policy.max_labs_per_worker));
    const workers = rows.filter((n) => n.kind === 'worker' && n.enabled);
    const queued = await ctx.envs._q().where('e.status', S.QUEUED).orderBy('e.queued_seq');
    const sizes = await ctx.reports.folderSizes();
    ok(res, {
      nodes,
      clusterCapacity: {
        slotsUsed: workers.reduce((a, w) => a + (used.get(w.id) || 0), 0),
        slotsTotal: workers.length * policy.max_labs_per_worker,
      },
      queue: {
        length: queued.length,
        items: queued.map((e) => ({ environmentId: e.id, userName: e.user_name, labType: e.lab_type, waitingSince: pub(e.created_at) })),
      },
      storage: {
        bucket: ctx.cfg.storage.bucketName, usedGb: sizes.total, totalGb: ctx.cfg.storage.totalGb,
        folders: [{ name: 'datasets', usedGb: sizes.datasets }, { name: 'students', usedGb: sizes.students }],
      },
    });
  });

  r.get('/admin/users', async (req, res) => {
    const q = parse(z.object({
      role: emptyToUndef(z.enum(values(ROLE))), status: emptyToUndef(z.enum(values(USER_STATUS))), search: optStr,
    }), req.query);
    const { page, pageSize, offset } = paging(req.query);
    const { items, total } = await ctx.users.list({ ...q, offset, pageSize });
    list(res, items, { page, pageSize, total });
  });

  r.post('/admin/users', async (req, res) => {
    ok(res, await ctx.users.create(parse(createUser, req.body), req.user), undefined, 201);
  });

  r.patch('/admin/users/:id', async (req, res) => {
    ok(res, await ctx.users.patch(req.params.id, parse(patchUser, req.body), req.user));
  });

  r.get('/admin/policy', async (req, res) => ok(res, await ctx.policy.get()));
  r.put('/admin/policy', async (req, res) => {
    const out = await ctx.policy.put(parse(policySchema, req.body));
    await ctx.audit.log(req.user, 'policy.update', JSON.stringify(out));
    ctx.envs.processQueue(); // a higher per-worker limit may free queued labs
    ok(res, out);
  });

  r.get('/admin/policy/auto-stop-log', async (req, res) => {
    const { page, pageSize, offset } = paging(req.query);
    const total = Number((await db('auto_stop_log').count({ n: '*' }).first()).n);
    const rows = await db('auto_stop_log').orderBy('seq', 'desc').limit(pageSize).offset(offset);
    list(res, rows.map((l) => ({ environmentId: l.env_id, userName: l.user_name, labType: l.lab_type, stoppedAt: pub(l.stopped_at), idleMinutes: l.idle_minutes })), { page, pageSize, total });
  });

  const rangeQ = z.object({ from: optDate, to: optDate });
  r.get('/admin/analytics', async (req, res) => {
    ok(res, await ctx.reports.analytics(ctx.reports.range(parse(rangeQ, req.query))));
  });
  r.get('/admin/analytics/export', async (req, res) => {
    const csv = await ctx.reports.analyticsCsv(ctx.reports.range(parse(rangeQ, req.query)));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cloudlab-analytics.csv"');
    res.send(csv);
  });

  r.get('/admin/settings', async (req, res) => ok(res, await ctx.policy.getSettings()));
  r.put('/admin/settings', async (req, res) => {
    const out = await ctx.policy.putSettings(parse(settingsSchema, req.body));
    await ctx.audit.log(req.user, 'settings.update', JSON.stringify(out));
    ok(res, out);
  });

  r.get('/admin/audit-log', async (req, res) => {
    const { page, pageSize, offset } = paging(req.query);
    const total = Number((await db('audit_log').count({ n: '*' }).first()).n);
    const rows = await db('audit_log').orderBy('seq', 'desc').limit(pageSize).offset(offset);
    list(res, rows.map((a) => ({ id: `aud_${a.seq}`, actorId: a.actor_id, actorName: a.actor_name, action: a.action, target: a.target, at: pub(a.at) })), { page, pageSize, total });
  });

  return r;
};
