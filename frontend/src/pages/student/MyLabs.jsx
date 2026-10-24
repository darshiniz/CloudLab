import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Plus, TerminalSquare } from 'lucide-react';
import { api } from '../../services/api';
import { ENV_STATUS } from '../../constants/enums';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Button, Card, DataTable, EmptyState, Modal, PageHeader, ResourceBar, SkeletonCards, Stagger, StatusBadge, Tabs } from '../../components/ui';
import EnvironmentCard from '../../components/labs/EnvironmentCard';
import CreateLabModal from '../../components/labs/CreateLabModal';
import InactivityWarning from '../../components/labs/InactivityWarning';
import LabIcon from '../../components/labs/LabIcon';
import { labLabel, timeAgo } from '../../utils/format';

const TRANSITIONAL = [ENV_STATUS.PROVISIONING, ENV_STATUS.QUEUED, ENV_STATUS.REQUESTED];
const FILTERS = {
  all: () => true,
  running: (e) => [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.PROVISIONING].includes(e.status),
  stopped: (e) => e.status === ENV_STATUS.STOPPED,
  attention: (e) => [ENV_STATUS.FAILED, ENV_STATUS.QUEUED].includes(e.status),
};
const ACTIONS = {
  start: [api.startEnvironment, 'Starting lab…'],
  stop: [api.stopEnvironment, 'Lab stopped. Your files are saved.'],
  restart: [api.restartEnvironment, 'Restarting lab…'],
  delete: [api.deleteEnvironment, 'Lab deleted'],
};

export default function MyLabs() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('cards');
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const { run, busy } = useAction();
  const labs = useQuery(() => api.listLabs(), []);
  // Poll every 2 s while something is changing, otherwise every 5 s
  const [fast, setFast] = useState(false);
  const envs = useQuery(async () => {
    const r = await api.listEnvironments({ pageSize: 100 });
    setFast(r.data.some((e) => TRANSITIONAL.includes(e.status)));
    return r;
  }, [], { interval: fast ? 2000 : 5000 });

  const everything = envs.data?.data ?? [];
  const all = everything.filter((e) => e.status !== ENV_STATUS.TERMINATED);
  const deleted = everything.filter((e) => e.status === ENV_STATUS.TERMINATED);
  const list = filter === 'deleted' ? deleted : all.filter(FILTERS[filter]);
  const inactive = all.filter((e) => e.status === ENV_STATUS.INACTIVE);

  const doAction = (env, action) => {
    if (action === 'delete') return setConfirm(env);
    const [fn, msg] = ACTIONS[action];
    return run(`${env.id}:${action}`, () => fn(env.id), { success: msg, after: envs.refresh });
  };
  const heartbeat = (env) => run(`${env.id}:hb`, () => api.heartbeat(env.id, true), { success: 'Timer reset. Lab stays on.', after: envs.refresh });

  const columns = [
    { key: 'name', header: 'Lab', render: (e) => <div className="flex items-center gap-3"><LabIcon type={e.labType} size="sm" /><div><p className="font-medium text-white">{e.name}</p><p className="text-xs text-gray-500">{labLabel(e.labType)} · {e.size}</p></div></div> },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
    { key: 'createdAt', header: 'Created', render: (e) => timeAgo(e.createdAt), hideOnMobile: true },
    { key: 'lastActivityAt', header: 'Last activity', render: (e) => timeAgo(e.lastActivityAt), hideOnMobile: true },
    { key: 'cpu', header: 'CPU', sortValue: (e) => e.usage.cpuPercent, render: (e) => <ResourceBar value={e.usage.cpuPercent} className="w-24" size="sm" />, hideOnMobile: true },
    { key: 'ram', header: 'RAM', sortValue: (e) => e.usage.memoryPercent, render: (e) => <ResourceBar value={e.usage.memoryPercent} className="w-24" size="sm" />, hideOnMobile: true },
    { key: 'actions', header: '', sortable: false, render: (e) => (
      <div className="flex justify-end gap-1.5">
        {[ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(e.status) && <><Button size="sm" onClick={() => navigate(`/student/workspace/${e.id}`)}>Open</Button><Button size="sm" variant="secondary" loading={busy === `${e.id}:stop`} onClick={() => doAction(e, 'stop')}>Stop</Button></>}
        {e.status === ENV_STATUS.STOPPED && <Button size="sm" variant="success" loading={busy === `${e.id}:start`} onClick={() => doAction(e, 'start')}>Start</Button>}
        {[ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.STOPPED, ENV_STATUS.FAILED].includes(e.status) && <Button size="sm" variant="secondary" loading={busy === `${e.id}:restart`} onClick={() => doAction(e, 'restart')}>{e.status === ENV_STATUS.FAILED ? 'Retry' : 'Restart'}</Button>}
        {![ENV_STATUS.PROVISIONING, ENV_STATUS.TERMINATED].includes(e.status) && <Button size="sm" variant="danger" onClick={() => doAction(e, 'delete')}>Delete</Button>}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title="My Labs" description="Start, stop and open your lab environments." actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Create Lab</Button>} />

      {inactive.length > 0 && <div className="mb-6 space-y-3">{inactive.map((e) => <InactivityWarning key={e.id} env={e} onStillHere={() => heartbeat(e)} />)}</div>}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs className="max-w-full overflow-x-auto" value={filter} onChange={setFilter} tabs={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'running', label: 'Running', count: all.filter(FILTERS.running).length },
          { value: 'stopped', label: 'Stopped', count: all.filter(FILTERS.stopped).length },
          { value: 'attention', label: 'Needs attention', count: all.filter(FILTERS.attention).length },
          { value: 'deleted', label: 'Deleted', count: deleted.length },
        ]} />
        <div className="inline-flex rounded-xl border border-line p-1">
          {[['cards', LayoutGrid], ['table', List]].map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)} aria-label={`${v} view`} aria-pressed={view === v} className={`rounded-lg p-1.5 ${view === v ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}><Icon className="h-4 w-4" /></button>
          ))}
        </div>
      </div>

      {envs.loading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"><SkeletonCards count={3} className="h-64" /></div>
      ) : list.length === 0 ? (
        <Card><EmptyState icon={TerminalSquare} title="No labs here" message={filter === 'all' ? 'Create a lab to get a ready-to-code environment.' : 'Nothing matches this filter.'} action={filter === 'all' && <Button icon={Plus} onClick={() => setCreateOpen(true)}>Create Lab</Button>} /></Card>
      ) : view === 'cards' ? (
        <Stagger className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => <EnvironmentCard key={e.id} env={e} busy={busy} onAction={doAction} onStillHere={heartbeat} />)}
        </Stagger>
      ) : (
        <Card padded={false}><DataTable columns={columns} rows={list} searchKeys={['name', 'labType', 'status']} searchPlaceholder="Search labs…" /></Card>
      )}

      <CreateLabModal open={createOpen} onClose={() => setCreateOpen(false)} labs={labs.data?.data} onCreated={envs.refresh} />

      <Modal open={!!confirm} onClose={() => setConfirm(null)} size="sm" title="Delete this lab?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={busy === `${confirm?.id}:delete`} onClick={async () => { await run(`${confirm.id}:delete`, () => api.deleteEnvironment(confirm.id), { success: 'Lab deleted', after: envs.refresh }); setConfirm(null); }}>Delete lab</Button></>}>
        <p className="text-sm text-gray-300"><strong className="text-white">{confirm?.name}</strong> will be terminated and its container removed. Files in your Projects stay safe in storage.</p>
      </Modal>
    </>
  );
}
