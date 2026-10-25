const express = require('express');
const { z, parse } = require('../lib/validate');
const { E } = require('../lib/errors');
const { ok } = require('../lib/respond');
const ser = require('../lib/serializers');
const { newId } = require('../lib/ids');
const { ROLE, ACTIVE_STATUSES } = require('../constants');
const { nowIso, pub } = require('../lib/time');
const { authenticate, requireRole } = require('../middleware/auth');

const submitSchema = z.object({ note: z.string().trim().max(1000).optional() });

/**
 * Student view of the activities faculty have assigned (see CONTRACT_NOTES.md, "Assignments").
 *   assigned   - no lab started for it yet
 *   inProgress - a lab of the activity's template was created after it was assigned (even if that lab is stopped now)
 *   submitted  - the student pressed Submit (they can submit again to update the note)
 */
module.exports = (ctx) => {
  const r = express.Router();
  const { db } = ctx;
  r.use('/assignments', authenticate(ctx), requireRole(ROLE.STUDENT));

  const mineOnly = (activities, me) => activities.filter((a) => a.assign_type === 'class' || ser.parseJson(a.student_ids, []).includes(me));

  async function view(me, activities) {
    if (!activities.length) return [];
    const labs = new Map((await db('labs').whereIn('id', [...new Set(activities.map((a) => a.lab_id))])).map((l) => [l.id, l]));
    const dsIds = [...new Set(activities.map((a) => a.dataset_id).filter(Boolean))];
    const datasets = new Map((dsIds.length ? await db('datasets').whereIn('id', dsIds) : []).map((d) => [d.id, d]));
    const people = new Map((await db('users').whereIn('id', [...new Set(activities.map((a) => a.created_by))])).map((u) => [u.id, u]));
    const envs = await db('environments').where({ user_id: me }).orderBy('created_at', 'desc');
    const subs = new Map((await db('submissions').where({ user_id: me }).whereIn('activity_id', activities.map((a) => a.id))).map((s) => [s.activity_id, s]));

    const now = Date.now();
    return activities.map((a) => {
      const theirs = envs.filter((e) => e.lab_id === a.lab_id && e.created_at >= a.created_at);
      const live = theirs.find((e) => ACTIVE_STATUSES.includes(e.status));
      const sub = subs.get(a.id);
      const status = sub ? 'submitted' : theirs.length ? 'inProgress' : 'assigned';
      const lab = labs.get(a.lab_id);
      const ds = a.dataset_id ? datasets.get(a.dataset_id) : null;
      return {
        id: a.id, title: a.title, description: a.description, dueDate: pub(a.due_date), createdAt: pub(a.created_at),
        assignedBy: people.get(a.created_by)?.name ?? null,
        lab: lab ? { id: lab.id, name: lab.name, type: lab.type } : { id: a.lab_id, name: a.lab_id, type: null },
        dataset: ds ? { id: ds.id, name: ds.name, mountPath: `/data/shared/${ds.name}` } : null,
        status,
        maxMarks: a.max_marks ?? 100,
        submission: sub ? {
          submittedAt: pub(sub.submitted_at), note: sub.note ?? null, late: new Date(sub.submitted_at) > new Date(a.due_date),
          marks: sub.marks ?? null, feedback: sub.feedback ?? null, gradedAt: pub(sub.graded_at) ?? null,
        } : null,
        overdue: !sub && new Date(a.due_date).getTime() < now,
        liveEnvironmentId: live?.id ?? null,
        environmentId: (live || theirs[0])?.id ?? null,
      };
    });
  }

  r.get('/assignments', async (req, res) => {
    const all = await db('activities').orderBy('due_date', 'asc').orderBy('id');
    ok(res, await view(req.user.id, mineOnly(all, req.user.id)));
  });

  r.post('/assignments/:id/submit', async (req, res) => {
    const body = parse(submitSchema, req.body ?? {});
    const a = await db('activities').where({ id: req.params.id }).first();
    if (!a || !mineOnly([a], req.user.id).length) throw E.notFound('Activity not found');
    const existing = await db('submissions').where({ activity_id: a.id, user_id: req.user.id }).first();
    const at = nowIso();
    if (existing) await db('submissions').where({ id: existing.id }).update({ note: body.note ?? null, submitted_at: at });
    else await db('submissions').insert({ id: newId('submission'), activity_id: a.id, user_id: req.user.id, note: body.note ?? null, submitted_at: at });
    await ctx.audit.log(req.user, 'assignment.submit', a.id);
    ok(res, (await view(req.user.id, [a]))[0], undefined, existing ? 200 : 201);
  });

  return r;
};
