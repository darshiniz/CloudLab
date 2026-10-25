import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, FlaskConical, HardDrive, Play, Plus, Rocket, TerminalSquare, History } from 'lucide-react';
import { api } from '../../services/api';
import { ENV_STATUS } from '../../constants/enums';
import { useAuth } from '../../context/AuthContext';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Button, Card, EmptyState, PageHeader, Skeleton, StatCard, StatusBadge, ResourceBar } from '../../components/ui';
import CreateLabModal from '../../components/labs/CreateLabModal';
import InactivityWarning from '../../components/labs/InactivityWarning';
import LabIcon from '../../components/labs/LabIcon';
import { formatBytes, formatDateTime, labLabel, timeAgo } from '../../utils/format';

const LIVE = [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.PROVISIONING];

export default function StudentOverview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [createOpen, setCreateOpen] = useState(false);
  const envs = useQuery(() => api.listEnvironments({ pageSize: 100 }), [], { interval: 5000 });
  const usage = useQuery(() => api.getMyUsage(8), []);
  const storage = useQuery(() => api.getStorageUsage(), []);
  const labs = useQuery(() => api.listLabs(), []);
  const assignments = useQuery(() => api.listAssignments(), [], { interval: 15000 });
  const openTasks = (assignments.data?.data ?? []).filter((a) => a.status !== 'completed').slice(0, 3);

  const list = (envs.data?.data ?? []).filter((e) => e.status !== ENV_STATUS.TERMINATED);
  const active = list.filter((e) => LIVE.includes(e.status));
  const last = useMemo(() => [...list].filter((e) => e.status !== ENV_STATUS.QUEUED).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0], [list]);
  const inactive = list.filter((e) => e.status === ENV_STATUS.INACTIVE);
  const queued = list.filter((e) => e.status === ENV_STATUS.QUEUED);

  const timeline = useMemo(() => {
    const ev = [];
    for (const e of list) {
      ev.push({ at: e.createdAt, text: `Created ${e.name}`, type: e.labType, status: null });
      if (e.stoppedAt) ev.push({ at: e.stoppedAt, text: `Stopped ${e.name}`, type: e.labType, status: 'stopped' });
      if (e.status === ENV_STATUS.FAILED) ev.push({ at: e.lastActivityAt, text: `${e.name} failed to provision`, type: e.labType, status: 'failed' });
      if (e.status === ENV_STATUS.RUNNING) ev.push({ at: e.lastActivityAt, text: `Working in ${e.name}`, type: e.labType, status: 'running' });
    }
    return ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  }, [list]);

  const resume = (e) => {
    if (e.status === ENV_STATUS.STOPPED) {
      run(`${e.id}:start`, () => api.startEnvironment(e.id), { success: 'Starting your lab…', after: envs.refresh });
    } else navigate(`/student/workspace/${e.id}`);
  };

  const firstName = user.name.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const st = storage.data;

  return (
    <>
      <PageHeader title={`${greeting}, ${firstName} 👋`} description="Here's what's happening in your labs." actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Create Lab</Button>} />

      <div className="mb-6 space-y-3">
        {inactive.map((e) => (
          <InactivityWarning key={e.id} env={e} onStillHere={() => run(`${e.id}:hb`, () => api.heartbeat(e.id, true), { success: 'Timer reset. Lab stays on.', after: envs.refresh })} />
        ))}
        {queued.map((e) => (
          <div key={e.id} className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
            <strong>{e.name}</strong>: All servers are at capacity. You are #{e.queuePosition} in the queue.
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active labs" value={envs.loading ? undefined : active.length} loading={envs.loading} icon={TerminalSquare} trend={[1, 2, 1, 3, 2, 2, active.length]} />
        <StatCard label="Labs created" value={usage.data?.labsCreated} loading={usage.loading} icon={FlaskConical} trend={[2, 4, 5, 7, 9, 12, usage.data?.labsCreated ?? 0]} />
        <StatCard label="Hours used" value={usage.data?.totalHours} decimals={1} suffix=" h" loading={usage.loading} icon={Clock} trend={usage.data?.hoursPerWeek.map((w) => w.hours)} hint="Last 8 weeks" />
        <StatCard label="Storage used" value={st ? st.usedBytes / 1024 ** 3 : undefined} decimals={1} suffix={st ? ` / ${st.limitBytes / 1024 ** 3} GB` : ''} loading={storage.loading} icon={HardDrive} hint={st ? `${Math.round((st.usedBytes / st.limitBytes) * 100)}% of your quota` : undefined} />
      </div>

      {openTasks.length > 0 && (
        <Card title="Assigned to you" className="mb-6" action={<Link to="/student/assignments" className="text-sm text-accent hover:underline">View all</Link>}>
          <ul className="divide-y divide-line">
            {openTasks.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{a.title}</p>
                  <p className={`text-xs ${a.overdue ? 'text-red-300' : 'text-gray-500'}`}>Due {formatDateTime(a.dueDate)}{a.overdue ? ' · overdue' : ''}</p>
                </div>
                <StatusBadge status={a.status} label={a.status === 'inProgress' ? 'In progress' : 'Not started'} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Continue where you left off" className="lg:col-span-3">
          {envs.loading ? <Skeleton className="h-36" /> : last ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <LabIcon type={last.labType} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{last.name}</h3><StatusBadge status={last.status} /></div>
                <p className="mt-1 text-sm text-gray-500">{labLabel(last.labType)} · last active {timeAgo(last.lastActivityAt)}</p>
                {[ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(last.status) && (
                  <div className="mt-4 grid max-w-sm grid-cols-2 gap-4"><ResourceBar label="CPU" value={last.usage.cpuPercent} /><ResourceBar label="RAM" value={last.usage.memoryPercent} /></div>
                )}
              </div>
              {[ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE, ENV_STATUS.STOPPED].includes(last.status) && (
                <Button icon={Play} loading={busy === `${last.id}:start`} onClick={() => resume(last)}>Resume</Button>
              )}
              {last.status === ENV_STATUS.FAILED && <Button variant="secondary" onClick={() => navigate('/student/labs')}>View in My Labs</Button>}
            </motion.div>
          ) : (
            <EmptyState icon={Rocket} title="No labs yet" message="Create your first lab to start coding in the cloud." action={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Create Lab</Button>} />
          )}
        </Card>

        <Card title="Recent activity" className="lg:col-span-2" action={<History className="h-4 w-4 text-gray-500" />}>
          {envs.loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {timeline.map((t, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
                  <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-bg ${t.status === 'failed' ? 'bg-status-failed' : t.status === 'running' ? 'bg-status-running' : t.status === 'stopped' ? 'bg-status-stopped' : 'bg-accent'}`} />
                  <p className="text-sm text-gray-200">{t.text}</p>
                  <p className="text-xs text-gray-500">{timeAgo(t.at)}</p>
                </motion.li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <CreateLabModal open={createOpen} onClose={() => setCreateOpen(false)} labs={labs.data?.data} onCreated={envs.refresh} />
    </>
  );
}