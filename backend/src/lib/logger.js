const pino = require('pino');
function createLogger(cfg) {
  return pino({ level: cfg.isTest ? 'silent' : cfg.logLevel, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });
}
module.exports = { createLogger };
