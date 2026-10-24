const crypto = require('crypto');
const http = require('http');
const { DriverError } = require('./errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * In-memory driver for development and tests. Behaves like Docker closely enough for the
 * provisioning engine: containers are created, inspected, started, stopped and listed.
 * With serveWorkspace=true it also starts a tiny HTTP server on the container's host port so
 * "Open workspace" shows a placeholder page locally.
 */
class MockDriver {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.log = logger;
    this.kind = 'mock';
    this.containers = new Map(); // `${nodeId}:${id}` -> record
    this.servers = new Map(); // key -> http.Server
    this.offline = new Set();
    this.faults = []; // [{op, message, times}]
    this.delayMs = cfg.driver.mockStepDelayMs;
    this.serveWorkspace = cfg.driver.mockServeWorkspace;
    this.pulled = new Set();
  }

  // ---- test hooks -------------------------------------------------------------------------
  failNext(op, message = `mock ${op} failure`, times = 1) { this.faults.push({ op, message, times }); }
  setOffline(nodeId, value = true) { value ? this.offline.add(nodeId) : this.offline.delete(nodeId); }
  find(envId) { return [...this.containers.values()].find((c) => c.envId === envId); }
  killContainer(envId) { const c = this.find(envId); if (c) { c.running = false; this._closeServer(c); } }
  oomKill(envId) { const c = this.find(envId); if (c) { c.running = false; c.oomKilled = true; this._closeServer(c); } }
  deleteContainerSilently(envId) { const c = this.find(envId); if (c) { this._closeServer(c); this.containers.delete(c.key); } }
  setUsage(envId, cpuCores, memoryPercent) { const c = this.find(envId); if (c) { c.cpuCores = cpuCores; c.memoryPercent = memoryPercent; c.fixed = true; } }
  async closeAll() { for (const c of this.containers.values()) this._closeServer(c); }

  // ---- internals --------------------------------------------------------------------------
  _check(op, node) {
    if (this.offline.has(node.id)) throw new DriverError(`node ${node.id} unreachable`, { op });
    const i = this.faults.findIndex((f) => f.op === op);
    if (i >= 0) {
      const f = this.faults[i];
      if (--f.times <= 0) this.faults.splice(i, 1);
      throw new DriverError(f.message, { op });
    }
  }
  _key(node, id) { return `${node.id}:${id}`; }
  _get(node, id) { return this.containers.get(this._key(node, id)); }
  _closeServer(c) {
    const s = this.servers.get(c.key);
    if (s) { s.close(); s.closeAllConnections?.(); this.servers.delete(c.key); }
  }

  // ---- interface --------------------------------------------------------------------------
  async prepareNode(node) { this._check('prepareNode', node); }

  async ensureImage(node, image) {
    this._check('ensureImage', node);
    this.pulled.add(`${node.id}:${image}`);
  }

  async create(node, spec) {
    this._check('create', node);
    if (this.delayMs) await sleep(this.delayMs / 2);
    for (const c of this.containers.values()) {
      if (c.nodeId === node.id && c.hostPort === spec.hostPort) throw new DriverError('port is already allocated', { op: 'create' });
      if (c.nodeId === node.id && c.name === spec.name) throw new DriverError('container name already in use', { op: 'create' });
    }
    const id = crypto.randomBytes(6).toString('hex');
    const rec = {
      key: this._key(node, id), id, nodeId: node.id, name: spec.name, envId: spec.envId, hostPort: spec.hostPort,
      spec, running: false, oomKilled: false, cpuCores: 0, memoryPercent: 0,
    };
    this.containers.set(rec.key, rec);
    return id;
  }

  async inspect(node, id) {
    this._check('inspect', node);
    const c = this._get(node, id);
    if (!c) return { exists: false };
    return {
      exists: true,
      running: c.running,
      nanoCpus: Math.round(c.spec.cpu * 1e9),
      memoryBytes: Math.round(c.spec.memoryGb * 1024 ** 3),
      pidsLimit: c.spec.pidsLimit,
      mounts: c.spec.mounts.map((m) => ({ destination: m.dst, rw: !m.ro })),
      oomKilled: c.oomKilled,
    };
  }

  async start(node, id) {
    this._check('start', node);
    if (this.delayMs) await sleep(this.delayMs / 2);
    const c = this._get(node, id);
    if (!c) throw new DriverError('no such container', { op: 'start' });
    c.running = true;
    c.oomKilled = false;
    c.cpuCores = c.fixed ? c.cpuCores : 0.01 + Math.random() * 0.02; // idle by default
    c.memoryPercent = c.fixed ? c.memoryPercent : 18 + Math.random() * 12;
    if (this.serveWorkspace && !this.servers.has(c.key)) await this._serve(c, node);
  }

  _serve(c, node) {
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        if (req.url === '/healthz') { res.setHeader('content-type', 'application/json'); return res.end('{"status":"alive"}'); }
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><title>CloudLab mock workspace</title><body style="font-family:system-ui;background:#0A0E1A;color:#e5e7eb;padding:3rem">
          <h1>CloudLab mock workspace</h1><p>Environment <code>${c.envId}</code> on <code>${node.id}</code>.</p>
          <p>This is the development MockDriver. With DRIVER=docker a code-server IDE is served here.</p></body>`);
      });
      srv.on('error', (e) => { this.log.warn({ err: e.message, port: c.hostPort }, 'mock workspace server failed'); resolve(); });
      srv.listen(c.hostPort, '127.0.0.1', () => { this.servers.set(c.key, srv); resolve(); });
    });
  }

  async waitHealthy(node, hostPort) {
    this._check('waitHealthy', node);
    if (this.delayMs) await sleep(this.delayMs / 2);
    return true;
  }

  async stop(node, id) {
    this._check('stop', node);
    const c = this._get(node, id);
    if (!c) throw new DriverError('no such container', { op: 'stop' });
    c.running = false;
    this._closeServer(c);
  }

  async remove(node, id) {
    this._check('remove', node);
    const c = this._get(node, id);
    if (!c) return;
    this._closeServer(c);
    this.containers.delete(c.key);
  }

  async list(node) {
    this._check('list', node);
    return [...this.containers.values()].filter((c) => c.nodeId === node.id).map((c) => ({
      id: c.id, name: c.name, running: c.running, envId: c.envId, oomKilled: c.oomKilled,
    }));
  }

  async stats(node) {
    this._check('stats', node);
    const out = [];
    for (const c of this.containers.values()) {
      if (c.nodeId !== node.id || !c.running) continue;
      if (!c.fixed) {
        c.cpuCores = Math.max(0.005, Math.min(0.03, c.cpuCores + (Math.random() - 0.5) * 0.01));
        c.memoryPercent = Math.max(10, Math.min(40, c.memoryPercent + (Math.random() - 0.5) * 4));
      }
      out.push({ id: c.id, envId: c.envId, cpuCores: c.cpuCores, memoryPercent: c.memoryPercent, memBytes: (c.memoryPercent / 100) * c.spec.memoryGb * 1024 ** 3 });
    }
    return { containers: out, ncpu: 2, memTotalBytes: 4 * 1024 ** 3 };
  }

  async ping(node) {
    if (this.offline.has(node.id)) return { ok: false, latencyMs: null, error: 'unreachable' };
    return { ok: true, latencyMs: 3 };
  }
}

module.exports = { MockDriver };
