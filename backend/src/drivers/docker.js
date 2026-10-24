const { execFile } = require('child_process');
const http = require('http');
const { DriverError } = require('./errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (s) => String(s || '').trim().split('\n')[0].slice(0, 300);

/**
 * Talks to Docker through the docker CLI. Each worker is addressed with DOCKER_HOST, for example
 * ssh://cloudlab@10.0.0.3, so Docker is never exposed on a network port (BRD: SSH over the internal IP).
 * An empty dockerHost means "the local Docker daemon", which is what you want when developing on a laptop.
 */
class DockerCliDriver {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.log = logger;
    this.kind = 'docker';
    this.bin = cfg.driver.dockerBin;
    this.networkReady = new Set();
  }

  _exec(node, args, { timeoutMs = this.cfg.driver.commandTimeoutMs, op = args[0] } = {}) {
    const env = { ...process.env };
    if (node.docker_host) env.DOCKER_HOST = node.docker_host;
    else delete env.DOCKER_HOST;
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const detail = firstLine(stderr) || err.message;
          return reject(new DriverError(`docker ${op} failed: ${detail}`, { op, detail }));
        }
        resolve(String(stdout).trim());
      });
    });
  }

  async prepareNode(node) {
    if (this.networkReady.has(node.id)) return;
    const net = this.cfg.driver.network;
    try {
      await this._exec(node, ['network', 'inspect', net], { op: 'network inspect' });
    } catch {
      // enable_icc=false: lab containers cannot talk to each other (BRD BR-10).
      await this._exec(node, ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.enable_icc=false', net], { op: 'network create' });
    }
    this.networkReady.add(node.id);
  }

  async ensureImage(node, image) {
    try {
      await this._exec(node, ['image', 'inspect', image], { op: 'image inspect' });
      return;
    } catch (e) {
      if (!this.cfg.driver.pullIfMissing) throw e;
    }
    await this._exec(node, ['pull', image], { op: 'pull', timeoutMs: this.cfg.driver.pullTimeoutMs });
  }

  async create(node, spec) {
    await this.prepareNode(node);
    const mem = `${spec.memoryGb}g`;
    const args = [
      'create', '--name', spec.name,
      '--label', 'cloudlab=1', '--label', `cloudlab.env=${spec.envId}`, '--label', `cloudlab.user=${spec.userId}`,
      '--cpus', String(spec.cpu),
      '--memory', mem, '--memory-swap', mem, // no swap: the limit is hard
      '--pids-limit', String(spec.pidsLimit),
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--init', '--restart', 'no',
      '--network', this.cfg.driver.network,
      '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=2',
      '-p', `${spec.bindIp}:${spec.hostPort}:${spec.containerPort}`,
    ];
    for (const m of spec.mounts) args.push('-v', `${m.src}:${m.dst}${m.ro ? ':ro' : ''}`);
    for (const [k, v] of Object.entries(spec.env || {})) args.push('-e', `${k}=${v}`);
    args.push(spec.image);
    const out = await this._exec(node, args, { op: 'create' });
    return out.slice(0, 12);
  }

  async inspect(node, id) {
    let out;
    try {
      out = await this._exec(node, ['inspect', id], { op: 'inspect' });
    } catch (e) {
      if (/no such (object|container)/i.test(e.detail || '')) return { exists: false };
      throw e;
    }
    const j = JSON.parse(out)[0];
    return {
      exists: true,
      running: !!j.State?.Running,
      nanoCpus: j.HostConfig?.NanoCpus ?? 0,
      memoryBytes: j.HostConfig?.Memory ?? 0,
      pidsLimit: j.HostConfig?.PidsLimit ?? 0,
      mounts: (j.Mounts || []).map((m) => ({ destination: m.Destination, rw: !!m.RW })),
      oomKilled: !!j.State?.OOMKilled,
    };
  }

  async start(node, id) { await this._exec(node, ['start', id], { op: 'start' }); }
  async stop(node, id, graceSec = this.cfg.driver.stopGraceSec) {
    await this._exec(node, ['stop', '-t', String(graceSec), id], { op: 'stop', timeoutMs: (graceSec + 30) * 1000 });
  }
  async remove(node, id) {
    try { await this._exec(node, ['rm', '-f', id], { op: 'rm' }); } catch (e) {
      if (!/no such (object|container)/i.test(e.detail || '')) throw e;
    }
  }

  async waitHealthy(node, hostPort, timeoutMs = this.cfg.driver.healthTimeoutMs) {
    const host = node.internal_ip || '127.0.0.1';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await new Promise((resolve) => {
        const req = http.get({ host, port: hostPort, path: '/healthz', timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode < 500); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (ok) return true;
      await sleep(1000);
    }
    return false;
  }

  async list(node) {
    const out = await this._exec(node, ['ps', '-a', '--filter', 'label=cloudlab=1', '--format', '{{.ID}}|{{.Names}}|{{.State}}|{{.Label "cloudlab.env"}}'], { op: 'ps' });
    const rows = out ? out.split('\n').map((l) => l.split('|')) : [];
    const list = rows.map(([id, name, state, envId]) => ({ id: id.slice(0, 12), name, running: state === 'running', envId, oomKilled: false }));
    const stopped = list.filter((c) => !c.running);
    if (stopped.length) {
      const o = await this._exec(node, ['inspect', '--format', '{{.Id}}|{{.State.OOMKilled}}', ...stopped.map((c) => c.id)], { op: 'inspect' });
      for (const line of o.split('\n')) {
        const [full, oom] = line.split('|');
        const c = stopped.find((x) => full.startsWith(x.id));
        if (c) c.oomKilled = oom === 'true';
      }
    }
    return list;
  }

  async stats(node) {
    const info = await this._exec(node, ['info', '--format', '{{.NCPU}}|{{.MemTotal}}'], { op: 'info' });
    const [ncpu, memTotal] = info.split('|').map(Number);
    const out = await this._exec(node, ['stats', '--no-stream', '--format', '{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}|{{.MemUsage}}'], { op: 'stats' });
    const envByName = (name) => (name.startsWith('cl-') ? name.slice(3) : null);
    const containers = [];
    for (const line of out ? out.split('\n') : []) {
      const [id, name, cpu, mem] = line.split('|');
      const envId = envByName(name);
      if (!envId) continue; // not one of ours
      containers.push({ id: id.slice(0, 12), envId, cpuCores: parseFloat(cpu) / 100 || 0, memoryPercent: parseFloat(mem) || 0 });
    }
    return { containers, ncpu: ncpu || 2, memTotalBytes: memTotal || 4 * 1024 ** 3 };
  }

  async ping(node) {
    const t = Date.now();
    try {
      await this._exec(node, ['version', '--format', '{{.Server.Version}}'], { op: 'version', timeoutMs: 8000 });
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, latencyMs: null, error: e.detail || e.message };
    }
  }
}

module.exports = { DockerCliDriver };
