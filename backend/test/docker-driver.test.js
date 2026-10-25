const { test: baseTest, before, after } = require('node:test');
// The fake docker is a script with a shebang; Windows cannot execute it directly (EFTYPE). Runs on Linux/macOS/CI.
const test = (name, fn) => baseTest(name, { skip: process.platform === 'win32' ? 'needs a POSIX shell (fake docker script)' : false }, fn);
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');
const { DockerCliDriver } = require('../src/drivers/docker');

let driver; let logFile; let dir;
const node = { id: 'worker-1', docker_host: 'ssh://cloudlab@10.0.0.3', internal_ip: '10.0.0.3' };
const calls = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-docker-'));
  logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(logFile, '');
  process.env.FAKE_DOCKER_LOG = logFile;
  // Git on Windows does not keep the executable bit, so set it here (the script is run as the `docker` program).
  fs.chmodSync(path.resolve(__dirname, 'fixtures/fake-docker.js'), 0o755);
  const cfg = loadConfig({ NODE_ENV: 'test', DRIVER: 'docker', DOCKER_BIN: path.resolve(__dirname, 'fixtures/fake-docker.js') });
  driver = new DockerCliDriver(cfg, { warn() {}, info() {}, error() {} });
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const spec = {
  envId: 'env_aaaaaaaaaa', userId: 'usr_1', name: 'cl-env_aaaaaaaaaa', image: 'cloudlab/python:1.0', cpu: 2, memoryGb: 2, pidsLimit: 256,
  bindIp: '10.0.0.3', hostPort: 20001, containerPort: 8080,
  mounts: [{ src: '/mnt/cloudlab/students/usr_1/projects', dst: '/workspace' }, { src: '/mnt/cloudlab/datasets', dst: '/data/shared', ro: true }, { src: '/mnt/cloudlab/students/usr_1/datasets', dst: '/data/mine' }],
  env: { CLOUDLAB_ENV_ID: 'env_aaaaaaaaaa' },
};

test('create builds a locked-down docker command and targets the worker through DOCKER_HOST', async () => {
  const id = await driver.create(node, spec);
  assert.equal(id, '0123456789ab');
  const all = calls();
  const net = all.find((c) => c.args[0] === 'network' && c.args[1] === 'create');
  assert.ok(net, 'lab network is created on first use');
  assert.ok(net.args.join(' ').includes('enable_icc=false'), 'containers cannot talk to each other');
  const c = all.find((c) => c.args[0] === 'create');
  assert.equal(c.host, 'ssh://cloudlab@10.0.0.3');
  const a = c.args;
  const has = (...seq) => a.join(' ').includes(seq.join(' '));
  assert.ok(has('--cpus', '2'));
  assert.ok(has('--memory', '2g') && has('--memory-swap', '2g'), 'memory limit is hard (no swap)');
  assert.ok(has('--pids-limit', '256'));
  assert.ok(has('--cap-drop', 'ALL'));
  assert.ok(has('--security-opt', 'no-new-privileges'));
  assert.ok(a.includes('--init'));
  assert.ok(has('--network', 'cloudlab-labs'));
  assert.ok(has('-p', '10.0.0.3:20001:8080'), 'port is bound to the internal IP only');
  assert.ok(!a.includes('--privileged') && !a.some((x) => /docker\.sock/.test(x)));
  assert.ok(has('-v', '/mnt/cloudlab/datasets:/data/shared:ro'));
  assert.ok(has('-v', '/mnt/cloudlab/students/usr_1/projects:/workspace'));
  assert.ok(has('--label', 'cloudlab.env=env_aaaaaaaaaa'));
  assert.equal(a[a.length - 1], 'cloudlab/python:1.0', 'image is the last argument');
  assert.ok(!a.some((x) => x.startsWith('-') && x.includes('cloudlab/python')));
});

test('ensureImage pulls when the image is missing; inspect maps "no such object" to exists:false', async () => {
  await driver.ensureImage(node, 'cloudlab/python:1.0');
  assert.ok(calls().some((c) => c.args[0] === 'pull' && c.args[1] === 'cloudlab/python:1.0'));
  assert.deepEqual(await driver.inspect(node, 'gone'), { exists: false });
});

test('stats only reports CloudLab containers; list parses ps; ping works', async () => {
  const s = await driver.stats(node);
  assert.equal(s.ncpu, 2);
  assert.equal(s.containers.length, 1);
  assert.deepEqual([s.containers[0].envId, s.containers[0].cpuCores, s.containers[0].memoryPercent], ['env_aaaaaaaaaa', 0.5, 25]);
  const l = await driver.list(node);
  assert.deepEqual(l.map((c) => [c.envId, c.running]), [['env_aaaaaaaaaa', true]]);
  assert.equal((await driver.ping(node)).ok, true);
});

test('stop uses a grace period; a local worker (no docker_host) does not set DOCKER_HOST', async () => {
  await driver.stop({ id: 'x', docker_host: null }, 'abc', 10);
  const c = calls().filter((x) => x.args[0] === 'stop').pop();
  assert.deepEqual(c.args, ['stop', '-t', '10', 'abc']);
  assert.equal(c.host, null);
});