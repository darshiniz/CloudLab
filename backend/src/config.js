const path = require('path');

function loadConfig(env = process.env) {
  const int = (k, d) => {
    const v = env[k];
    if (v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Config ${k} must be a number, got "${v}"`);
    return n;
  };
  const bool = (k, d) => {
    const v = env[k];
    if (v === undefined || v === '') return d;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
  };
  const str = (k, d) => (env[k] === undefined || env[k] === '' ? d : env[k]);

  const nodeEnv = str('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';
  const root = path.resolve(__dirname, '..');

  const cfg = {
    nodeEnv,
    isProd,
    isTest: nodeEnv === 'test',
    port: int('PORT', 5000),
    apiBase: '/api/v1',
    publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:5000').replace(/\/+$/, ''),
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173,http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: bool('TRUST_PROXY', isProd),

    jwt: {
      secret: str('JWT_SECRET', isProd ? '' : 'dev-only-secret-change-me-please-0123456789'),
      expiresInSec: int('JWT_EXPIRES_IN_SEC', 8 * 3600),
    },

    db: {
      client: str('DB_CLIENT', 'sqlite'), // sqlite | mysql
      file: path.resolve(root, str('DB_FILE', 'data/cloudlab.sqlite')),
      host: str('DB_HOST', '127.0.0.1'),
      port: int('DB_PORT', 3306),
      user: str('DB_USER', 'cloudlab'),
      password: str('DB_PASSWORD', ''),
      database: str('DB_NAME', 'cloudlab'),
      socketPath: str('DB_SOCKET', ''), // Cloud SQL Auth Proxy unix socket, optional
      ssl: bool('DB_SSL', false), // true for Azure Database for MySQL (TLS is mandatory there)
    },

    storage: {
      root: path.resolve(root, str('STORAGE_ROOT', 'data/storage')),
      // Path of the same storage as seen from the worker VM (bind-mount source). Defaults to the same path.
      workerRoot: str('WORKER_STORAGE_ROOT', ''),
      quotaBytes: int('STORAGE_QUOTA_BYTES', 5 * 1024 ** 3),
      totalGb: int('STORAGE_TOTAL_GB', 50),
      bucketName: str('GCS_BUCKET_NAME', 'cloudlab-storage'),
      maxUploadBytes: int('MAX_UPLOAD_BYTES', 100 * 1024 ** 2),
      maxDatasetBytes: int('MAX_DATASET_BYTES', 200 * 1024 ** 2),
    },

    driver: {
      kind: str('DRIVER', 'mock'), // mock | docker
      dockerBin: str('DOCKER_BIN', 'docker'),
      mockStepDelayMs: int('MOCK_STEP_DELAY_MS', 700),
      mockServeWorkspace: bool('MOCK_SERVE_WORKSPACE', true),
      network: str('LAB_DOCKER_NETWORK', 'cloudlab-labs'),
      pidsLimit: int('LAB_PIDS_LIMIT', 256),
      containerPort: int('LAB_CONTAINER_PORT', 8080),
      healthTimeoutMs: int('LAB_HEALTH_TIMEOUT_MS', 60000),
      stopGraceSec: int('LAB_STOP_GRACE_SEC', 10),
      pullIfMissing: bool('LAB_PULL_IF_MISSING', true),
      commandTimeoutMs: int('DOCKER_CMD_TIMEOUT_MS', 60000),
      pullTimeoutMs: int('DOCKER_PULL_TIMEOUT_MS', 300000),
    },

    workers: [
      {
        id: 'worker-1', name: 'Worker VM 1',
        dockerHost: str('WORKER_1_DOCKER_HOST', ''), // e.g. ssh://cloudlab@10.0.0.3
        internalIp: str('WORKER_1_IP', '127.0.0.1'),
        vmName: str('WORKER_1_VM_NAME', 'cloudlab-worker-1'), // cloud VM that the autoscaler starts/stops
      },
      {
        id: 'worker-2', name: 'Worker VM 2',
        dockerHost: str('WORKER_2_DOCKER_HOST', ''),
        internalIp: str('WORKER_2_IP', '127.0.0.1'),
        vmName: str('WORKER_2_VM_NAME', 'cloudlab-worker-2'),
      },
    ],
    // Which API process this is (shown in the X-Served-By response header; useful behind a load balancer).
    instanceId: str('INSTANCE_ID', `api-${int('PORT', 5000)}`),

    // Autoscaler: starts a stopped worker VM when labs wait in the queue, stops an idle one.
    //   CLOUD_PROVIDER=azure  uses the VM's managed identity (role "Virtual Machine Contributor" on the resource group)
    //   CLOUD_PROVIDER=mock   simulated VMs for development and tests;  none = scaling unavailable
    cloud: {
      provider: str('CLOUD_PROVIDER', isProd ? 'none' : 'mock'),
      azureSubscriptionId: str('AZURE_SUBSCRIPTION_ID', ''), // read from the instance metadata service when empty
      azureResourceGroup: str('AZURE_RESOURCE_GROUP', ''),
      mockBootMs: int('MOCK_VM_BOOT_MS', 4000),
    },
    autoscale: {
      enabledAtStart: bool('AUTOSCALE_ENABLED', false), // initial value only; the admin switch is stored in the database
      intervalMs: int('AUTOSCALE_INTERVAL_MS', 15_000),
      scaleOutAfterSec: int('SCALE_OUT_AFTER_SEC', 60), // labs must have been waiting this long
      scaleInIdleMin: int('SCALE_IN_IDLE_MIN', 10), // a worker must have had no labs for this long
      minWorkers: int('MIN_WORKERS', 1),
      cooldownSec: int('SCALE_COOLDOWN_SEC', 120),
      startTimeoutSec: int('WORKER_START_TIMEOUT_SEC', 600),
    },
    machineType: str('MACHINE_TYPE', 'e2-medium'),
    region: str('GCP_REGION', 'asia-south1'),
    hostPortMin: int('HOST_PORT_MIN', 20000),
    hostPortMax: int('HOST_PORT_MAX', 20999),

    limits: {
      maxQueueLength: int('MAX_QUEUE_LENGTH', 10),
      maxActiveEnvsPerStudent: int('MAX_ACTIVE_ENVS_PER_STUDENT', 3),
      loginRatePerMin: int('LOGIN_RATE_PER_MIN', 10),
      defaultAutoStopEnabled: bool('DEFAULT_AUTO_STOP_ENABLED', true),
      defaultInactivityMinutes: int('DEFAULT_INACTIVITY_MINUTES', 30),
      defaultMaxLabsPerWorker: int('DEFAULT_MAX_LABS_PER_WORKER', 4),
    },

    registration: {
      enabled: bool('REGISTRATION_ENABLED', true),
      emailDomain: str('REGISTRATION_EMAIL_DOMAIN', 'gbs.edu').toLowerCase().replace(/^@/, ''), // empty = any address
      maxStudents: int('REGISTRATION_MAX_STUDENTS', 15), // active + pending students
      ratePerMin: int('REGISTRATION_RATE_PER_MIN', 10), // BRD FR-15: 10 requests/min per IP
    },

    jobs: {
      enabled: bool('JOBS_ENABLED', true),
      autoStopIntervalMs: int('AUTOSTOP_INTERVAL_MS', 60_000),
      monitorIntervalMs: int('MONITOR_INTERVAL_MS', 30_000),
      reconcileIntervalMs: int('RECONCILE_INTERVAL_MS', 60_000),
      queueIntervalMs: int('QUEUE_INTERVAL_MS', 5_000),
      inactiveWarningMinutes: int('INACTIVE_WARNING_MINUTES', 5),
      cpuActiveThreshold: int('CPU_ACTIVE_THRESHOLD', 5),
      // BRD BR-11: automatic heartbeats from an open tab are NOT activity. Flip to true to count them.
      heartbeatCountsAsActivity: bool('HEARTBEAT_COUNTS_AS_ACTIVITY', false),
      scheduledStopEnabled: bool('SCHEDULED_STOP_ENABLED', false),
      scheduledStopTime: str('SCHEDULED_STOP_TIME', '16:55'), // local time at SCHEDULED_STOP_UTC_OFFSET_MIN
      scheduledStopUtcOffsetMin: int('SCHEDULED_STOP_UTC_OFFSET_MIN', 330), // IST
      provisioningStaleMs: int('PROVISIONING_STALE_MS', 180_000),
      metricRetentionDays: int('METRIC_RETENTION_DAYS', 7),
      workerBaselineMemMb: int('WORKER_BASELINE_MEM_MB', 600),
    },

    seed: {
      adminEmail: str('SEED_ADMIN_EMAIL', 'admin@gbs.edu'),
      adminPassword: str('SEED_ADMIN_PASSWORD', 'admin123'),
      demoData: bool('SEED_DEMO_DATA', !isProd),
      demoPassword: str('SEED_DEMO_PASSWORD', ''),
    },

    logLevel: str('LOG_LEVEL', 'info'),
    root,
  };

  if (!cfg.storage.workerRoot) cfg.storage.workerRoot = cfg.storage.root;

  // Fail fast on unsafe production config.
  if (isProd) {
    const problems = [];
    if (!cfg.jwt.secret || cfg.jwt.secret.length < 32) problems.push('JWT_SECRET must be set to at least 32 characters');
    if (cfg.driver.kind !== 'docker') problems.push('DRIVER must be "docker" in production');
    if (cfg.seed.adminPassword === 'admin123') problems.push('SEED_ADMIN_PASSWORD must be changed from the default');
    if (!['mysql', 'sqlite'].includes(cfg.db.client)) problems.push('DB_CLIENT must be mysql or sqlite');
    if (problems.length) throw new Error('Unsafe production configuration:\n - ' + problems.join('\n - '));
  }
  if (!['mysql', 'sqlite'].includes(cfg.db.client)) throw new Error('DB_CLIENT must be "sqlite" or "mysql"');
  if (!['mock', 'azure', 'none'].includes(cfg.cloud.provider)) throw new Error('CLOUD_PROVIDER must be "mock", "azure" or "none"');
  if (!['mock', 'docker'].includes(cfg.driver.kind)) throw new Error('DRIVER must be "mock" or "docker"');
  return cfg;
}

module.exports = { loadConfig };
