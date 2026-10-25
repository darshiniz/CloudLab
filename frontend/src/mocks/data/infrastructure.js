import { ago, daysAgo } from './time';

// Shape: Node (section 5). Ids are fixed: control, worker-1, worker-2.
// slotsUsed is recalculated by the mock backend from the environments list.
export const nodes = [
  { id: 'control', name: 'Control / API VM', kind: 'control', machineType: 'e2-medium', region: 'asia-south1', status: 'online', cpuPercent: 23, memoryPercent: 41, slotsUsed: null, slotsTotal: null },
  { id: 'worker-1', name: 'Worker VM 1', kind: 'worker', machineType: 'e2-medium', region: 'asia-south1', status: 'online', cpuPercent: 72, memoryPercent: 78, slotsUsed: 4, slotsTotal: 4 },
  { id: 'worker-2', name: 'Worker VM 2', kind: 'worker', machineType: 'e2-medium', region: 'asia-south1', status: 'degraded', cpuPercent: 58, memoryPercent: 87, slotsUsed: 3, slotsTotal: 4 },
];

// Elasticity (addition, see backend docs/CONTRACT_NOTES.md): power state of each worker VM and the scaling log.
export const scaling = {
  autoEnabled: false,
  workers: { 'worker-1': { power: 'on', since: ago(600) }, 'worker-2': { power: 'on', since: ago(600) } },
  events: [],
};

// Shape: Policy (section 5)
export const policy = { autoStopEnabled: true, inactivityMinutes: 30, maxLabsPerWorker: 4 };

export const settings = { region: 'asia-south1', defaults: { cpu: 1, memoryGb: 1, storageGb: 5 } };

export const storage = {
  bucket: 'gs://cloudlab-gbs-storage',
  totalGb: 100,
  folders: [
    { name: 'datasets/', usedGb: 2.1 },
    { name: 'students/', usedGb: 55.7 },
  ],
};

export const alerts = [
  { id: 'alr_3', severity: 'warning', message: 'Worker-2 memory above 85%', createdAt: ago(6) },
  { id: 'alr_2', severity: 'info', message: 'Worker VM 1 is at full capacity (4 of 4 slots)', createdAt: ago(4) },
  { id: 'alr_1', severity: 'critical', message: 'env_5004 failed to provision on worker-2', createdAt: ago(300) },
];

export const autoStopLog = [
  { environmentId: 'env_4990', userName: 'Darshini Zoraunkar', labType: 'web', stoppedAt: ago(240), idleMinutes: 30 },
  { environmentId: 'env_4975', userName: 'Nikita Borkar', labType: 'python', stoppedAt: daysAgo(1), idleMinutes: 30 },
  { environmentId: 'env_4962', userName: 'Rhea Verenkar', labType: 'java', stoppedAt: daysAgo(2), idleMinutes: 45 },
  { environmentId: 'env_4950', userName: 'Meera Gaonkar', labType: 'web', stoppedAt: daysAgo(3), idleMinutes: 30 },
];

export const auditLog = [
  { id: 'aud_14', actorId: 'usr_001', actorName: 'Lab Admin', action: 'policy.update', target: 'inactivityMinutes 45 → 30', at: daysAgo(1) },
  { id: 'aud_13', actorId: 'usr_001', actorName: 'Lab Admin', action: 'user.create', target: 'usr_112 Vaishnavi Kerkar', at: daysAgo(3) },
  { id: 'aud_12', actorId: 'usr_001', actorName: 'Lab Admin', action: 'lab.update', target: 'lab_cloud comingSoon = true', at: daysAgo(5) },
  { id: 'aud_11', actorId: 'usr_020', actorName: 'Dr. Sonia Fernandes', action: 'dataset.upload', target: 'ds_housing', at: daysAgo(20) },
];
