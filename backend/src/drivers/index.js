const { MockDriver } = require('./mock');
const { DockerCliDriver } = require('./docker');

/**
 * Container driver interface (every method takes the worker node row as first argument):
 *   prepareNode(node)                        ensure network etc. (idempotent)
 *   ensureImage(node, image)                 pull if missing
 *   create(node, spec) -> containerId        docker create (not started)
 *   inspect(node, id)  -> {exists, running, nanoCpus, memoryBytes, pidsLimit, mounts[], oomKilled}
 *   start(node, id) / stop(node, id, graceSec) / remove(node, id)
 *   waitHealthy(node, hostPort, timeoutMs) -> boolean
 *   list(node)  -> [{id, name, running, envId, oomKilled}]
 *   stats(node) -> {containers:[{id, envId, cpuCores, memoryPercent}], ncpu, memTotalBytes}
 *   ping(node)  -> {ok, latencyMs, error?}
 */
function createDriver(cfg, logger) {
  return cfg.driver.kind === 'docker' ? new DockerCliDriver(cfg, logger) : new MockDriver(cfg, logger);
}

module.exports = { createDriver };
