const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { migrate } = require('../src/db/schema');
(async () => {
  const db = createDb(loadConfig());
  await migrate(db);
  console.log('Database is up to date.');
  await db.destroy();
})().catch((e) => { console.error(e); process.exit(1); });
