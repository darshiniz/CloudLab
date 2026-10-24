import { motion } from 'framer-motion';
import { Cloud, Cpu, Folder, Hourglass, MemoryStick, Server, ServerCog } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Card, EmptyState, Mono, PageHeader, ResourceBar, SkeletonCards, StatusBadge } from '../../components/ui';
import { cx, labLabel, timeAgo } from '../../utils/format';

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

export default function Infrastructure() {
  const { data, loading } = useQuery(() => api.getInfrastructure(), [], { interval: 5000 });
  const cap = data?.clusterCapacity;

  return (
    <>
      <PageHeader title="Infrastructure" description="Control VM, worker VMs, admission queue and Cloud Storage, all in asia-south1 (Mumbai)." />
      <div className="grid gap-5 lg:grid-cols-3">
        {loading ? <SkeletonCards count={3} className="h-72" /> : data.nodes.map((n) => (
          <Card key={n.id} hover>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-accent/10 p-2.5 text-accent ring-1 ring-inset ring-accent/20">{n.kind === 'control' ? <ServerCog className="h-5 w-5" /> : <Server className="h-5 w-5" />}</span>
                <div><h3 className="font-semibold text-white">{n.name}</h3><Mono>{n.id}</Mono></div>
              </div>
              <StatusBadge status={n.status} />
            </div>
            <p className="mt-3 text-xs text-gray-500">{n.machineType} · 2 vCPU / 4 GB · {n.region} Mumbai</p>
            <div className="mt-5 space-y-4">
              <ResourceBar label="CPU" icon={Cpu} value={n.cpuPercent} />
              <ResourceBar label="RAM" icon={MemoryStick} value={n.memoryPercent} />
              {n.kind === 'worker' ? <SlotGauge used={n.slotsUsed} total={n.slotsTotal} /> : <p className="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-xs text-gray-400">Runs Nginx, the Node/Express API and the scheduler. No student code runs here.</p>}
            </div>
          </Card>
        ))}
      </div>

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

        <Card title="Cloud Storage" subtitle={data?.storage.bucket} action={<Cloud className="h-4 w-4 text-gray-500" />}>
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
