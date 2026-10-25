const http = require('http');
const { loadConfig } = require('./config');
const { createContext, closeContext } = require('./context');
const { createApp } = require('./app');
const { seed } = require('./db/seed');

async function main() {
  const cfg = loadConfig();
  const ctx = await createContext(cfg);
  await seed(ctx);
  const app = createApp(ctx);
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (app.locals.workspace.isLabPath(req.url)) app.locals.workspace.upgrade(req, socket, head);
    else socket.destroy();
  });

  // Labs that were mid-provisioning when the process last died cannot continue: mark them failed so students can retry.
  // With several API instances behind a load balancer only the one running the background jobs does this;
  // the reconcile job fails provisioning that nobody has touched for PROVISIONING_STALE_MS on behalf of the others.
  if (cfg.jobs.enabled) await ctx.envs.recover();
  await new Promise((r) => server.listen(cfg.port, r));
  ctx.log.info({ port: cfg.port, driver: cfg.driver.kind, db: cfg.db.client }, 'CloudLab API listening');
  if (cfg.jobs.enabled) ctx.jobs.start();
  ctx.envs.processQueue();

  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return;
    closing = true;
    ctx.log.info({ sig }, 'shutting down');
    ctx.jobs.stop();
    server.close();
    server.closeAllConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref();
    try { app.locals.workspace.close(); await closeContext(ctx); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => ctx.log.error({ err: e?.message }, 'unhandled rejection'));
}

main().catch((e) => { console.error(e); process.exit(1); });
