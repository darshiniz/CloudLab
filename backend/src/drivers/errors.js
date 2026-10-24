class DriverError extends Error {
  constructor(message, { op, detail } = {}) {
    super(message);
    this.name = 'DriverError';
    this.op = op;
    this.detail = detail;
  }
}
module.exports = { DriverError };
