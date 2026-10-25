const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { nowIso } = require('../lib/time');
const { ROLE } = require('../constants');

const SEED_DATA = path.resolve(__dirname, '../../seed-data');

const LABS = [
  { id: 'lab_python', name: 'Python Lab', type: 'python', description: 'Python 3 with Jupyter-ready data science libraries.', tools: ['Python 3.12', 'pip', 'pandas', 'numpy', 'scikit-learn'], image: 'cloudlab/python:1.0', enabled: 1, soon: 0 },
  { id: 'lab_java', name: 'Java Lab', type: 'java', description: 'JDK 21 with Maven and Gradle.', tools: ['OpenJDK 21', 'Maven', 'Gradle'], image: 'cloudlab/java:1.0', enabled: 1, soon: 0 },
  { id: 'lab_web', name: 'Web Dev Lab', type: 'web', description: 'Node.js and a static web server for HTML, CSS and JavaScript.', tools: ['Node.js 22', 'npm', 'HTML/CSS/JS'], image: 'cloudlab/web:1.0', enabled: 1, soon: 0 },
  { id: 'lab_datascience', name: 'Data Science Lab', type: 'datascience', description: 'Python and R for data analysis, statistics and machine learning, with JupyterLab.', tools: ['Python 3', 'pandas', 'scikit-learn', 'statsmodels', 'JupyterLab', 'R'], image: 'cloudlab/datascience:1.0', enabled: 1, soon: 0 },
  { id: 'lab_cloud', name: 'Cloud Lab', type: 'cloud', description: 'Coming soon.', tools: ['gcloud', 'Terraform'], image: 'cloudlab/cloud:1.0', enabled: 1, soon: 1 },
];

const DATASETS = [
  { id: 'ds_iris', file: 'iris.csv', description: 'Classic flower measurements (150 rows).', courses: ['MCA-Python'] },
  { id: 'ds_titanic', file: 'titanic.csv', description: 'Passenger records for survival analysis (synthetic sample, 891 rows).', courses: ['MCA-Python'] },
  { id: 'ds_housing', file: 'housing.csv', description: 'House prices vs size and location (synthetic sample, 500 rows).', courses: ['MCA-Python'] },
];

/** Idempotent. Creates the admin, the lab catalog and (outside production) demo accounts and datasets. */
async function seed(ctx) {
  const { db, cfg, users, storage } = ctx;
  const system = null;

  if (!(await users.byEmail(cfg.seed.adminEmail))) {
    await users.create({ name: 'Administrator', email: cfg.seed.adminEmail, role: ROLE.ADMIN, password: cfg.seed.adminPassword }, system);
  }

  const now = nowIso();
  for (const l of LABS) {
    const have = await db('labs').where({ id: l.id }).first();
    if (have) {
      // Data Science used to be "coming soon": switch an existing database over once, without touching anything an admin edited later.
      if (l.id === 'lab_datascience' && have.coming_soon && have.description === 'Coming soon.') {
        await db('labs').where({ id: l.id }).update({ coming_soon: 0, description: l.description, tools: JSON.stringify(l.tools) });
      }
      continue;
    }
    await db('labs').insert({
      id: l.id, name: l.name, type: l.type, description: l.description, tools: JSON.stringify(l.tools), docker_image: l.image,
      cpu: 2, memory_gb: 2, storage_gb: 5, enabled: l.enabled, coming_soon: l.soon, created_at: now,
    });
  }

  if (!cfg.seed.demoData) return;
  // Same demo accounts as the frontend's login page ("try a demo role"); SEED_DEMO_PASSWORD overrides all of them.
  const pw = (def) => cfg.seed.demoPassword || def;
  const demo = [
    ['Dr. Sonia Fernandes', 'sonia@gbs.edu', ROLE.FACULTY, null, 'faculty123'],
    ['Anushka Marcelo', 'anushka@gbs.edu', ROLE.STUDENT, '25P0320011', 'student123'],
    ['Darshini Zoraunkar', 'darshini@gbs.edu', ROLE.STUDENT, '25P0320018', 'student123'],
    ['Riya Naik', 'riya@gbs.edu', ROLE.STUDENT, '25P0320013', 'student123'],
    ['Sneha Kamat', 'sneha@gbs.edu', ROLE.STUDENT, '25P0320015', 'student123'],
  ];
  for (const [name, email, role, rollNo, def] of demo) {
    if (!(await users.byEmail(email))) await users.create({ name, email, role, password: pw(def), rollNo }, system);
  }

  const faculty = await users.byEmail('sonia@gbs.edu');
  for (const d of DATASETS) {
    if (await db('datasets').where({ id: d.id }).first()) continue;
    const src = path.join(SEED_DATA, d.file);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(storage.datasetsDir, d.file);
    await require('stream/promises').pipeline(require('fs').createReadStream(src), require('fs').createWriteStream(dest));
    await db('datasets').insert({
      id: d.id, name: d.file, description: d.description, scope: 'shared', size_bytes: (await fsp.stat(dest)).size,
      rows: await storage.countCsvRows(dest), courses: JSON.stringify(d.courses), uploaded_by: faculty.id, uploaded_at: now,
      rel_path: `datasets/${d.file}`,
    });
  }
  if (!(await db('activities').first())) {
    await db('activities').insert({
      id: 'act_pandas', title: 'Pandas basics', description: 'Clean and summarise the titanic dataset.', lab_id: 'lab_python', dataset_id: 'ds_titanic',
      due_date: new Date(Date.now() + 14 * 86_400_000).toISOString(), assign_type: 'class', student_ids: '[]', created_by: faculty.id, created_at: now,
    });
  }
}

module.exports = { seed };
