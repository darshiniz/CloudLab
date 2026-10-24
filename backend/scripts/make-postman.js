// Generates postman/CloudLab.postman_collection.json from the endpoint table below (API Contract v1.0 section 7).
const fs = require('fs');
const path = require('path');

const J = (o) => JSON.stringify(o, null, 2);
const folders = {
  'Health and auth': [
    ['GET', '/health', null, 'noauth'],
    ['POST', '/auth/login', { email: '{{email}}', password: '{{password}}' }, 'login'],
    ['GET', '/auth/me'], ['POST', '/auth/logout'],
  ],
  'Lab catalog': [
    ['GET', '/labs'], ['GET', '/labs?includeDisabled=true'], ['GET', '/labs/lab_python'],
    ['POST', '/labs', { name: 'Go Lab', type: 'python', description: 'Go toolchain', tools: ['go'], dockerImage: 'cloudlab/go:1.0', limits: { cpu: 2, memoryGb: 2, storageGb: 5 } }],
    ['PATCH', '/labs/lab_python', { enabled: true }],
  ],
  'Environments': [
    ['GET', '/environments?page=1&pageSize=20'],
    ['POST', '/environments', { labId: 'lab_python', name: 'My Python lab', size: 'small', durationMinutes: 60 }, 'saveEnv'],
    ['GET', '/environments/{{envId}}'], ['POST', '/environments/{{envId}}/start'], ['POST', '/environments/{{envId}}/stop'],
    ['POST', '/environments/{{envId}}/restart'], ['DELETE', '/environments/{{envId}}'],
    ['POST', '/environments/{{envId}}/heartbeat'], ['GET', '/environments/{{envId}}/access'], ['GET', '/environments/{{envId}}/metrics'],
    ['POST', '/environments/{{envId}}/datasets', { datasetId: 'ds_iris' }],
  ],
  'Projects and files (student)': [
    ['GET', '/projects'], ['POST', '/projects', { name: 'Sales Analysis', labType: 'python' }, 'saveProject'],
    ['DELETE', '/projects/{{projectId}}'], ['GET', '/projects/{{projectId}}/files?path=/'],
    ['POST', '/projects/{{projectId}}/files', { __file: ['file', 'path'] }], ['GET', '/projects/{{projectId}}/files/download?path=/analysis.py'],
    ['DELETE', '/projects/{{projectId}}/files?path=/analysis.py'], ['GET', '/storage/usage'],
  ],
  'Datasets': [
    ['GET', '/datasets?scope=shared'], ['POST', '/datasets', { __file: ['file', 'name', 'description', 'scope', 'courses'] }], ['DELETE', '/datasets/{{datasetId}}'],
  ],
  'Student usage': [['GET', '/usage/me?weeks=8']],
  'Faculty': [
    ['GET', '/faculty/overview'], ['GET', '/faculty/students?search=&page=1&pageSize=20'], ['GET', '/faculty/students/{{studentId}}'],
    ['GET', '/faculty/activities'], ['GET', '/faculty/activities/act_pandas'],
    ['POST', '/faculty/activities', { title: 'Loops', description: 'Practise loops', labId: 'lab_python', dueDate: '2026-12-01T10:00:00Z', datasetId: 'ds_iris', assignTo: { type: 'class', studentIds: [] } }],
    ['GET', '/faculty/sessions?labType=python'], ['GET', '/faculty/usage/summary'],
  ],
  'Admin': [
    ['GET', '/admin/overview'], ['GET', '/admin/infrastructure'], ['GET', '/admin/users?role=student&page=1&pageSize=20'],
    ['POST', '/admin/users', { name: 'New Student', email: 'new.student@gbs.edu', role: 'student', password: 'Secret@123', rollNo: '25P0320050' }],
    ['PATCH', '/admin/users/{{studentId}}', { status: 'inactive' }],
    ['GET', '/admin/policy'], ['PUT', '/admin/policy', { autoStopEnabled: true, inactivityMinutes: 30, maxLabsPerWorker: 4 }],
    ['GET', '/admin/policy/auto-stop-log'], ['GET', '/admin/analytics'], ['GET', '/admin/analytics/export'],
    ['GET', '/admin/settings'], ['PUT', '/admin/settings', { region: 'asia-south1', defaults: { cpu: 1, memoryGb: 1, storageGb: 5 } }],
    ['GET', '/admin/audit-log'],
  ],
};

const scripts = {
  login: ["const r = pm.response.json();", "pm.test('login ok', () => pm.response.code === 200);", "if (r.data) pm.collectionVariables.set('token', r.data.token);"],
  saveEnv: ["const r = pm.response.json();", "if (r.data) pm.collectionVariables.set('envId', r.data.id);"],
  saveProject: ["const r = pm.response.json();", "if (r.data) pm.collectionVariables.set('projectId', r.data.id);"],
};

const item = ([method, url, body, tag]) => {
  const [pathPart, query] = url.split('?');
  const req = {
    method,
    header: [],
    url: {
      raw: `{{baseUrl}}${url}`, host: ['{{baseUrl}}'], path: pathPart.split('/').filter(Boolean),
      query: query ? query.split('&').map((q) => { const [key, value] = q.split('='); return { key, value }; }) : undefined,
    },
  };
  if (body && body.__file) {
    req.body = { mode: 'formdata', formdata: body.__file.map((k) => (k === 'file' ? { key: 'file', type: 'file', src: [] } : { key: k, value: '', type: 'text' })) };
  } else if (body) {
    req.header.push({ key: 'Content-Type', value: 'application/json' });
    req.body = { mode: 'raw', raw: J(body), options: { raw: { language: 'json' } } };
  }
  if (tag === 'noauth' || tag === 'login') req.auth = { type: 'noauth' };
  const out = { name: `${method} ${pathPart}`, request: req };
  if (scripts[tag]) out.event = [{ listen: 'test', script: { type: 'text/javascript', exec: scripts[tag] } }];
  return out;
};

const collection = {
  info: {
    name: 'CloudLab API v1.0',
    description: 'Run "POST /auth/login" first; its test script stores the token. Switch accounts by changing {{email}} / {{password}}.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000/api/v1' }, { key: 'email', value: 'darshini@gbs.edu' }, { key: 'password', value: 'student123' },
    { key: 'token', value: '' }, { key: 'envId', value: '' }, { key: 'projectId', value: '' }, { key: 'datasetId', value: '' }, { key: 'studentId', value: '' },
  ],
  item: Object.entries(folders).map(([name, items]) => ({ name, item: items.map(item) })),
};

fs.mkdirSync(path.resolve(__dirname, '../postman'), { recursive: true });
fs.writeFileSync(path.resolve(__dirname, '../postman/CloudLab.postman_collection.json'), J(collection));
console.log('postman/CloudLab.postman_collection.json written');
