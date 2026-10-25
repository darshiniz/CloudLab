const express = require('express');
const { ok } = require('../lib/respond');
const ser = require('../lib/serializers');
const { ROLE, ACTIVE_STATUSES } = require('../constants');
const { pub } = require('../lib/time');
const { authenticate, requireRole } = require('../middleware/auth');

/**
 * Student view of the activities faculty have assigned (see CONTRACT_NOTES.md, "Assignments").
 * Status follows the same rule faculty see: a lab of the activity's template created after the activity was assigned
 * means "inProgress" while it is live and "completed" once it has stopped.
 */
module.exports = (ctx) => {
  const r = express.Router();
  const { db } = ctx;

  r.get('/assignments', authenticate(ctx), requireRole(ROLE.STUDENT), async (req, res) => {
    const me = req.user.id;
    const all = await db('activities').orderBy('due_date', 'asc').orderBy('id');
    const mine = all.filter((a) => a.assign_type === 'class' || ser.parseJson(a.student_ids, []).includes(me));
    if (!mine.length) return ok(res, []);

    const labs = new Map((await db('labs').whereIn('id', [...new Set(mine.map((a) => a.lab_id))])).map((l) => [l.id, l]));
    const dsIds = [...new Set(mine.map((a) => a.dataset_id).filter(Boolean))];
    const datasets = new Map((dsIds.length ? await db('datasets').whereIn('id', dsIds) : []).map((d) => [d.id, d]));
    const people = new Map((await db('users').whereIn('id', [...new Set(mine.map((a) => a.created_by))])).map((u) => [u.id, u]));
    const envs = await db('environments').where({ user_id: me }).orderBy('created_at', 'desc');

    const now = Date.now();
    ok(res, mine.map((a) => {
      const theirs = envs.filter((e) => e.lab_id === a.lab_id && e.created_at >= a.created_at);
      const live = theirs.find((e) => ACTIVE_STATUSES.includes(e.status));
      const status = live ? 'inProgress' : theirs.length ? 'completed' : 'assigned';
      const lab = labs.get(a.lab_id);
      const ds = a.dataset_id ? datasets.get(a.dataset_id) : null;
      return {
        id: a.id, title: a.title, description: a.description, dueDate: pub(a.due_date), createdAt: pub(a.created_at),
        assignedBy: people.get(a.created_by)?.name ?? null,
        lab: lab ? { id: lab.id, name: lab.name, type: lab.type } : { id: a.lab_id, name: a.lab_id, type: null },
        dataset: ds ? { id: ds.id, name: ds.name, mountPath: `/data/shared/${ds.name}` } : null,
        status,
        overdue: status !== 'completed' && new Date(a.due_date).getTime() < now,
        environmentId: (live || theirs[0])?.id ?? null,
      };
    }));
  });

  return r;
};