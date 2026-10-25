// Row (snake_case) -> API model (camelCase) exactly as in API Contract v1.0 section 5.
const { pub, toMs, isoFromMs } = require('./time');
const { ENV_STATUS } = require('../constants');

const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

const user = (r) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, status: r.status,
  rollNo: r.roll_no ?? null, createdAt: pub(r.created_at), lastActiveAt: pub(r.last_active_at),
  selfRegistered: !!r.self_registered, approvedBy: r.approved_by_name ?? null, approvedAt: pub(r.approved_at),
});

const lab = (r) => ({
  id: r.id, name: r.name, type: r.type, description: r.description, tools: parseJson(r.tools, []),
  dockerImage: r.docker_image,
  limits: { cpu: r.cpu, memoryGb: r.memory_gb, storageGb: r.storage_gb },
  enabled: !!r.enabled, comingSoon: !!r.coming_soon,
});

/** When the platform will stop this lab on its own (idle limit or session limit, whichever is first). */
function autoStopAt(r, policy) {
  if (r.status !== ENV_STATUS.RUNNING && r.status !== ENV_STATUS.INACTIVE) return null;
  const c = [];
  if (r.session_expires_at) c.push(toMs(r.session_expires_at));
  if (policy?.autoStopEnabled && r.last_activity_at) c.push(toMs(r.last_activity_at) + policy.inactivityMinutes * 60_000);
  return c.length ? isoFromMs(Math.min(...c)).replace(/\.\d+Z$/, 'Z') : null;
}

const env = (r, { queuePosition = null, policy } = {}) => {
  const live = r.status === ENV_STATUS.RUNNING || r.status === ENV_STATUS.INACTIVE;
  return {
    id: r.id, name: r.name, userId: r.user_id, userName: r.user_name, labId: r.lab_id, labType: r.lab_type,
    status: r.status, size: r.size,
    resources: { cpu: r.cpu, memoryGb: r.memory_gb, storageGb: r.storage_gb },
    workerId: r.worker_id ?? null, containerId: r.container_id ?? null,
    queuePosition: r.status === ENV_STATUS.QUEUED ? queuePosition : null,
    provisioning: { currentStep: r.current_step, steps: parseJson(r.steps_json, []) },
    usage: { cpuPercent: live ? Math.round(r.usage_cpu) : 0, memoryPercent: live ? Math.round(r.usage_mem) : 0 },
    failureReason: r.status === ENV_STATUS.FAILED ? r.failure_reason ?? 'Provisioning failed' : null,
    stopReason: r.status === ENV_STATUS.STOPPED ? r.stop_reason ?? null : null, // user | idle | memory_limit | scheduled | admin | ...

    createdAt: pub(r.created_at), startedAt: pub(r.started_at), stoppedAt: pub(r.stopped_at),
    lastActivityAt: pub(r.last_activity_at), autoStopAt: autoStopAt(r, policy),
  };
};

const project = (r, modifiedAt) => ({
  id: r.id, userId: r.user_id, name: r.name, labType: r.lab_type,
  createdAt: pub(r.created_at), modifiedAt: pub(modifiedAt || r.modified_at),
});

const dataset = (r) => ({
  id: r.id, name: r.name, description: r.description, scope: r.scope, sizeBytes: Number(r.size_bytes),
  rows: r.rows ?? null, courses: parseJson(r.courses, []), uploadedBy: r.uploaded_by, uploadedAt: pub(r.uploaded_at),
  mountPath: `/data/${r.scope === 'shared' ? 'shared' : 'mine'}/${r.name}`,
});

const activity = (r, progress) => ({
  id: r.id, title: r.title, description: r.description, labId: r.lab_id, datasetId: r.dataset_id ?? null,
  dueDate: pub(r.due_date), maxMarks: r.max_marks ?? 100,
  assignTo: { type: r.assign_type, studentIds: r.assign_type === 'students' ? parseJson(r.student_ids, []) : [] },
  progress, createdBy: r.created_by, createdAt: pub(r.created_at),
});

module.exports = { user, lab, env, project, dataset, activity, autoStopAt, parseJson };
