const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { E } = require('./lib/errors');
const { requestId } = require('./middleware/requestId');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createWorkspaceProxy } = require('./proxy/workspace');

// Endpoints whose JSON body is required: an absent body is BAD_REQUEST (contract section 6).
const NEEDS_BODY = [
  ['POST', /^\/auth\/login$/], ['POST', /^\/environments$/], ['POST', /^\/environments\/[^/]+\/datasets$/],
  ['POST', /^\/labs$/], ['PATCH', /^\/labs\/[^/]+$/], ['POST', /^\/projects$/],
  ['POST', /^\/admin\/users$/], ['PATCH', /^\/admin\/users\/[^/]+$/], ['PUT', /^\/admin\/(policy|settings)$/],
  ['POST', /^\/faculty\/activities$/],
];
const bodyRequired = (req, res, next) => {
  const need = NEEDS_BODY.some(([m, re]) => m === req.method && re.test(req.path));
  if (need && (req.body === undefined || req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))) {
    return next(E.badRequest('A JSON request body is required'));
  }
  next();
};

function createApp(ctx) {
  const { cfg } = ctx;
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.use(requestId);
  app.use(pinoHttp({
    logger: ctx.log, genReqId: (req) => req.id,
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url.replace(/wt=[^&]+/, 'wt=***') }), res: (r) => ({ statusCode: r.statusCode }) },
  }));

  const ws = createWorkspaceProxy(ctx);
  app.locals.workspace = ws;
  app.use('/lab', ws.http);

  const api = express.Router();
  api.use(helmet());
  // CORS is configured once, here (contract section 2). Origins come from CORS_ORIGINS.
  api.use(cors({
    origin: cfg.corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'], exposedHeaders: ['X-Request-Id', 'Content-Disposition'], maxAge: 600,
  }));
  api.use(express.json({ limit: '200kb' }));
  api.use(bodyRequired);
  for (const name of ['auth', 'labs', 'environments', 'projects', 'datasets', 'usage', 'faculty', 'admin']) {
    api.use(require(`./routes/${name}`)(ctx));
  }
  api.use(notFoundHandler);
  app.use(cfg.apiBase, api);
  app.use(notFoundHandler);
  app.use(errorHandler(ctx));
  return app;
}

module.exports = { createApp };
