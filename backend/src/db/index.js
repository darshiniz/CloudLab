const knexLib = require('knex');
const fs = require('fs');
const path = require('path');

function createDb(cfg) {
  if (cfg.db.client === 'sqlite') {
    const file = cfg.db.file === ':memory:' ? ':memory:' : cfg.db.file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    // One connection keeps SQLite writes serialised (and makes a throw-away database simple).
    return knexLib({
      client: require('./node-sqlite-client'),
      connection: { filename: file },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });
  }
  const connection = {
    user: cfg.db.user, password: cfg.db.password, database: cfg.db.database, timezone: 'Z', charset: 'utf8mb4',
  };
  if (cfg.db.ssl) connection.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  if (cfg.db.socketPath) connection.socketPath = cfg.db.socketPath;
  else { connection.host = cfg.db.host; connection.port = cfg.db.port; }
  return knexLib({ client: 'mysql2', connection, pool: { min: 1, max: 10 } });
}

module.exports = { createDb };
