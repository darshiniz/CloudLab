import { useState } from 'react';
import { Clock, Download, Square, Trash2 } from 'lucide-react';
import { api, saveDownload } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Avatar, Button, Card, PageHeader, Select, Skeleton, StatCard } from '../../components/ui';
import { BarChartX } from '../../components/charts';
import { formatDate } from '../../utils/format';

const RANGES = { 7: 'Last 7 days', 14: 'Last 14 days', 30: 'Last 30 days' };

export default function Analytics() {
  const [days, setDays] = useState('14');
  const { run, busy } = useAction();
  const range = () => ({ from: new Date(Date.now() - Number(days) * 864e5).toISOString(), to: new Date().toISOString() });
  const { data, loading } = useQuery(() => api.getAnalytics(range()), [days]);
  const exportCsv = () => run('csv', async () => saveDownload(await api.exportAnalytics(range())), { success: 'CSV downloaded' });
  const perDay = (data?.labsCreatedPerDay ?? []).slice(-Number(days)).map((d) => ({ ...d, label: formatDate(d.date) }));

  return (
    <>
      <PageHeader title="Usage Analytics" description="How the platform is being used."
        actions={<>
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Date range" className="w-40">{Object.entries(RANGES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          <Button icon={Download} loading={busy === 'csv'} onClick={exportCsv}>Export CSV</Button>
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Avg session duration" value={data?.avgSessionMinutes} suffix=" min" icon={Clock} loading={loading} />
        <StatCard label="Stopped" value={data?.counts.stopped} icon={Square} loading={loading} color="#64748B" />
        <StatCard label="Terminated" value={data?.counts.terminated} icon={Trash2} loading={loading} color="#EF4444" />
      </div>
      <Card title="Labs created per day" className="mb-6">
        {loading ? <Skeleton className="h-60" /> : <BarChartX data={perDay} xKey="label" yKey="count" name="Labs" height={260} />}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Most-used templates">
          {loading ? <Skeleton className="h-48" /> : <BarChartX data={data.mostUsedTemplates} xKey="name" yKey="count" layout="vertical" name="Labs" height={200} colors={['#3B82F6', '#F97316', '#14B8A6']} />}
        </Card>
        <Card title="Top students by usage hours">
          {loading ? <Skeleton className="h-48" /> : (
            <ol className="space-y-3">
              {data.topStudents.map((s, i) => (
                <li key={s.userId} className="flex items-center gap-3">
                  <span className="w-5 font-mono text-xs text-gray-500">{i + 1}</span>
                  <Avatar name={s.name} size="sm" />
                  <span className="flex-1 text-sm text-gray-200">{s.name}</span>
                  <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-white/5 sm:block"><div className="h-full rounded-full bg-accent" style={{ width: `${(s.hours / data.topStudents[0].hours) * 100}%` }} /></div>
                  <span className="w-12 text-right font-mono text-sm text-white">{s.hours} h</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
