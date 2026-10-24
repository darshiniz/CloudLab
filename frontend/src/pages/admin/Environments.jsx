import { useState } from 'react';
import { Flame, RotateCcw, Square, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { ENV_STATUS } from '../../constants/enums';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Button, Card, DataTable, Modal, Mono, PageHeader, ResourceBar, Select, StatusBadge } from '../../components/ui';
import LabIcon from '../../components/labs/LabIcon';
import { labLabel, timeAgo, uptime } from '../../utils/format';

const hungry = (e) => e.usage.cpuPercent >= 80 || e.usage.memoryPercent >= 85;

export default function Environments() {
  const [status, setStatus] = useState('');
  const [worker, setWorker] = useState('');
  const [confirm, setConfirm] = useState(null);
  const { run, busy } = useAction();
  const envs = useQuery(() => api.listEnvironments({ status: status || undefined, workerId: worker || undefined, pageSize: 100 }), [status, worker], { interval: 4000 });
  const rows = (envs.data?.data ?? []).filter((e) => status || e.status !== ENV_STATUS.TERMINATED);
  const live = (e) => [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(e.status);

  const columns = [
    { key: 'id', header: 'Environment', render: (e) => <div><Mono className="text-gray-300">{e.id}</Mono><p className="text-xs text-gray-500">{e.name}</p></div> },
    { key: 'userName', header: 'Student' },
    { key: 'labType', header: 'Lab', render: (e) => <span className="flex items-center gap-2"><LabIcon type={e.labType} size="sm" />{labLabel(e.labType)}</span> },
    { key: 'workerId', header: 'Worker VM', render: (e) => <Mono>{e.workerId ?? '—'}</Mono>, hideOnMobile: true },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
    { key: 'cpu', header: 'CPU', sortValue: (e) => e.usage.cpuPercent, render: (e) => <div className="flex items-center gap-2">{e.usage.cpuPercent >= 80 && <Flame className="h-3.5 w-3.5 text-red-400" />}<ResourceBar value={e.usage.cpuPercent} display={`${e.usage.cpuPercent}%`} className="w-24" size="sm" /><span className="font-mono text-xs">{e.usage.cpuPercent}%</span></div>, hideOnMobile: true },
    { key: 'ram', header: 'RAM', sortValue: (e) => e.usage.memoryPercent, render: (e) => <div className="flex items-center gap-2"><ResourceBar value={e.usage.memoryPercent} className="w-24" size="sm" /><span className="font-mono text-xs">{e.usage.memoryPercent}%</span></div>, hideOnMobile: true },
    { key: 'uptime', header: 'Uptime', sortValue: (e) => (live(e) ? new Date(e.startedAt).getTime() * -1 : 0), render: (e) => <Mono>{live(e) ? uptime(e.startedAt) : '—'}</Mono>, hideOnMobile: true },
    { key: 'lastActivityAt', header: 'Last activity', render: (e) => timeAgo(e.lastActivityAt), hideOnMobile: true },
    { key: 'actions', header: '', sortable: false, render: (e) => (
      <div className="flex justify-end gap-1.5">
        {live(e) && <Button size="sm" variant="secondary" icon={Square} loading={busy === `${e.id}:stop`} onClick={() => run(`${e.id}:stop`, () => api.stopEnvironment(e.id), { success: `${e.id} stopped`, after: envs.refresh })}>Stop</Button>}
        {[ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.STOPPED, ENV_STATUS.FAILED].includes(e.status) && <Button size="sm" variant="secondary" icon={RotateCcw} loading={busy === `${e.id}:restart`} onClick={() => run(`${e.id}:restart`, () => api.restartEnvironment(e.id), { success: `${e.id} restarting`, after: envs.refresh })}>Restart</Button>}
        {e.status !== ENV_STATUS.TERMINATED && <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirm(e)}>Terminate</Button>}
      </div>
    ) },
  ];

  const hungryCount = rows.filter(hungry).length;
  return (
    <>
      <PageHeader title="Active Environments" description="Every lab container across both worker VMs." />
      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={rows}
          loading={envs.loading}
          searchKeys={['id', 'name', 'userName', 'labType']}
          searchPlaceholder="Search by ID, student or lab…"
          rowClassName={(e) => (hungry(e) && live(e) ? 'bg-red-500/[0.06] hover:bg-red-500/10' : '')}
          initialSort={{ key: 'cpu', dir: 'desc' }}
          pageSize={12}
          toolbar={<>
            {hungryCount > 0 && <span className="flex items-center gap-1.5 text-xs text-red-300"><Flame className="h-3.5 w-3.5" />{hungryCount} resource-hungry</span>}
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="h-9 w-40">
              <option value="">All statuses</option>
              <option value="inactive">Inactive only</option>
              <option value="running">Running</option>
              <option value="provisioning">Provisioning</option>
              <option value="requested">Requested</option>
              <option value="queued">Queued</option>
              <option value="stopped">Stopped</option>
              <option value="failed">Failed</option>
              <option value="terminated">Terminated</option>
            </Select>
            <Select value={worker} onChange={(e) => setWorker(e.target.value)} aria-label="Filter by worker" className="h-9 w-36">
              <option value="">All workers</option><option value="worker-1">worker-1</option><option value="worker-2">worker-2</option>
            </Select>
          </>}
        />
      </Card>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} size="sm" title={`Terminate ${confirm?.id}?`}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={busy === `${confirm?.id}:del`} onClick={async () => { await run(`${confirm.id}:del`, () => api.deleteEnvironment(confirm.id), { success: `${confirm.id} terminated`, after: envs.refresh }); setConfirm(null); }}>Terminate</Button></>}>
        <p className="text-sm text-gray-300">This removes <strong className="text-white">{confirm?.userName}</strong>'s container “{confirm?.name}”. Their project files stay in storage.</p>
      </Modal>
    </>
  );
}
