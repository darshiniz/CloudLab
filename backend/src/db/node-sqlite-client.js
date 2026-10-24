// Knex client for the SQLite that is built into Node (node:sqlite, Node 22.13+ and 24).
// It replaces the better-sqlite3 package so nothing has to be compiled (no Visual Studio / build tools needed).
const Client_BetterSQLite3 = require('knex/lib/dialects/better-sqlite3');

const READS = /^\s*(select|with|pragma|explain|values)\b/i;

class Client_NodeSqlite extends Client_BetterSQLite3 {
  _driver() { return require('node:sqlite'); }

  async acquireRawConnection() {
    const { DatabaseSync } = this.driver;
    const db = new DatabaseSync(this.connectionSettings.filename);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    return db;
  }

  async destroyRawConnection(connection) { connection.close(); }

  async _query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');
    if (!connection) throw new Error('No connection provided');
    const statement = connection.prepare(obj.sql);
    const bindings = this._formatBindings(obj.bindings).map((b) => (b === undefined ? null : b));
    if (READS.test(obj.sql) || /\breturning\b/i.test(obj.sql)) {
      obj.response = statement.all(...bindings);
      return obj;
    }
    const response = statement.run(...bindings);
    obj.response = response;
    obj.context = { lastID: Number(response.lastInsertRowid), changes: Number(response.changes) };
    return obj;
  }
}

Client_NodeSqlite.prototype.driverName = 'node-sqlite';
module.exports = Client_NodeSqlite;
