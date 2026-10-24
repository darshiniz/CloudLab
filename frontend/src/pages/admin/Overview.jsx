import { AlertTriangle, Box, Cpu, HardDrive, Info, MemoryStick, ShieldAlert, TerminalSquare } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Card, PageHeader, Skeleton, StatCard } from '../../components/ui';
import { DonutChart, LineChartX } from '../../components/charts';
import { cx, timeAgo } from '../../utils/format';

const SEV = {
  info: [Info, 'border-blue-500/25 bg-blue-500/10 text-blue-200'],
  warning: [AlertTriangle, 'border-orange-500/25 bg-orange-500/10 text-orange-200'],
  critical: [ShieldAlert, 'border-red-500/25 bg-red-500/10 text-red-200'],
};
const time = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export default function AdminOverview() {
  const { data, loading } = useQuery(() => api.getAdminOverview(), [], { interval: 5000 });
  const s = data?.stats;
  const series = data ? data.cpuSeries.map((c, i) => ({ t: c.t, cpu: c.value, memory: data.memorySeries[i]?.value })) : [];
  const spark = (key) => series.slice(-20).map((p) => p[key]);
  const b = data?.stateBreakdown;

  return (
    <>
      <PageHeader title="Monitoring overview" description="Live health of every lab, container and VM. Refreshes every 5 seconds." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active labs" value={s?.activeLabs} loading={loading} icon={TerminalSquare} trend={[3, 4, 5, 6, 5, 7, s?.activeLabs ?? 0]} />
        <StatCard label="Running containers" value={s?.runningContainers} loading={loading} icon={Box} trend={[2, 4, 4, 5, 6, 6, s?.runningContainers ?? 0]} />
        <StatCard label="CPU" value={s?.cpuPercent} suffix="%" loading={loading} icon={Cpu} trend={spark('cpu')} />
        <StatCard label="Memory" value={s?.memoryPercent} suffix="%" loading={loading} icon={MemoryStick} trend={spark('memory')} color="#F97316" />
        <StatCard label="Storage" value={s?.storagePercent} suffix="%" loading={loading} icon={HardDrive} trend={[48, 50, 51, 53, 55, 57, s?.storagePercent ?? 0]} color="#14B8A6" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="CPU and memory, last hour" subtitle="Average across worker VMs" className="xl:col-span-2">
          {loading ? <Skeleton className="h-64" /> : (
            <LineChartX data={series} xKey="t" formatX={time} formatY={(v) => `${v}%`} domain={[0, 100]} height={280}
              lines={[{ key: 'cpu', name: 'CPU', color: '#8B5CF6' }, { key: 'memory', name: 'Memory', color: '#F97316' }]} />
          )}
        </Card>
        <Card title="Lab states">
          {loading ? <Skeleton className="h-56" /> : (
            <DonutChart centerLabel="labs" data={[
              { name: 'Running', value: b.running, color: '#22C55E' },
              { name: 'Inactive', value: b.inactive, color: '#F97316' },
              { name: 'Stopped', value: b.stopped, color: '#64748B' },
              { name: 'Failed', value: b.failed, color: '#EF4444' },
            ]} />
          )}
        </Card>
      </div>

      <Card title="Alerts" className="mt-6" action={<span className="text-xs text-gray-500">{data?.alerts.length ?? 0} open</span>}>
        {loading ? <Skeleton className="h-24" /> : (
          <ul className="space-y-2">
            {data.alerts.map((a) => {
              const [Icon, style] = SEV[a.severity];
              return (
                <li key={a.id} className={cx('flex items-center gap-3 rounded-xl border px-4 py-3 text-sm', style)}>
                  <Icon className="h-4 w-4 shrink-0" /><span className="flex-1">{a.message}</span>
                  <span className="text-xs uppercase tracking-wider opacity-70">{a.severity}</span>
                  <span className="hidden text-xs opacity-60 sm:block">{timeAgo(a.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
