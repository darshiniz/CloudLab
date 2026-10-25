const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { AzureCloud } = require('../src/cloud/azure');

/** Replaces fetch with a fake Azure (instance metadata + Resource Manager) for the duration of fn. */
async function withFakeAzure(handler, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} });
    const r = await handler(String(url), opts);
    return { ok: r.status < 400, status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '')) };
  };
  try { await fn(calls); } finally { global.fetch = real; }
}

const imds = (url) => {
  if (url.includes('/metadata/instance')) return { status: 200, body: { compute: { subscriptionId: 'sub-1', resourceGroupName: 'cloudlab-rg' } } };
  if (url.includes('/metadata/identity/oauth2/token')) return { status: 200, body: { access_token: 'tok-1', expires_on: String(Math.floor(Date.now() / 1000) + 3600) } };
  return null;
};
const cloud = () => new AzureCloud(loadConfig({ NODE_ENV: 'test', CLOUD_PROVIDER: 'azure' }), { warn() {}, info() {} });

test('startVm and deallocateVm call the Resource Manager with the managed-identity token', async () => {
  await withFakeAzure((url) => imds(url) || { status: 202, body: '' }, async (calls) => {
    const c = cloud();
    await c.startVm('cloudlab-worker-2');
    await c.deallocateVm('cloudlab-worker-2');
    const arm = calls.filter((x) => x.url.startsWith('https://management.azure.com'));
    assert.equal(arm.length, 2);
    assert.equal(arm[0].method, 'POST');
    assert.match(arm[0].url, /^https:\/\/management\.azure\.com\/subscriptions\/sub-1\/resourceGroups\/cloudlab-rg\/providers\/Microsoft\.Compute\/virtualMachines\/cloudlab-worker-2\/start\?api-version=/);
    assert.match(arm[1].url, /\/deallocate\?api-version=/);
    assert.equal(arm[0].headers.Authorization, 'Bearer tok-1');
    const tokenCalls = calls.filter((x) => x.url.includes('oauth2/token'));
    assert.equal(tokenCalls.length, 1, 'the token is cached');
    assert.equal(tokenCalls[0].headers.Metadata, 'true');
    assert.match(tokenCalls[0].url, /resource=https%3A%2F%2Fmanagement\.azure\.com%2F/);
  });
});

test('powerState reads the PowerState status from the instance view', async () => {
  await withFakeAzure((url) => imds(url) || { status: 200, body: { statuses: [{ code: 'ProvisioningState/succeeded' }, { code: 'PowerState/deallocated' }] } }, async (calls) => {
    assert.equal(await cloud().powerState('cloudlab-worker-1'), 'deallocated');
    assert.match(calls.find((x) => x.url.includes('instanceView')).url, /virtualMachines\/cloudlab-worker-1\/instanceView/);
  });
});

test('Azure errors become readable messages', async () => {
  await withFakeAzure((url) => imds(url) || { status: 403, body: { error: { code: 'AuthorizationFailed', message: 'The client does not have authorization to perform action' } } }, async () => {
    await assert.rejects(() => cloud().startVm('cloudlab-worker-2'), /403.*does not have authorization/);
  });
});

test('subscription and resource group can be set explicitly instead of read from metadata', async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', CLOUD_PROVIDER: 'azure', AZURE_SUBSCRIPTION_ID: 'abc', AZURE_RESOURCE_GROUP: 'my-rg' });
  await withFakeAzure((url) => imds(url) || { status: 202, body: '' }, async (calls) => {
    await new AzureCloud(cfg, { warn() {} }).startVm('vm');
    assert.ok(!calls.some((x) => x.url.includes('/metadata/instance')));
    assert.match(calls.find((x) => x.url.includes('/start')).url, /subscriptions\/abc\/resourceGroups\/my-rg\//);
  });
});
