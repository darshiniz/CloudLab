const { loadConfig } = require('../src/config');
const { createContext, closeContext } = require('../src/context');
const { seed } = require('../src/db/seed');
(async () => {
  const cfg = loadConfig();
  const ctx = await createContext(cfg);
  await seed(ctx);
  console.log(`Seeded. Admin: ${cfg.seed.adminEmail}${cfg.seed.demoData ? ` | demo accounts use password from SEED_DEMO_PASSWORD` : ''}`);
  await closeContext(ctx);
})().catch((e) => { console.error(e); process.exit(1); });
