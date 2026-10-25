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
  maxMarks: z.number().int().min(1).max(1000).default(100),
  latePolicy: z.enum(['allow', 'block']).default('allow'), // after the due date: accept (flagged late) or refuse
  assignTo: z.object({
    type: z.enum(['class', 'students']),
    studentIds: z.array(z.string()).max(500).default([]),
  }),
});

module.exports = (ctx) => {
  const r = express.Router();
  const { db, storage } = ctx;
  r.use('/faculty', authenticate(ctx));

  // ---- activities -----------------------------------------------------------------------------
  /** Progress: completed = submitted, inProgress = started a lab but not submitted yet (CONTRACT_NOTES.md, "Activity progress"). */
  async function progressFor(rows) {
    if (!rows.length) return new Map();
    const students = await db('users').where({ role: ROLE.STUDENT, status: USER_STATUS.ACTIVE }).pluck('id');
    const subs = await db('submissions').whereIn('activity_id', rows.map((a) => a.id)).select('activity_id', 'user_id');
    const out = new Map();
    for (const a of rows) {
      const targets = a.assign_type === 'class' ? students : ser.parseJson(a.student_ids, []);
      const submitted = new Set(subs.filter((x) => x.activity_id === a.id && targets.includes(x.user_id)).map((x) => x.user_id));
      const envs = targets.length
        ? await db('environments').whereIn('user_id', targets).where({ lab_id: a.lab_id }).where('created_at', '>=', a.created_at).pluck('user_id')
        : [];
      const started = new Set(envs.filter((u) => !submitted.has(u)));
      out.set(a.id, { assigned: targets.length, inProgress: started.size, completed: submitted.size });
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

  /** Everyone the activity is assigned to, with their submission (if any). */
  async function submissionRows(a) {
    const targets = a.assign_type === 'class'
      ? await db('users').where({ role: ROLE.STUDENT, status: USER_STATUS.ACTIVE }).pluck('id')
      : ser.parseJson(a.student_ids, []);
    const users = targets.length ? await db('users').whereIn('id', targets).orderBy('name') : [];
    const subs = new Map((await db('submissions').where({ activity_id: a.id })).map((x) => [x.user_id, x]));
    const started = new Set(targets.length
      ? await db('environments').whereIn('user_id', targets).where({ lab_id: a.lab_id }).where('created_at', '>=', a.created_at).pluck('user_id')
      : []);
    return users.map((u) => {
      const sub = subs.get(u.id);
      return {
        studentId: u.id, name: u.name, rollNo: u.roll_no, email: u.email,
        status: sub ? 'submitted' : started.has(u.id) ? 'inProgress' : 'assigned',
        submittedAt: sub ? pub(sub.submitted_at) : null,
        late: sub ? new Date(sub.submitted_at) > new Date(a.due_date) : false,
        note: sub?.note ?? null, paths: sub ? ser.parseJson(sub.paths, []) : [],
        marks: sub?.marks ?? null, feedback: sub?.feedback ?? null, gradedAt: pub(sub?.graded_at) ?? null,
        maxMarks: a.max_marks ?? 100,
      };
    });
  }
  async function submittedActivity(req) {
    const a = await db('activities').where({ id: req.params.id }).where(listFilter(req)).first();
    if (!a) throw E.notFound('Activity not found');
    const sub = await db('submissions').where({ activity_id: a.id, user_id: req.params.studentId }).first();
    if (!sub) throw E.notFound('This student has not submitted this activity');
    // Faculty read the copy made at Submit time, never the student's live workspace.
    const dir = storage.submissionDir(a.id, req.params.studentId);
    if (!require('fs').existsSync(dir)) throw E.notFound('This submission has no files attached');
    return dir;
  }

  r.get('/faculty/activities/:id/submissions', requireRole(ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    const a = await db('activities').where({ id: req.params.id }).where(listFilter(req)).first();
    if (!a) throw E.notFound('Activity not found');
    ok(res, await submissionRows(a));
  });

  // Marks and written feedback for a submitted activity. The student sees them in their Assignments page.
  r.put('/faculty/activities/:id/submissions/:studentId/grade', requireRole(ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    const a = await db('activities').where({ id: req.params.id }).where(listFilter(req)).first();
    if (!a) throw E.notFound('Activity not found');
    const max = a.max_marks ?? 100;
    const b = parse(z.object({ marks: z.number().min(0).max(max), feedback: z.string().trim().max(2000).optional() }), req.body ?? {});
    const sub = await db('submissions').where({ activity_id: a.id, user_id: req.params.studentId }).first();
    if (!sub) throw E.notFound('This student has not submitted this activity');
    await db('submissions').where({ id: sub.id }).update({ marks: b.marks, feedback: b.feedback || null, graded_by: req.user.id, graded_at: nowIso() });
    await ctx.audit.log(req.user, 'assignment.grade', `${a.id} ${req.params.studentId}`);
    const row = (await submissionRows(a)).find((x) => x.studentId === req.params.studentId);
    ok(res, row);
  });

  // Read-only view of a student's workspace, only once that student has submitted.
  r.get('/faculty/activities/:id/submissions/:studentId/files', requireRole(ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    const q = parse(z.object({ path: optStr }), req.query);
    const base = await submittedActivity(req);
    paged(res, pageOf(await storage.listDir(base, q.path || '/'), req.query));
  });

  r.get('/faculty/activities/:id/submissions/:studentId/files/download', requireRole(ROLE.FACULTY, ROLE.ADMIN), async (req, res) => {
    const q = parse(z.object({ path: z.string().min(1) }), req.query);
    const base = await submittedActivity(req);
    const file = await storage.resolveFile(base, q.path);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(file, require('path').basename(file), (err) => { if (err && !res.headersSent) throw E.notFound('File not found'); });
  });

  // Faculty control over what the activity accepts: stop/resume submissions, late policy, new due date.
  r.patch('/faculty/activities/:id', requireRole(ROLE.FACULTY), async (req, res) => {
    const a = await db('activities').where({ id: req.params.id, created_by: req.user.id }).first();
    if (!a) throw E.notFound('Activity not found');
    const b = parse(z.object({
      closed: z.boolean().optional(),
      latePolicy: z.enum(['allow', 'block']).optional(),
      dueDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { error: 'must be an ISO date' }).optional(),
    }), req.body ?? {});
    const upd = {};
    if (b.closed !== undefined) upd.closed = b.closed ? 1 : 0;
    if (b.latePolicy !== undefined) upd.late_policy = b.latePolicy;
    if (b.dueDate !== undefined) upd.due_date = new Date(b.dueDate).toISOString();
    if (!Object.keys(upd).length) throw E.validation({ body: 'nothing to change' });
    await db('activities').where({ id: a.id }).update(upd);
    await ctx.audit.log(req.user, 'activity.update', `${a.id} ${JSON.stringify(b)}`);
    const fresh = await db('activities').where({ id: a.id }).first();
    ok(res, ser.activity(fresh, (await progressFor([fresh])).get(fresh.id)));
  });

  // Take back a grade so the student may update their submission (they are graded again afterwards).
  r.post('/faculty/activities/:id/submissions/:studentId/reopen', requireRole(ROLE.FACULTY), async (req, res) => {
    const a = await db('activities').where({ id: req.params.id, created_by: req.user.id }).first();
    if (!a) throw E.notFound('Activity not found');
    const sub = await db('submissions').where({ activity_id: a.id, user_id: req.params.studentId }).first();
    if (!sub) throw E.notFound('This student has not submitted this activity');
    await db('submissions').where({ id: sub.id }).update({ marks: null, feedback: null, graded_by: null, graded_at: null });
    await ctx.audit.log(req.user, 'assignment.reopen', `${a.id} ${req.params.studentId}`);
    ok(res, (await submissionRows(a)).find((x) => x.studentId === req.params.studentId));
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
      due_date: new Date(b.dueDate).toISOString(), max_marks: b.maxMarks, late_policy: b.latePolicy, assign_type: b.assignTo.type, student_ids: JSON.stringify(studentIds),
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
