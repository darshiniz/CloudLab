const { createLogger } = require('./lib/logger');
const { createDb } = require('./db');
const { migrate } = require('./db/schema');
const { createDriver } = require('./drivers');
const { Storage } = require('./services/storage');
const { AuthService } = require('./services/auth');
const { UserService } = require('./services/users');
const { AuditService } = require('./services/audit');
const { PolicyService } = require('./services/policy');
const { NodeService } = require('./services/nodes');
const { EnvironmentService } = require('./services/environments');
const { Reports } = require('./services/reports');
const { Jobs } = require('./jobs');

/** Builds every service and wires them together. Nothing listens or starts timers here. */
async function createContext(cfg, { log } = {}) {
  const ctx = { cfg, log: log || createLogger(cfg) };
  ctx.db = createDb(cfg);
  await migrate(ctx.db);
  ctx.driver = createDriver(cfg, ctx.log);
  ctx.storage = new Storage(cfg);
  ctx.auth = new AuthService(ctx);
  ctx.users = new UserService(ctx);
  ctx.audit = new AuditService(ctx);
  ctx.policy = new PolicyService(ctx);
  ctx.nodes = new NodeService(ctx);
  ctx.envs = new EnvironmentService(ctx);
  ctx.reports = new Reports(ctx);
  ctx.jobs = new Jobs(ctx);
  await ctx.policy.init();
  await ctx.nodes.init();
  return ctx;
}

async function closeContext(ctx) {
  ctx.jobs.stop();
  await ctx.driver.closeAll?.();
  await ctx.db.destroy();
}

module.exports = { createContext, closeContext };
