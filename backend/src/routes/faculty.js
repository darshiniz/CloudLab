const express = require('express');
const { z, parse, optStr, optDate, paging, pageOf } = require('../lib/validate');
const { E } = require('../lib/errors');
const { ok, list, paged } = require('../lib/respond');
const ser = require('../lib/serializers');
const { newId } = require('../lib/ids');
const { nowIso, isoFromMs, dayStartMs, pub } = require('../lib/time');
const { ROLE, ENV_STATUS: S, LAB_TYPE, USER_STATUS, ACTIVE_STATUSES, values } = require('../constants');
const { Reports } = require('../services/reports');
const { authenticate, requireRole } = require('../middleware/auth');

const activitySchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(2000),
  labId: z.string().min(1),
  dueDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { error: 'must be an ISO date' }),
  datasetId: z.string().min(1).nullish(),
  assignTo: z.object({
    type: z.enum(['class', 'students']),
    studentIds: z.array(z.string()).max(500).default([]),
  }),
});

module.exports = (ctx) => {
  const r = express.Router();
  const { db } = ctx;
  r.use('/faculty', authenticate(ctx));

  // ---- activities -----------------------------------------------------------------------------
  /** Progress is derived from labs: see CONTRACT_NOTES.md ("Activity progress"). */
  async function progressFor(rows) {
    if (!rows.length) return new Map();
    const students = await db('users').where({ role: ROLE.STUDENT, status: USER_STATUS.ACTIVE }).pluck('id');
    const out = new Map();
    for (const a of rows) {
      const targets = a.assign_type === 'class' ? students : ser.parseJson(a.student_ids, []);
      const envs = targets.length
        ? await db('environments').whereIn('user_id', targets).where({ lab_id: a.lab_id }).where('created_at', '>=', a.created_at).select('user_id', 'status')
        : [];
      const live = new Set(); const touched = new Set();
      for (const e of envs) { touched.add(e.user_id); if (ACTIVE_STATUSES.includes(e.status)) live.add(e.user_id); }
      out.set(a.id, { assigned: targets.length, inProgress: live.size, completed: [...touched].filter((u) => !live.has(u)).length });
    }
    return out;
  }
  const listFilter = (req) => (req.user.role === ROLE.FACULTY ? { created_by: req.user.id } : {});

  r.get('/faculty/activities', requireRole(ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    const rows = await db('activities').where(listFilter(req)).orderBy('created_at', 'desc');
    const pr = await progressFor(rows);
    paged(res, pageOf(rows.map((a) => ser.activity(a, pr.get(a.id))), req.query));
  });

  r.get('/faculty/activities/:id', requireRole(ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    const a = await db('activities').where({ id: req.params.id }).where(listFilter(req)).first();
    if (!a) throw E.notFound('Activity not found');
    ok(res, ser.activity(a, (await progressFor([a])).get(a.id)));
  });

  r.post('/faculty/activities', requireRole(ROLE.FACULTY), async (req, res) => {
    const b = parse(activitySchema, req.body);
    const lab = await db('labs').where({ id: b.labId }).first();
    if (!lab || !lab.enabled) throw E.validation({ labId: 'is not an available lab template' });
    if (b.datasetId) {
      const ds = await db('datasets').where({ id: b.datasetId, scope: 'shared' }).first();
      if (!ds) throw E.validation({ datasetId: 'must be a shared dataset' });
    }
    let studentIds = [];
    if (b.assignTo.type === 'students') {
      studentIds = [...new Set(b.assignTo.studentIds)];
      if (!studentIds.length) throw E.validation({ 'assignTo.studentIds': 'select at least one student' });
      const found = await db('users').whereIn('id', studentIds).where({ role: ROLE.STUDENT }).pluck('id');
      const bad = studentIds.filter((i) => !found.includes(i));
      if (bad.length) throw E.validation({ 'assignTo.studentIds': `unknown student: ${bad[0]}` });
    }
    const row = {
      id: newId('activity'), title: b.title, description: b.description, lab_id: b.labId, dataset_id: b.datasetId ?? null,
      due_date: new Date(b.dueDate).toISOString(), assign_type: b.assignTo.type, student_ids: JSON.stringify(studentIds),
      created_by: req.user.id, created_at: nowIso(),
    };
    await db('activities').insert(row);
    ok(res, ser.activity(row, (await progressFor([row])).get(row.id)), undefined, 201);
  });

  // everything below is read-only reporting for faculty and admin
  r.use('/faculty', requireRole(ROLE.FACULTY, ROLE.ADMIN));

  r.get('/faculty/overview', async (req, res) => ok(res, await ctx.reports.facultyOverview()));

  r.get('/faculty/students', async (req, res) => {
    const q = parse(z.object({ search: optStr }), req.query);
    const { page, pageSize, offset } = paging(req.query);
    const base = db('users').where({ role: ROLE.STUDENT });
    if (q.search) {
      const like = `%${q.search.toLowerCase()}%`;
      base.where((b) => b.whereRaw('lower(name) like ?', [like]).orWhereRaw('lower(email) like ?', [like]).orWhereRaw("lower(coalesce(roll_no, '')) like ?", [like]));
    }
    const total = Number((await base.clone().count({ n: '*' }).first()).n);
    const rows = await base.orderBy('name').orderBy('id').limit(pageSize).offset(offset);
    const counts = rows.length
      ? await db('environments').whereIn('user_id', rows.map((u) => u.id)).groupBy('user_id').select('user_id').count({ n: '*' })
      : [];
    const cm = new Map(counts.map((c) => [c.user_id, Number(c.n)]));
    list(res, rows.map((u) => ({
      id: u.id, name: u.name, rollNo: u.roll_no, email: u.email, labsCreated: cm.get(u.id) || 0,
      lastActiveAt: pub(u.last_active_at), status: u.status,
    })), { page, pageSize, total });
  });

  r.get('/faculty/students/:id', async (req, res) => {
    const u = await db('users').where({ id: req.params.id, role: ROLE.STUDENT }).first();
    if (!u) throw E.notFound('Student not found');
    const now = Date.now();
    const from = dayStartMs(now) - 13 * 86_400_000;
    const sessions = await ctx.reports.sessions({ from, to: now + 1, userId: u.id });
    const rows = await ctx.envs._q().where('e.user_id', u.id).orderBy('e.created_at', 'desc').limit(20);
    const policy = await ctx.policy.get();
    const pos = await ctx.envs.queuePositions();
    const events = await db('env_events').where({ user_id: u.id }).orderBy('seq', 'desc').limit(20);
    ok(res, {
      student: ser.user(u),
      environments: rows.map((e) => ser.env(e, { queuePosition: pos.get(e.id) ?? null, policy })),
      usageByDay: Reports.byDay(sessions, from, now + 1),
      recentActivity: events.map((e) => ({ message: e.message, at: pub(e.at) })),
    });
  });

  r.get('/faculty/sessions', async (req, res) => {
    const q = parse(z.object({ labType: z.enum(values(LAB_TYPE)).optional().or(z.literal('').transform(() => undefined)), from: optDate, to: optDate }), req.query);
    const { page, pageSize, offset } = paging(req.query);
    const { from, to } = ctx.reports.range(q);
    const base = db('environments as e').join('users as u', 'u.id', 'e.user_id').where('u.role', ROLE.STUDENT)
      .whereNot('e.status', S.QUEUED)
      .where('e.created_at', '>=', isoFromMs(from)).where('e.created_at', '<', isoFromMs(to));
    if (q.labType) base.where('e.lab_type', q.labType);
    const total = Number((await base.clone().count({ n: '*' }).first()).n);
    const rows = await base.select('e.*', 'u.name as user_name').orderBy('e.created_at', 'desc').orderBy('e.id').limit(pageSize).offset(offset);
    const ss = rows.length ? await db('usage_sessions').whereIn('env_id', rows.map((e) => e.id)) : [];
    const mins = new Map();
    for (const s of ss) {
      const c = Reports.clip(s, 0, Date.now() + 1);
      if (c) mins.set(s.env_id, (mins.get(s.env_id) || 0) + (c[1] - c[0]) / 60000);
    }
    list(res, rows.map((e) => {
      const live = e.status === S.RUNNING || e.status === S.INACTIVE;
      return {
        environmentId: e.id, studentName: e.user_name, labType: e.lab_type, status: e.status,
        durationMinutes: Math.round(mins.get(e.id) || 0),
        cpuPercent: live ? Math.round(e.usage_cpu) : 0, memoryPercent: live ? Math.round(e.usage_mem) : 0,
      };
    }), { page, pageSize, total });
  });

  r.get('/faculty/usage/summary', async (req, res) => {
    const q = parse(z.object({ from: optDate, to: optDate }), req.query);
    ok(res, await ctx.reports.usageSummary(ctx.reports.range(q)));
  });

  return r;
};
