/**
 * Simulated cloud for development and tests. A "VM" is a name with a power state; starting or deallocating one
 * flips the mock container driver's reachability for the matching worker, so the whole scaling loop can be
 * exercised without Azure.
 */
class MockCloud {
  constructor(cfg, log, ctx) {
    this.kind = 'mock';
    this.cfg = cfg;
    this.log = log;
    this.ctx = ctx;
    this.vms = new Map(cfg.workers.map((w) => [w.vmName, { state: 'running', nodeId: w.id }]));
    this.calls = []; // for tests: [{op, vmName}]
    this.failNext = null; // test hook: error message to throw on the next call
    this.timers = new Set();
  }

  _vm(vmName) {
    const vm = this.vms.get(vmName);
    if (!vm) throw new Error(`mock cloud: unknown VM ${vmName}`);
    return vm;
  }
  _maybeFail() { if (this.failNext) { const m = this.failNext; this.failNext = null; throw new Error(m); } }
  _reach(vm, up) { this.ctx?.driver?.setOffline?.(vm.nodeId, !up); }

  async startVm(vmName) {
    this._maybeFail();
    const vm = this._vm(vmName);
    this.calls.push({ op: 'start', vmName });
    if (vm.state === 'running') return;
    vm.state = 'starting';
    const finish = () => { vm.state = 'running'; this._reach(vm, true); };
    if (this.cfg.cloud.mockBootMs <= 0) finish();
    else { const t = setTimeout(() => { this.timers.delete(t); finish(); }, this.cfg.cloud.mockBootMs); t.unref?.(); this.timers.add(t); }
  }

  async deallocateVm(vmName) {
    this._maybeFail();
    const vm = this._vm(vmName);
    this.calls.push({ op: 'deallocate', vmName });
    vm.state = 'deallocated';
    this._reach(vm, false);
  }

  async powerState(vmName) { return this._vm(vmName).state; }
  close() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
}

module.exports = { MockCloud };
