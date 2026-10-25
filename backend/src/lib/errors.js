const { ERR } = require('../constants');

class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const E = {
  badRequest: (m = 'Malformed request', d) => new ApiError(400, ERR.BAD_REQUEST, m, d),
  unauthenticated: (m = 'Authentication required') => new ApiError(401, ERR.UNAUTHENTICATED, m),
  invalidCredentials: () => new ApiError(401, ERR.INVALID_CREDENTIALS, 'Invalid email or password'),
  forbidden: (m = 'You do not have permission to do this') => new ApiError(403, ERR.FORBIDDEN, m),
  notFound: (m = 'Resource not found') => new ApiError(404, ERR.NOT_FOUND, m),
  invalidState: (m) => new ApiError(409, ERR.INVALID_STATE, m),
  emailExists: () => new ApiError(409, ERR.EMAIL_EXISTS, 'A user with this email already exists'),
  quota: (m = 'Storage quota exceeded') => new ApiError(413, ERR.STORAGE_QUOTA_EXCEEDED, m),
  validation: (details, m = 'Validation failed') => new ApiError(422, ERR.VALIDATION_ERROR, m, details),
  capacityFull: () =>
    new ApiError(503, ERR.CAPACITY_FULL, 'All servers are at capacity and the queue is full. Please try again in a few minutes.'),
  registrationClosed: (m) => new ApiError(403, ERR.REGISTRATION_CLOSED, m),
  rateLimited: () => new ApiError(429, ERR.RATE_LIMITED, 'Too many requests. Please slow down.'),
};

module.exports = { ApiError, E };
