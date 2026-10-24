const crypto = require('crypto');

/** Every response carries X-Request-Id (the frontend shows it in error toasts). */
function requestId(req, res, next) {
  const inc = req.headers['x-request-id'];
  req.id = typeof inc === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(inc) ? inc : `req_${crypto.randomBytes(6).toString('hex')}`;
  res.setHeader('X-Request-Id', req.id);
  next();
}
module.exports = { requestId };
