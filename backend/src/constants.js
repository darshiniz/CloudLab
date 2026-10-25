// Shared enums. Values are copy-pasted from API Contract v1.0 section 3. Never retype them elsewhere.
const freeze = (o) => Object.freeze(o);

const ROLE = freeze({ STUDENT: 'student', FACULTY: 'faculty', ADMIN: 'admin' });
const USER_STATUS = freeze({ ACTIVE: 'active', INACTIVE: 'inactive', PENDING: 'pending', REJECTED: 'rejected' });
const LAB_TYPE = freeze({ PYTHON: 'python', JAVA: 'java', WEB: 'web', DATASCIENCE: 'datascience', CLOUD: 'cloud' });
const ENV_STATUS = freeze({
  REQUESTED: 'requested', QUEUED: 'queued', PROVISIONING: 'provisioning', RUNNING: 'running',
  INACTIVE: 'inactive', STOPPED: 'stopped', FAILED: 'failed', TERMINATED: 'terminated',
});
const SIZE = freeze({ SMALL: 'small', STANDARD: 'standard' });
const STEP_KEY = freeze({
  VALIDATE: 'validate', CHECK_RESOURCES: 'checkResources', SELECT_TEMPLATE: 'selectTemplate',
  CREATE_CONTAINER: 'createContainer', ALLOCATE_RESOURCES: 'allocateResources',
  MOUNT_STORAGE: 'mountStorage', START_ENVIRONMENT: 'startEnvironment',
});
const STEP_STATE = freeze({ PENDING: 'pending', ACTIVE: 'active', DONE: 'done', FAILED: 'failed' });
const NODE_STATUS = freeze({ ONLINE: 'online', DEGRADED: 'degraded', OFFLINE: 'offline' });
const DATASET_SCOPE = freeze({ SHARED: 'shared', MINE: 'mine' });
const ACTIVITY_STATUS = freeze({ ASSIGNED: 'assigned', IN_PROGRESS: 'inProgress', COMPLETED: 'completed' });
const FILE_TYPE = freeze({ FILE: 'file', FOLDER: 'folder' });
const SEVERITY = freeze({ INFO: 'info', WARNING: 'warning', CRITICAL: 'critical' });
const ERR = freeze({
  BAD_REQUEST: 'BAD_REQUEST', UNAUTHENTICATED: 'UNAUTHENTICATED', INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', INVALID_STATE: 'INVALID_STATE', EMAIL_EXISTS: 'EMAIL_EXISTS',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED', VALIDATION_ERROR: 'VALIDATION_ERROR',
  CAPACITY_FULL: 'CAPACITY_FULL', INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED', // addition, see CONTRACT_NOTES.md
  REGISTRATION_CLOSED: 'REGISTRATION_CLOSED', // addition: student cap reached
});

const values = (o) => Object.values(o);

// The 7 provisioning steps, in contract order, with UI labels.
const STEPS = freeze([
  { key: STEP_KEY.VALIDATE, label: 'Validate request' },
  { key: STEP_KEY.CHECK_RESOURCES, label: 'Check resources' },
  { key: STEP_KEY.SELECT_TEMPLATE, label: 'Select template' },
  { key: STEP_KEY.CREATE_CONTAINER, label: 'Create container' },
  { key: STEP_KEY.ALLOCATE_RESOURCES, label: 'Allocate CPU/RAM' },
  { key: STEP_KEY.MOUNT_STORAGE, label: 'Mount storage' },
  { key: STEP_KEY.START_ENVIRONMENT, label: 'Start environment' },
]);

// Resource size presets (contract section 3): small 1 vCPU / 1 GB, standard 2 vCPU / 2 GB.
const SIZE_PRESETS = freeze({
  [SIZE.SMALL]: freeze({ cpu: 1, memoryGb: 1 }),
  [SIZE.STANDARD]: freeze({ cpu: 2, memoryGb: 2 }),
});

// Statuses in which an environment holds a slot on a worker.
const SLOT_STATUSES = freeze([ENV_STATUS.PROVISIONING, ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE]);
// Statuses that count as "live" for the per-student limit.
const ACTIVE_STATUSES = freeze([
  ENV_STATUS.REQUESTED, ENV_STATUS.QUEUED, ENV_STATUS.PROVISIONING, ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE,
]);

module.exports = {
  ROLE, USER_STATUS, LAB_TYPE, ENV_STATUS, SIZE, STEP_KEY, STEP_STATE, NODE_STATUS, DATASET_SCOPE,
  ACTIVITY_STATUS, FILE_TYPE, SEVERITY, ERR, STEPS, SIZE_PRESETS, SLOT_STATUSES, ACTIVE_STATUSES, values,
};
