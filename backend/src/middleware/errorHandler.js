const { ApiError, E } = require('../lib/errors');
const { ERR } = require('../constants');

/** One place that turns every failure into { error: { code, message, details } } (Contract section 2). */
function errorHandler(ctx) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let e = err;
    if (!(e instanceof ApiError)) {
      if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) e = E.badRequest('Request body is not valid JSON');
      else if (err?.type === 'entity.too.large') e = E.badRequest('Request body is too large');
      else if (err?.name === 'MulterError') {
        const max = Math.round(ctx.cfg.storage.maxUploadBytes / 1024 ** 2);
        if (err.code === 'LIMIT_FILE_SIZE') e = E.quota(`File is too large (limit ${max} MB)`);
        else e = E.validation({ file: err.message });
      } else {
        ctx.log.error({ err: { message: err?.message, stack: err?.stack }, requestId: req.id, path: req.originalUrl }, 'unhandled error');
        e = new ApiError(500, ERR.INTERNAL_ERROR, `Unexpected error. Quote request id ${req.id} when reporting it.`);
      }
    }
    if (res.headersSent) return res.end();
    res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details || {} } });
  };
}

function notFoundHandler(req, res, next) {
  next(E.notFound(`Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

module.exports = { errorHandler, notFoundHandler };
