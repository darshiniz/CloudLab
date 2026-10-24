const { isoFromMs, toMs, dayStartMs, dayKey, weekStartMs, pub } = require('../lib/time');
const { ROLE, ENV_STATUS: S } = require('../constants');

const DAY = 86_400_000;
const r2 = (n) => Math.round(n * 100) / 100;

/** Usage numbers computed from usage_sessions (one row per start..stop of a lab). */
class Reports {
  constructor(ctx) { this.ctx = ctx; this._folderCache = null; }

  /** Resolve ?from=&to= (ISO dates). Defaults to the last `days` days, ending now. */
  range(q, days = 30) {
    const to = q.to ? Date.parse(q.to) : Date.now();
    const from = q.from ? Date.parse(q.from) : to - days * DAY;
    return { from, to };
  }

  /** Sessions that overlap [from,to). */
  async sessions({ from, to, userId, userIds, labType }) {
    const q = this.ctx.db('usage_sessions').where('started_at', '<', isoFromMs(to))
      .where((b) => b.whereNull('ended_at').orWhere('ended_at', '>', isoFromMs(from)));
    if (userId) q.where({ user_id: userId });
    if (userIds) q.whereIn('user_id', userIds);
    if (labType) q.where({ lab_type: labType });
    return q;
  }

  /** Milliseconds of a session that fall inside [from,to). */
  static clip(s, from, to) {
    const a = Math.max(toMs(s.started_at), from);
    const b = Math.min(s.ended_at ? toMs(s.ended_at) : Date.now(), to);
    return b > a ? [a, b] : null;
  }

  static hours(rows, from, to) {
    let ms = 0;
    for (const s of rows) { const c = Reports.clip(s, from, to); if (c) ms += c[1] - c[0]; }
    return ms / 3_600_000;
  }

  /** [{date, hours}] for each UTC day in [from,to), zeros included. */
  static byDay(rows, from, to) {
    const out = new Map();
    for (let d = dayStartMs(from); d < to; d += DAY) out.set(dayKey(d), 0);
    for (const s of rows) {
      const c = Reports.clip(s, from, to);
      if (!c) continue;
      for (let d = dayStartMs(c[0]); d < c[1]; d += DAY) {
        const ms = Math.min(c[1], d + DAY) - Math.max(c[0], d);
        const k = dayKey(d);
        if (out.has(k)) out.set(k, out.get(k) + ms / 3_600_000);
      }
    }
    return [...out].map(([date, h]) => ({ date, hours: r2(h) }));
  }

  /** Hours per user id. */
  static byUser(rows, from, to) {
    const m = new Map();
    for (const s of rows) {
      const c = Reports.clip(s, from, to);
      if (c) m.set(s.user_id, (m.get(s.user_id) || 0) + (c[1] - c[0]) / 3_600_000);
    }
    return m;
  }

  // ---- student ------------------------------------------------------------------------------
  async usageMe(userId, weeks) {
    const now = Date.now();
    const lastWeek = weekStartMs(now);
    const first = lastWeek - (weeks - 1) * 7 * DAY;
    const rows = await this.sessions({ from: first, to: now + 1, userId });
    const hoursPerWeek = [];
    for (let w = first; w <= lastWeek; w += 7 * DAY) {
      hoursPerWeek.push({ weekStart: dayKey(w), hours: r2(Reports.hours(rows, w, w + 7 * DAY)) });
    }
    const byLab = new Map();
    for (const s of rows) {
      const c = Reports.clip(s, first, now + 1);
      if (c) byLab.set(s.lab_type, (byLab.get(s.lab_type) || 0) + (c[1] - c[0]) / 3_600_000);
    }
    const all = await this.ctx.db('usage_sessions').where({ user_id: userId });
    const labsCreated = Number((await this.ctx.db('environments').where({ user_id: userId }).count({ n: '*' }).first()).n);
    return {
      hoursPerWeek,
      byLabType: [...byLab].map(([labType, h]) => ({ labType, hours: r2(h) })).sort((a, b) => b.hours - a.hours),
      totalHours: r2(Reports.hours(all, 0, now + 1)),
      labsCreated,
    };
  }

  // ---- faculty ------------------------------------------------------------------------------
  async studentIds() { return this.ctx.db('users').where({ role: ROLE.STUDENT }).pluck('id'); }

  async facultyOverview() {
    const { db } = this.ctx;
    const now = Date.now();
    const ids = await this.studentIds();
    const students = Number((await db('users').where({ role: ROLE.STUDENT, status: 'active' }).count({ n: '*' }).first()).n);
    const live = await db('environments as e').join('users as u', 'u.id', 'e.user_id')
      .where('u.role', ROLE.STUDENT).whereIn('e.status', [S.RUNNING, S.INACTIVE])
      .select('e.user_id', 'u.name', 'e.lab_type', 'e.started_at', 'e.created_at').orderBy('e.started_at', 'desc');
    const assigned = Number((await db('activities').count({ n: '*' }).first()).n);
    const from7 = dayStartMs(now) - 6 * DAY;
    const rows7 = await this.sessions({ from: from7, to: now + 1, userIds: ids });
    const rows30 = await this.sessions({ from: now - 30 * DAY, to: now + 1, userIds: ids });
    const avg = students ? Reports.hours(rows30, now - 30 * DAY, now + 1) / students : 0;
    return {
      stats: { students, activeLabs: live.length, assignedActivities: assigned, avgHoursPerStudent: r2(avg) },
      usageByDay: Reports.byDay(rows7, from7, now + 1),
      activeStudents: live.map((r) => ({ userId: r.user_id, name: r.name, labType: r.lab_type, since: pub(r.started_at || r.created_at) })),
    };
  }

  async usageSummary({ from, to }) {
    const { db } = this.ctx;
    const ids = await this.studentIds();
    const labs = await db('environments as e').join('users as u', 'u.id', 'e.user_id').where('u.role', ROLE.STUDENT)
      .where('e.created_at', '>=', isoFromMs(from)).where('e.created_at', '<', isoFromMs(to))
      .groupBy('e.lab_type').select('e.lab_type').count({ n: '*' });
    const rows = await this.sessions({ from, to, userIds: ids });
    const per = Reports.byUser(rows, from, to);
    const names = per.size ? await db('users').whereIn('id', [...per.keys()]).select('id', 'name') : [];
    const nm = new Map(names.map((u) => [u.id, u.name]));
    return {
      mostUsedLabs: labs.map((r) => ({ labType: r.lab_type, count: Number(r.n) })).sort((a, b) => b.count - a.count),
      hoursPerStudent: [...per].map(([userId, h]) => ({ userId, name: nm.get(userId) || userId, hours: r2(h) })).sort((a, b) => b.hours - a.hours),
    };
  }

  // ---- admin --------------------------------------------------------------------------------
  async analytics({ from, to }) {
    const { db } = this.ctx;
    const created = await db('environments').where('created_at', '>=', isoFromMs(from)).where('created_at', '<', isoFromMs(to)).select('created_at', 'lab_id', 'status');
    const perDay = new Map();
    for (let d = dayStartMs(from); d < to; d += DAY) perDay.set(dayKey(d), 0);
    const perLab = new Map();
    const counts = { stopped: 0, terminated: 0 };
    for (const e of created) {
      const k = e.created_at.slice(0, 10);
      if (perDay.has(k)) perDay.set(k, perDay.get(k) + 1);
      perLab.set(e.lab_id, (perLab.get(e.lab_id) || 0) + 1);
      if (e.status === S.STOPPED) counts.stopped++;
      if (e.status === S.TERMINATED) counts.terminated++;
    }
    const labs = await db('labs').select('id', 'name');
    const ln = new Map(labs.map((l) => [l.id, l.name]));
    const rows = await this.sessions({ from, to });
    const per = Reports.byUser(rows, from, to);
    const studentRows = per.size ? await db('users').whereIn('id', [...per.keys()]).select('id', 'name', 'role') : [];
    const nm = new Map(studentRows.filter((u) => u.role === ROLE.STUDENT).map((u) => [u.id, u.name]));
    const finished = rows.filter((s) => s.ended_at);
    const avgMin = finished.length ? finished.reduce((a, s) => a + (toMs(s.ended_at) - toMs(s.started_at)) / 60000, 0) / finished.length : 0;
    return {
      labsCreatedPerDay: [...perDay].map(([date, count]) => ({ date, count })),
      mostUsedTemplates: [...perLab].map(([labId, count]) => ({ labId, name: ln.get(labId) || labId, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      topStudents: [...per].filter(([id]) => nm.has(id)).map(([userId, h]) => ({ userId, name: nm.get(userId), hours: r2(h) })).sort((a, b) => b.hours - a.hours).slice(0, 5),
      avgSessionMinutes: Math.round(avgMin * 10) / 10,
      counts,
    };
  }

  /** CSV with a text cell guard against spreadsheet formula injection (=, +, -, @ at the start). */
  static csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async analyticsCsv(range) {
    const a = await this.analytics(range);
    const line = (...c) => c.map(Reports.csvCell).join(',');
    const out = [
      line('CloudLab analytics', isoFromMs(range.from).slice(0, 10), isoFromMs(range.to).slice(0, 10)),
      line('Average session (minutes)', a.avgSessionMinutes),
      line('Stopped labs', a.counts.stopped), line('Terminated labs', a.counts.terminated), '',
      line('Date', 'Labs created'), ...a.labsCreatedPerDay.map((r) => line(r.date, r.count)), '',
      line('Template', 'Labs created'), ...a.mostUsedTemplates.map((r) => line(r.name, r.count)), '',
      line('Student', 'Hours'), ...a.topStudents.map((r) => line(r.name, r.hours)),
    ];
    return out.join('\r\n') + '\r\n';
  }

  async folderSizes() {
    if (this._folderCache && Date.now() - this._folderCache.at < 30_000) return this._folderCache.v;
    const v = await this.ctx.storage.folderSizesGb();
    this._folderCache = { at: Date.now(), v };
    return v;
  }

  async series(minutes = 120, bucketMin = 5) {
    const since = Date.now() - minutes * 60_000;
    const rows = await this.ctx.db('metric_samples').whereIn('node_id', (await this.ctx.nodes.workers()).map((w) => w.id)).where('at', '>=', isoFromMs(since)).orderBy('at');
    const b = new Map();
    const step = bucketMin * 60_000;
    for (const r of rows) {
      const k = Math.floor(toMs(r.at) / step) * step;
      const e = b.get(k) || { c: 0, m: 0, n: 0 };
      e.c += r.cpu; e.m += r.mem; e.n++;
      b.set(k, e);
    }
    const pts = [...b].sort((x, y) => x[0] - y[0]);
    return {
      cpuSeries: pts.map(([k, e]) => ({ t: pub(isoFromMs(k)), value: Math.round(e.c / e.n) })),
      memorySeries: pts.map(([k, e]) => ({ t: pub(isoFromMs(k)), value: Math.round(e.m / e.n) })),
    };
  }
}

module.exports = { Reports };
