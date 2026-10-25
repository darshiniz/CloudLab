import { PROVISIONING_STEPS, SIZE_RESOURCES } from '../../constants/enums';
import { ago, fromNow } from './time';

// Shape: Environment (section 5)
const steps = (doneCount, failedAt = null) =>
  PROVISIONING_STEPS.map((s, i) => ({
    ...s,
    state: failedAt === i ? 'failed' : i < doneCount ? 'done' : 'pending',
  }));

const env = (o) => {
  const running = ['running', 'inactive'].includes(o.status);
  return {
    id: o.id,
    name: o.name,
    userId: o.userId,
    userName: o.userName,
    labId: `lab_${o.labType}`,
    labType: o.labType,
    status: o.status,
    size: o.size,
    resources: { ...SIZE_RESOURCES[o.size] },
    workerId: running ? o.workerId : null,
    containerId: running || o.status === 'stopped' ? o.containerId ?? null : null,
    queuePosition: o.queuePosition ?? null,
    provisioning: {
      currentStep: o.status === 'failed' ? 4 : o.status === 'queued' ? 0 : 7,
      steps: o.status === 'failed' ? steps(3, 3) : o.status === 'queued' ? steps(0) : steps(7),
    },
    usage: running ? o.usage : { cpuPercent: 0, memoryPercent: 0 },
    failureReason: o.failureReason ?? null,
    createdAt: ago(o.createdMin),
    startedAt: running || o.status === 'stopped' ? ago(o.createdMin - 0.2) : null,
    stoppedAt: o.status === 'stopped' || o.status === 'terminated' ? ago(o.stoppedMin ?? 60) : null,
    lastActivityAt: ago(o.lastMin ?? 1),
    autoStopAt: running ? fromNow(o.autoStopMin ?? 30) : null,
  };
};

export const environments = [
  // Anushka (usr_101): one of every interesting state for the demo
  env({ id: 'env_5001', name: 'Pandas Practical 3', userId: 'usr_101', userName: 'Anushka Marcelo', labType: 'python', size: 'standard', status: 'running', workerId: 'worker-1', containerId: 'c3f9a1b2', usage: { cpuPercent: 34, memoryPercent: 52 }, createdMin: 95, lastMin: 1 }),
  env({ id: 'env_5002', name: 'Java OOP Lab', userId: 'usr_101', userName: 'Anushka Marcelo', labType: 'java', size: 'small', status: 'inactive', workerId: 'worker-2', containerId: 'a81d44e0', usage: { cpuPercent: 2, memoryPercent: 31 }, createdMin: 140, lastMin: 22, autoStopMin: 8 }),
  env({ id: 'env_5003', name: 'Portfolio Site', userId: 'usr_101', userName: 'Anushka Marcelo', labType: 'web', size: 'small', status: 'stopped', containerId: '7be0c912', createdMin: 60 * 26, lastMin: 60 * 25, stoppedMin: 60 * 25 }),
  env({ id: 'env_5004', name: 'ML Assignment', userId: 'usr_101', userName: 'Anushka Marcelo', labType: 'python', size: 'standard', status: 'failed', failureReason: 'Container failed to start: image pull timed out on worker-2', createdMin: 300, lastMin: 300 }),

  // Other students: fill worker-1 to 4/4 and worker-2 to 3/4
  env({ id: 'env_5005', name: 'Numpy Arrays', userId: 'usr_103', userName: 'Riya Naik', labType: 'python', size: 'small', status: 'running', workerId: 'worker-1', containerId: 'f02b6c71', usage: { cpuPercent: 61, memoryPercent: 68 }, createdMin: 40, lastMin: 1 }),
  env({ id: 'env_5006', name: 'Express API', userId: 'usr_104', userName: 'Priya Desai', labType: 'web', size: 'standard', status: 'running', workerId: 'worker-1', containerId: '19ce0a3d', usage: { cpuPercent: 88, memoryPercent: 91 }, createdMin: 75, lastMin: 0 }),
  env({ id: 'env_5007', name: 'Linked Lists', userId: 'usr_105', userName: 'Sneha Kamat', labType: 'java', size: 'small', status: 'running', workerId: 'worker-1', containerId: '5d7e2b90', usage: { cpuPercent: 22, memoryPercent: 47 }, createdMin: 30, lastMin: 2 }),
  env({ id: 'env_5008', name: 'Matplotlib Charts', userId: 'usr_106', userName: 'Kavya Shetty', labType: 'python', size: 'standard', status: 'running', workerId: 'worker-2', containerId: 'b44a90ef', usage: { cpuPercent: 47, memoryPercent: 63 }, createdMin: 55, lastMin: 1 }),
  env({ id: 'env_5009', name: 'React Todo', userId: 'usr_107', userName: 'Meera Gaonkar', labType: 'web', size: 'small', status: 'running', workerId: 'worker-2', containerId: '3a0f7d18', usage: { cpuPercent: 30, memoryPercent: 58 }, createdMin: 20, lastMin: 3 }),

  // Cluster starts at 7 of 8 slots: the next lab provisions, the one after that is queued (BR-09)
  env({ id: 'env_5010', name: 'Pandas Basics', userId: 'usr_108', userName: 'Aditi Prabhu', labType: 'python', size: 'small', status: 'stopped', containerId: '6e21b0c4', createdMin: 200, lastMin: 150, stoppedMin: 150 }),
  env({ id: 'env_5011', name: 'Spring Intro', userId: 'usr_109', userName: 'Fatima Shaikh', labType: 'java', size: 'small', status: 'stopped', containerId: 'd90a3f55', createdMin: 260, lastMin: 210, stoppedMin: 210 }),

  // History
  env({ id: 'env_4970', name: 'Flask Intro', userId: 'usr_101', userName: 'Anushka Marcelo', labType: 'web', size: 'small', status: 'terminated', createdMin: 60 * 24 * 6, lastMin: 60 * 24 * 5, stoppedMin: 60 * 24 * 5 }),
  env({ id: 'env_4990', name: 'Flask Login', userId: 'usr_102', userName: 'Darshini Zoraunkar', labType: 'web', size: 'small', status: 'stopped', containerId: '0c1e9a77', createdMin: 60 * 5, lastMin: 60 * 4, stoppedMin: 60 * 4 }),
  env({ id: 'env_4981', name: 'Sorting Algorithms', userId: 'usr_110', userName: 'Rhea Verenkar', labType: 'java', size: 'small', status: 'terminated', createdMin: 60 * 30, lastMin: 60 * 29, stoppedMin: 60 * 29 }),
];
