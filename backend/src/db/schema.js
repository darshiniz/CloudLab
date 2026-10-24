// Portable schema (SQLite for dev/tests, MySQL on Cloud SQL). Timestamps are ISO-8601 UTC strings.
// JSON blobs are stored as text. Booleans are 0/1 integers.

const ID = (t, name = 'id') => t.string(name, 40);
const TS = (t, name) => t.string(name, 30);

async function createTable(knex, name, build) {
  if (!(await knex.schema.hasTable(name))) await knex.schema.createTable(name, build);
}

async function migrate(knex) {
  await createTable(knex, 'users', (t) => {
    ID(t).primary();
    t.string('name', 120).notNullable();
    t.string('email', 190).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.string('role', 16).notNullable();
    t.string('status', 16).notNullable().defaultTo('active');
    t.string('roll_no', 32).nullable();
    TS(t, 'created_at').notNullable();
    TS(t, 'last_active_at').nullable();
    t.index(['role', 'status']);
  });

  await createTable(knex, 'revoked_tokens', (t) => {
    t.string('jti', 64).primary();
    t.bigInteger('exp_ms').notNullable();
  });

  await createTable(knex, 'labs', (t) => {
    ID(t).primary();
    t.string('name', 120).notNullable();
    t.string('type', 24).notNullable();
    t.text('description').notNullable();
    t.text('tools').notNullable(); // JSON array
    t.string('docker_image', 255).notNullable();
    t.float('cpu').notNullable();
    t.float('memory_gb').notNullable();
    t.float('storage_gb').notNullable();
    t.integer('enabled').notNullable().defaultTo(1);
    t.integer('coming_soon').notNullable().defaultTo(0);
    TS(t, 'created_at').notNullable();
  });

  await createTable(knex, 'nodes', (t) => {
    t.string('id', 32).primary(); // control, worker-1, worker-2
    t.string('name', 80).notNullable();
    t.string('kind', 16).notNullable();
    t.string('machine_type', 40).notNullable();
    t.string('region', 40).notNullable();
    t.string('status', 16).notNullable().defaultTo('online');
    t.string('docker_host', 255).nullable();
    t.string('internal_ip', 64).nullable();
    t.integer('enabled').notNullable().defaultTo(1);
    t.float('cpu_percent').notNullable().defaultTo(0);
    t.float('memory_percent').notNullable().defaultTo(0);
    TS(t, 'last_seen_at').nullable();
  });

  await createTable(knex, 'environments', (t) => {
    ID(t).primary();
    t.string('name', 80).notNullable();
    ID(t, 'user_id').notNullable().index();
    ID(t, 'lab_id').notNullable();
    t.string('lab_type', 24).notNullable();
    t.string('status', 16).notNullable();
    t.string('size', 16).notNullable();
    t.float('cpu').notNullable();
    t.float('memory_gb').notNullable();
    t.float('storage_gb').notNullable();
    t.string('docker_image', 255).notNullable();
    t.string('worker_id', 32).nullable();
    t.string('container_id', 80).nullable();
    t.integer('host_port').nullable();
    t.bigInteger('queued_seq').nullable();
    t.text('steps_json').notNullable();
    t.integer('current_step').notNullable().defaultTo(0);
    t.float('usage_cpu').notNullable().defaultTo(0);
    t.float('usage_mem').notNullable().defaultTo(0);
    t.text('failure_reason').nullable();
    t.integer('duration_minutes').notNullable();
    t.string('stop_reason', 32).nullable();
    TS(t, 'created_at').notNullable();
    TS(t, 'started_at').nullable();
    TS(t, 'stopped_at').nullable();
    TS(t, 'last_activity_at').nullable();
    TS(t, 'last_heartbeat_at').nullable();
    TS(t, 'usage_at').nullable();
    TS(t, 'session_expires_at').nullable();
    TS(t, 'updated_at').notNullable();
    t.index(['status']);
    t.index(['worker_id', 'status']);
    t.index(['user_id', 'status']);
  });

  await createTable(knex, 'env_events', (t) => {
    t.increments('seq');
    ID(t, 'env_id').nullable().index();
    ID(t, 'user_id').notNullable();
    t.string('type', 32).notNullable();
    t.text('message').notNullable();
    TS(t, 'at').notNullable();
    t.index(['user_id', 'at']);
  });

  await createTable(knex, 'usage_sessions', (t) => {
    t.increments('seq');
    ID(t, 'env_id').notNullable().index();
    ID(t, 'user_id').notNullable();
    t.string('lab_type', 24).notNullable();
    TS(t, 'started_at').notNullable();
    TS(t, 'ended_at').nullable();
    t.float('cpu_sum').notNullable().defaultTo(0);
    t.float('mem_sum').notNullable().defaultTo(0);
    t.integer('samples').notNullable().defaultTo(0);
    t.index(['user_id', 'started_at']);
    t.index(['started_at']);
  });

  await createTable(knex, 'projects', (t) => {
    ID(t).primary();
    ID(t, 'user_id').notNullable().index();
    t.string('name', 120).notNullable();
    t.string('lab_type', 24).notNullable();
    t.string('folder', 160).notNullable();
    TS(t, 'created_at').notNullable();
    TS(t, 'modified_at').notNullable();
  });

  await createTable(knex, 'datasets', (t) => {
    ID(t).primary();
    t.string('name', 190).notNullable();
    t.text('description').notNullable();
    t.string('scope', 16).notNullable();
    t.bigInteger('size_bytes').notNullable();
    t.integer('rows').nullable();
    t.text('courses').notNullable(); // JSON array
    ID(t, 'uploaded_by').notNullable();
    TS(t, 'uploaded_at').notNullable();
    t.string('rel_path', 400).notNullable(); // path under STORAGE_ROOT
    t.index(['scope']);
  });

  await createTable(knex, 'env_datasets', (t) => {
    ID(t, 'env_id').notNullable();
    ID(t, 'dataset_id').notNullable();
    TS(t, 'mounted_at').notNullable();
    t.primary(['env_id', 'dataset_id']);
  });

  await createTable(knex, 'activities', (t) => {
    ID(t).primary();
    t.string('title', 160).notNullable();
    t.text('description').notNullable();
    ID(t, 'lab_id').notNullable();
    ID(t, 'dataset_id').nullable();
    TS(t, 'due_date').notNullable();
    t.string('assign_type', 16).notNullable();
    t.text('student_ids').notNullable(); // JSON array
    ID(t, 'created_by').notNullable();
    TS(t, 'created_at').notNullable();
  });

  await createTable(knex, 'policy', (t) => {
    t.integer('id').primary();
    t.integer('auto_stop_enabled').notNullable();
    t.integer('inactivity_minutes').notNullable();
    t.integer('max_labs_per_worker').notNullable();
  });

  await createTable(knex, 'settings', (t) => {
    t.integer('id').primary();
    t.string('region', 40).notNullable();
    t.float('default_cpu').notNullable();
    t.float('default_memory_gb').notNullable();
    t.float('default_storage_gb').notNullable();
  });

  await createTable(knex, 'audit_log', (t) => {
    t.increments('seq');
    ID(t, 'actor_id').nullable();
    t.string('actor_name', 120).notNullable();
    t.string('action', 80).notNullable();
    t.string('target', 190).notNullable();
    TS(t, 'at').notNullable();
  });

  await createTable(knex, 'auto_stop_log', (t) => {
    t.increments('seq');
    ID(t, 'env_id').notNullable();
    t.string('user_name', 120).notNullable();
    t.string('lab_type', 24).notNullable();
    TS(t, 'stopped_at').notNullable();
    t.integer('idle_minutes').notNullable();
  });

  await createTable(knex, 'metric_samples', (t) => {
    t.increments('seq');
    t.string('node_id', 32).notNullable();
    t.float('cpu').notNullable();
    t.float('mem').notNullable();
    TS(t, 'at').notNullable();
    t.index(['at']);
  });

  await createTable(knex, 'alerts', (t) => {
    t.increments('seq');
    t.string('alert_key', 120).notNullable();
    t.string('severity', 16).notNullable();
    t.text('message').notNullable();
    TS(t, 'created_at').notNullable();
    TS(t, 'resolved_at').nullable();
    t.index(['alert_key']);
  });
}

module.exports = { migrate };
