const { AzureCloud } = require('./azure');
const { MockCloud } = require('./mock');

/**
 * Cloud provider interface (what the autoscaler needs):
 *   startVm(vmName)      ask the cloud to start the VM (resolves when the request is accepted)
 *   deallocateVm(vmName) stop it and release the compute
 *   powerState(vmName)   'running' | 'starting' | 'deallocated' | ...
 * provider "none" means scaling is not available (the admin page then shows manual info only).
 */
function createCloud(cfg, log, ctx) {
  switch (cfg.cloud.provider) {
    case 'azure': return new AzureCloud(cfg, log);
    case 'mock': return new MockCloud(cfg, log, ctx);
    default: return null;
  }
}

module.exports = { createCloud };
