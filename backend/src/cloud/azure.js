/**
 * Starts and deallocates VMs through the Azure Resource Manager REST API.
 * Authenticates with the control VM's own managed identity (no passwords or keys anywhere):
 * give that identity the role "Virtual Machine Contributor" on the resource group (see docs/DEPLOYMENT_AZURE.md).
 * Uses the instance metadata service (169.254.169.254), which only the control VM can reach (labs are blocked from it).
 */
const IMDS = 'http://169.254.169.254/metadata';
const ARM = 'https://management.azure.com';
const COMPUTE_API = '2024-07-01';

class AzureCloud {
  constructor(cfg, log) {
    this.kind = 'azure';
    this.cfg = cfg;
    this.log = log;
    this.token = null; // {value, expiresAt}
    this.scope = null; // {subscriptionId, resourceGroup}
  }

  async _json(url, opts = {}, what = 'request') {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { const j = JSON.parse(text); msg = j.error?.message || j.error_description || msg; } catch { /* keep raw text */ }
      throw new Error(`Azure ${what} failed (${res.status}): ${msg}`);
    }
    return text ? JSON.parse(text) : {};
  }

  async _scope() {
    if (this.scope) return this.scope;
    let { azureSubscriptionId: subscriptionId, azureResourceGroup: resourceGroup } = this.cfg.cloud;
    if (!subscriptionId || !resourceGroup) {
      const md = await this._json(`${IMDS}/instance?api-version=2021-02-01`, { headers: { Metadata: 'true' } }, 'instance metadata');
      subscriptionId = subscriptionId || md.compute.subscriptionId;
      resourceGroup = resourceGroup || md.compute.resourceGroupName;
    }
    this.scope = { subscriptionId, resourceGroup };
    return this.scope;
  }

  async _token() {
    if (this.token && this.token.expiresAt - Date.now() > 120_000) return this.token.value;
    const j = await this._json(`${IMDS}/identity/oauth2/token?api-version=2018-02-01&resource=${encodeURIComponent(ARM + '/')}`,
      { headers: { Metadata: 'true' } }, 'identity token');
    this.token = { value: j.access_token, expiresAt: Number(j.expires_on) * 1000 };
    return this.token.value;
  }

  async _vmUrl(vmName, suffix = '') {
    const { subscriptionId, resourceGroup } = await this._scope();
    return `${ARM}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(vmName)}${suffix}`;
  }

  async _call(method, vmName, suffix) {
    const url = `${await this._vmUrl(vmName, suffix)}?api-version=${COMPUTE_API}`;
    return this._json(url, { method, headers: { Authorization: `Bearer ${await this._token()}`, 'Content-Length': '0' } }, `${method} ${suffix || 'vm'}`);
  }

  /** Request that the VM starts. Resolves once Azure has accepted the request (the VM needs ~1-2 min to boot). */
  async startVm(vmName) { await this._call('POST', vmName, '/start'); }
  /** Deallocate (not just stop): a deallocated VM costs no compute. */
  async deallocateVm(vmName) { await this._call('POST', vmName, '/deallocate'); }

  /** 'running' | 'starting' | 'stopping' | 'deallocating' | 'deallocated' | 'stopped' | 'unknown' */
  async powerState(vmName) {
    const j = await this._call('GET', vmName, '/instanceView');
    const code = (j.statuses || []).map((s) => s.code).find((c) => c?.startsWith('PowerState/'));
    return code ? code.slice('PowerState/'.length) : 'unknown';
  }
}

module.exports = { AzureCloud };
