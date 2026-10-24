// Shared enums: API Contract v1.0, section 3.
// RULE: copy-paste this file to the backend. Never type a status string by hand anywhere else.

export const ROLE = Object.freeze({ STUDENT: 'student', FACULTY: 'faculty', ADMIN: 'admin' });

export const USER_STATUS = Object.freeze({ ACTIVE: 'active', INACTIVE: 'inactive' });

export const LAB_TYPE = Object.freeze({
  PYTHON: 'python',
  JAVA: 'java',
  WEB: 'web',
  DATASCIENCE: 'datascience',
  CLOUD: 'cloud',
});

export const ENV_STATUS = Object.freeze({
  REQUESTED: 'requested',
  QUEUED: 'queued',
  PROVISIONING: 'provisioning',
  RUNNING: 'running',
  INACTIVE: 'inactive',
  STOPPED: 'stopped',
  FAILED: 'failed',
  TERMINATED: 'terminated',
});

export const SIZE = Object.freeze({ SMALL: 'small', STANDARD: 'standard' });

export const SIZE_RESOURCES = Object.freeze({
  small: { cpu: 1, memoryGb: 1, storageGb: 5 },
  standard: { cpu: 2, memoryGb: 2, storageGb: 5 },
});

// Order matters: provisioning.steps always lists all 7 in this order.
export const PROVISIONING_STEPS = Object.freeze([
  { key: 'validate', label: 'Validate request' },
  { key: 'checkResources', label: 'Check resources' },
  { key: 'selectTemplate', label: 'Select template' },
  { key: 'createContainer', label: 'Create container' },
  { key: 'allocateResources', label: 'Allocate CPU/RAM' },
  { key: 'mountStorage', label: 'Mount storage' },
  { key: 'startEnvironment', label: 'Start environment' },
]);

export const STEP_STATE = Object.freeze({ PENDING: 'pending', ACTIVE: 'active', DONE: 'done', FAILED: 'failed' });

export const NODE_STATUS = Object.freeze({ ONLINE: 'online', DEGRADED: 'degraded', OFFLINE: 'offline' });

export const DATASET_SCOPE = Object.freeze({ SHARED: 'shared', MINE: 'mine' });

export const ACTIVITY_STATUS = Object.freeze({ ASSIGNED: 'assigned', IN_PROGRESS: 'inProgress', COMPLETED: 'completed' });

export const FILE_TYPE = Object.freeze({ FILE: 'file', FOLDER: 'folder' });

export const SEVERITY = Object.freeze({ INFO: 'info', WARNING: 'warning', CRITICAL: 'critical' });

// Error codes: section 6
export const ERROR_CODE = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_STATE: 'INVALID_STATE',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CAPACITY_FULL: 'CAPACITY_FULL',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

// Allowed status moves: section 7.3. Anything else is 409 INVALID_STATE.
export const ALLOWED_FROM = Object.freeze({
  start: [ENV_STATUS.STOPPED],
  stop: [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE],
  restart: [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.STOPPED, ENV_STATUS.FAILED],
  delete: Object.values(ENV_STATUS).filter((s) => s !== ENV_STATUS.TERMINATED),
});

// Validation limits from the contract
export const LIMITS = Object.freeze({
  envNameMin: 3,
  envNameMax: 40,
  durationMin: 15,
  durationMax: 240,
  inactivityMin: 15,
  inactivityMax: 120,
  maxLabsPerWorkerMin: 1,
  maxLabsPerWorkerMax: 8,
  storageLimitBytes: 5 * 1024 ** 3,
  pageSizeDefault: 20,
  pageSizeMax: 100,
  pollMs: 2000,
  heartbeatMs: 60000,
});
