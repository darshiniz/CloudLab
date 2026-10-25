// ─────────────────────────────────────────────────────────────────────────────
// services/api.js: the ONLY place the frontend talks to the backend
// (API Contract v1.0, golden rule 4).
//
//  • Base URL comes from VITE_API_BASE_URL (default /api/v1), never hard-coded.
//  • VITE_USE_MOCKS chooses mock or real calls, per module (section 10):
//      true | false | "projects,datasets,faculty"  (list = only these stay mocked)
//  • Success:  { data, meta? }        → single calls return data, list calls return { data, meta }
//  • Errors:   { error: { code, message, details } } → thrown as ApiError (with X-Request-Id)
// ─────────────────────────────────────────────────────────────────────────────
import { handleMockRequest } from '../mocks/server';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
const MOCK_SETTING = String(import.meta.env.VITE_USE_MOCKS ?? 'true').trim().toLowerCase();
const MOCK_DELAY = Number(import.meta.env.VITE_MOCK_DELAY_MS ?? 350);

export const MODULES = ['auth', 'labs', 'environments', 'projects', 'datasets', 'usage', 'assignments', 'faculty', 'admin'];

export function isMocked(module) {
  if (MOCK_SETTING === 'true') return true;
  if (MOCK_SETTING === 'false') return false;
  return MOCK_SETTING.split(',').map((m) => m.trim()).includes(module);
}

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    Object.assign(this, { name: 'ApiError', status, code, details: details ?? {}, requestId });
  }
}

// ── Token storage ────────────────────────────────────────────────────────────
const TOKEN_KEY = 'cloudlab.token';
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

// ── Core request ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanQuery = (q = {}) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));

async function request(module, method, path, { query, body, download = false } = {}) {
  const token = tokenStore.get();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const q = cleanQuery(query);
  let status, requestId, payload, blob, filename;

  if (isMocked(module)) {
    await sleep(MOCK_DELAY * (0.6 + Math.random() * 0.8));
    const res = await handleMockRequest({ method, path, query: q, body, headers });
    ({ status, body: payload, blob, filename } = res);
    requestId = res.headers['X-Request-Id'];
  } else {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const qs = new URLSearchParams(q).toString();
    let res;
    try {
      res = await fetch(`${BASE_URL}${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers: { ...headers, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
    } catch {
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: "Can't reach the CloudLab server. Is the backend running?" });
    }
    status = res.status;
    requestId = res.headers.get('X-Request-Id') ?? undefined;
    if (download && res.ok) {
      blob = await res.blob();
      filename = /filename="?([^"]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
    } else if (status !== 204) {
      payload = await res.json().catch(() => null);
    }
  }

  if (status >= 400) {
    const err = payload?.error ?? { code: 'INTERNAL_ERROR', message: `Request failed (${status})` };
    const apiError = new ApiError({ status, ...err, requestId });
    if (status === 401 && path !== '/auth/login') window.dispatchEvent(new CustomEvent('cloudlab:unauthenticated'));
    throw apiError;
  }
  if (download) return { blob, filename };
  if (status === 204) return null;
  return payload; // { data, meta? }
}

const one = (p) => p.then((r) => r?.data ?? null);
const form = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, Array.isArray(v) ? v.join(',') : v);
  return fd;
};

/** Save a { blob, filename } from a download endpoint to the user's computer */
export function saveDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename || 'download' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Endpoints (section 7). One function per row in the contract. ─────────────
export const api = {
  // 7.1 Health and auth
  health: () => one(request('auth', 'GET', '/health')),
  login: (email, password) => one(request('auth', 'POST', '/auth/login', { body: { email, password } })),
  me: () => one(request('auth', 'GET', '/auth/me')),
  logout: () => request('auth', 'POST', '/auth/logout'),

  // 7.2 Lab catalog
  listLabs: (query) => request('labs', 'GET', '/labs', { query }),
  getLab: (id) => one(request('labs', 'GET', `/labs/${id}`)),
  createLab: (lab) => one(request('labs', 'POST', '/labs', { body: lab })),
  updateLab: (id, changes) => one(request('labs', 'PATCH', `/labs/${id}`, { body: changes })),

  // 7.3 Environments
  listEnvironments: (query) => request('environments', 'GET', '/environments', { query }),
  createEnvironment: ({ labId, name, size, durationMinutes }) =>
    one(request('environments', 'POST', '/environments', { body: { labId, name, size, durationMinutes } })),
  getEnvironment: (id) => one(request('environments', 'GET', `/environments/${id}`)),
  startEnvironment: (id) => one(request('environments', 'POST', `/environments/${id}/start`)),
  stopEnvironment: (id) => one(request('environments', 'POST', `/environments/${id}/stop`)),
  restartEnvironment: (id) => one(request('environments', 'POST', `/environments/${id}/restart`)),
  deleteEnvironment: (id) => one(request('environments', 'DELETE', `/environments/${id}`)),
  // keepRunning=true is the "I'm still here" button: it resets the idle timer. The automatic 60 s ping does not (BRD BR-11).
  heartbeat: (id, keepRunning = false) =>
    request('environments', 'POST', `/environments/${id}/heartbeat`, keepRunning ? { body: { keepRunning: true } } : {}),
  getAccess: (id) => one(request('environments', 'GET', `/environments/${id}/access`)),
  getMetrics: (id) => one(request('environments', 'GET', `/environments/${id}/metrics`)),
  mountDataset: (id, datasetId) => one(request('environments', 'POST', `/environments/${id}/datasets`, { body: { datasetId } })),

  // 7.4 Projects and files
  listProjects: () => request('projects', 'GET', '/projects'),
  createProject: (name, labType) => one(request('projects', 'POST', '/projects', { body: { name, labType } })),
  deleteProject: (id) => request('projects', 'DELETE', `/projects/${id}`),
  listFiles: (id, path = '/') => request('projects', 'GET', `/projects/${id}/files`, { query: { path } }),
  uploadFile: (id, file, path = '/') => one(request('projects', 'POST', `/projects/${id}/files`, { body: form({ file, path }) })),
  downloadFile: (id, path) => request('projects', 'GET', `/projects/${id}/files/download`, { query: { path }, download: true }),
  deleteFile: (id, path) => request('projects', 'DELETE', `/projects/${id}/files`, { query: { path } }),
  getStorageUsage: () => one(request('projects', 'GET', '/storage/usage')),

  // 7.5 Datasets
  listDatasets: (scope = 'shared') => request('datasets', 'GET', '/datasets', { query: { scope } }),
  uploadDataset: ({ file, name, description, scope, courses }) =>
    one(request('datasets', 'POST', '/datasets', { body: form({ file, name, description, scope, courses }) })),
  deleteDataset: (id) => request('datasets', 'DELETE', `/datasets/${id}`),

  // 7.6 Student usage
  getMyUsage: (weeks = 8) => one(request('usage', 'GET', '/usage/me', { query: { weeks } })),

  // 7.7 Faculty
  getFacultyOverview: () => one(request('faculty', 'GET', '/faculty/overview')),
  listStudents: (query) => request('faculty', 'GET', '/faculty/students', { query }),
  getStudent: (id) => one(request('faculty', 'GET', `/faculty/students/${id}`)),
  // Activities assigned to the signed-in student (addition, see backend docs/CONTRACT_NOTES.md)
  listAssignments: () => request('assignments', 'GET', '/assignments'),
  listActivities: () => request('faculty', 'GET', '/faculty/activities'),
  createActivity: (activity) => one(request('faculty', 'POST', '/faculty/activities', { body: activity })),
  getActivity: (id) => one(request('faculty', 'GET', `/faculty/activities/${id}`)),
  listSessions: (query) => request('faculty', 'GET', '/faculty/sessions', { query }),
  getUsageSummary: (query) => one(request('faculty', 'GET', '/faculty/usage/summary', { query })),

  // 7.8 Admin
  getAdminOverview: () => one(request('admin', 'GET', '/admin/overview')),
  getInfrastructure: () => one(request('admin', 'GET', '/admin/infrastructure')),
  getScaling: () => one(request('admin', 'GET', '/admin/scaling')),
  setAutoScaling: (autoEnabled) => one(request('admin', 'PUT', '/admin/scaling', { body: { autoEnabled } })),
  scaleOutWorker: (id) => one(request('admin', 'POST', `/admin/scaling/workers/${id}/scale-out`)),
  scaleInWorker: (id) => one(request('admin', 'POST', `/admin/scaling/workers/${id}/scale-in`)),
  listUsers: (query) => request('admin', 'GET', '/admin/users', { query }),
  createUser: (user) => one(request('admin', 'POST', '/admin/users', { body: user })),
  updateUser: (id, changes) => one(request('admin', 'PATCH', `/admin/users/${id}`, { body: changes })),
  getPolicy: () => one(request('admin', 'GET', '/admin/policy')),
  updatePolicy: (policy) => one(request('admin', 'PUT', '/admin/policy', { body: policy })),
  getAutoStopLog: (query) => request('admin', 'GET', '/admin/policy/auto-stop-log', { query }),
  getAnalytics: (query) => one(request('admin', 'GET', '/admin/analytics', { query })),
  exportAnalytics: (query) => request('admin', 'GET', '/admin/analytics/export', { query, download: true }),
  getSettings: () => one(request('admin', 'GET', '/admin/settings')),
  updateSettings: (s) => one(request('admin', 'PUT', '/admin/settings', { body: s })),
  getAuditLog: (query) => request('admin', 'GET', '/admin/audit-log', { query }),
};