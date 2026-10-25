import { motion } from 'framer-motion';
import { ArrowDownToLine, ArrowUpFromLine, Cloud, Cpu, Folder, Hourglass, MemoryStick, Server, ServerCog, Zap } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { Button, Card, EmptyState, Mono, PageHeader, ResourceBar, SkeletonCards, StatusBadge, Toggle } from '../../components/ui';
import { cx, labLabel, timeAgo } from '../../utils/format';

// How a worker's power state is shown (the autoscaler can start and stop worker VMs).
const POWER_BADGE = {
  off: { status: 'stopped', label: 'Stopped (scaled in)' },
  starting: { status: 'provisioning', label: 'Starting' },
  stopping: { status: 'inactive', label: 'Stopping' },
};

function SlotGauge({ used, total }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-xs"><span className="text-gray-400">Lab slots</span><span className="font-mono text-gray-300">{used} of {total} lab slots used</span></div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <motion.span key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.06 }}
            className={cx('h-6 flex-1 origin-bottom rounded-md', i < used ? (used >= total ? 'bg-status-failed/70' : 'bg-accent/70') : 'bg-white/[0.06]')} />
        ))}
      </div>
    </div>
  );
}

function Elasticity({ scaling, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try { onChange(await fn()); toast.success(okMsg); } catch (err) { toast.apiError(err); } finally { setBusy(null); }
  };
  if (!scaling) return null;
  const { rules } = scaling;
  return (
    <Card title="Elasticity" subtitle="Scale out and in: start a stopped worker VM when labs are queued, stop an idle one to save cloud cost."
      action={<span className="flex items-center gap-2 text-xs text-gray-400"><Zap className="h-4 w-4 text-accent" />{scaling.provider ? `Provider: ${scaling.provider}` : 'No cloud provider configured'}</span>}>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
        <div>
          <p className="font-medium text-white">Automatic scaling</p>
          <p className="text-sm text-gray-500">
            Scale out after labs have waited {rules.scaleOutAfterSeconds} s in the queue. Scale in after a worker has had no labs for {rules.scaleInAfterMinutes} min. At least {rules.minWorkers} worker stays on.
          </p>
        </div>
        <Toggle checked={scaling.autoEnabled} disabled={!scaling.available || busy === 'auto'} label="Automatic scaling"
          onChange={(v) => run('auto', () => api.setAutoScaling(v), v ? 'Automatic scaling is on' : 'Automatic scaling is off')} />
      </div>

      <ul className="mt-4 space-y-2">
        {scaling.workers.map((w) => {
          const badge = POWER_BADGE[w.power];
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
              <Server className="h-4 w-4 text-accent" />
              <div className="min-w-[9rem] flex-1">
                <p className="text-sm font-medium text-white">{w.name}</p>
                <p className="text-xs text-gray-500"><Mono>{w.vmName}</Mono> · {w.slotsUsed} lab{w.slotsUsed === 1 ? '' : 's'}{w.since ? ` · ${w.power} since ${timeAgo(w.since)}` : ''}</p>
              </div>
              <StatusBadge status={badge ? badge.status : w.status} label={badge?.label} />
              {w.power === 'on' && (
                <Button size="sm" variant="secondary" icon={ArrowDownToLine} loading={busy === `in-${w.id}`} disabled={!scaling.available || w.slotsUsed > 0}
                  title={w.slotsUsed > 0 ? 'Stop its labs first' : 'Stop (deallocate) this VM'}
                  onClick={() => run(`in-${w.id}`, () => api.scaleInWorker(w.id), `${w.name} is being stopped`)}>Scale in</Button>
              )}
              {w.power === 'off' && (
                <Button size="sm" variant="success" icon={ArrowUpFromLine} loading={busy === `out-${w.id}`} disabled={!scaling.available}
                  onClick={() => run(`out-${w.id}`, () => api.scaleOutWorker(w.id), `${w.name} is starting. This takes 1 to 2 minutes`)}>Scale out</Button>
              )}
            </li>
          );
        })}
      </ul>

      <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-gray-500">Scaling log</h4>
      {scaling.events.length === 0 ? <p className="text-sm text-gray-500">No scaling events yet.</p> : (
        <ul className="space-y-1.5">
          {scaling.events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-start gap-3 text-sm">
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.ok ? (e.action === 'scale_out' ? 'bg-status-running' : 'bg-accent') : 'bg-status-failed')} />
              <span className="flex-1 text-gray-300"><b className="text-white">{e.action === 'scale_out' ? 'Scale out' : 'Scale in'}</b> {e.workerId} <span className="text-gray-500">· {e.source === 'auto' ? 'automatic' : 'manual'} · {e.reason}</span></span>
              <span className="shrink-0 text-xs text-gray-500">{timeAgo(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Infrastructure() {
  const { data, loading, refresh } = useQuery(() => api.getInfrastructure(), [], { interval: 5000 });
  const scaling = useQuery(() => api.getScaling(), [], { interval: 5000 });
  const cap = data?.clusterCapacity;

  return (
    <>
      <PageHeader title="Infrastructure" description="Control VM, worker VMs, admission queue, elasticity and cloud storage." />
      <div className="grid gap-5 lg:grid-cols-3">
        {loading ? <SkeletonCards count={3} className="h-72" /> : data.nodes.map((n) => (
          <Card key={n.id} hover>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-accent/10 p-2.5 text-accent ring-1 ring-inset ring-accent/20">{n.kind === 'control' ? <ServerCog className="h-5 w-5" /> : <Server className="h-5 w-5" />}</span>
                <div><h3 className="font-semibold text-white">{n.name}</h3><Mono>{n.id}</Mono></div>
              </div>
              <StatusBadge status={POWER_BADGE[n.power] ? POWER_BADGE[n.power].status : n.status} label={POWER_BADGE[n.power]?.label} />
            </div>
            <p className="mt-3 text-xs text-gray-500">{n.machineType} · {n.region}</p>
            <div className="mt-5 space-y-4">
              <ResourceBar label="CPU" icon={Cpu} value={n.cpuPercent} />
              <ResourceBar label="RAM" icon={MemoryStick} value={n.memoryPercent} />
              {n.kind === 'worker' ? <SlotGauge used={n.slotsUsed} total={n.slotsTotal} /> : <p className="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-xs text-gray-400">Runs Nginx, the Node/Express API and the scheduler. No student code runs here.</p>}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6"><Elasticity scaling={scaling.data} onChange={(v) => { scaling.setData(v); refresh(); }} /></div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Admission control" subtitle="BR-09: requests above capacity wait in a queue" action={data && <StatusBadge status={data.queue.length ? 'queued' : 'online'} label={`Queue: ${data.queue.length} waiting`} />}>
          {cap && (
            <div className="mb-5">
              <ResourceBar label="Total cluster capacity" value={cap.slotsUsed} max={cap.slotsTotal} display={`${cap.slotsUsed} / ${cap.slotsTotal} slots`} />
            </div>
          )}
          {data && (data.queue.length ? (
            <>
              <p className="mb-3 flex items-center gap-2 text-sm text-yellow-200"><Hourglass className="h-4 w-4" />Queue: {data.queue.length} request{data.queue.length > 1 ? 's' : ''} waiting</p>
              <ol className="space-y-2">
                {data.queue.items.map((q, i) => (
                  <li key={q.environmentId} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/15 font-mono text-xs text-yellow-300">{i + 1}</span>
                    <span className="flex-1 text-gray-200">{q.userName} <span className="text-gray-500">· {labLabel(q.labType)}</span></span>
                    <Mono>{q.environmentId}</Mono>
                    <span className="text-xs text-gray-500">{timeAgo(q.waitingSince)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : <EmptyState icon={Hourglass} title="Queue is empty" message="Every request got a slot straight away." />)}
        </Card>

        <Card title="Storage" subtitle={data?.storage.bucket} action={<Cloud className="h-4 w-4 text-gray-500" />}>
          {data && (
            <>
              <ResourceBar label="Bucket usage" value={data.storage.usedGb} max={data.storage.totalGb} display={`${data.storage.usedGb} / ${data.storage.totalGb} GB`} />
              <ul className="mt-5 space-y-3">
                {data.storage.folders.map((f) => (
                  <li key={f.name} className="rounded-xl border border-line bg-white/[0.02] p-4">
                    <div className="flex items-center gap-3">
                      <Folder className="h-5 w-5 text-accent" />
                      <div className="flex-1"><p className="font-mono text-sm text-white">{f.name}</p><p className="text-xs text-gray-500">{f.name === 'datasets/' ? 'Shared, read-only in labs (/data/shared)' : 'One private folder per student (/data/mine)'}</p></div>
                      <span className="font-mono text-sm text-gray-300">{f.usedGb} GB</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
