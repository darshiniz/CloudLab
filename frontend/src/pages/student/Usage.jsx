import { Clock, FlaskConical, TrendingUp } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Card, PageHeader, Skeleton, StatCard } from '../../components/ui';
import { AreaChartX, DonutChart } from '../../components/charts';
import { LAB_META, formatDate, labLabel } from '../../utils/format';

export default function Usage() {
  const { data, loading } = useQuery(() => api.getMyUsage(8), []);
  const weeks = data?.hoursPerWeek ?? [];
  const avg = weeks.length ? weeks.reduce((s, w) => s + w.hours, 0) / weeks.length : 0;
  return (
    <>
      <PageHeader title="Usage" description="How much time you've spent in your labs." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total hours" value={data?.totalHours} decimals={1} suffix=" h" icon={Clock} loading={loading} hint="Last 8 weeks" />
        <StatCard label="Average per week" value={data ? avg : undefined} decimals={1} suffix=" h" icon={TrendingUp} loading={loading} />
        <StatCard label="Labs created" value={data?.labsCreated} icon={FlaskConical} loading={loading} />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Hours per week" className="lg:col-span-3">
          {loading ? <Skeleton className="h-60" /> : <AreaChartX data={weeks} xKey="weekStart" yKey="hours" name="Hours" formatX={(d) => formatDate(d)} formatY={(v) => `${v}h`} height={260} />}
        </Card>
        <Card title="Time per lab type" className="lg:col-span-2">
          {loading ? <Skeleton className="h-60" /> : (
            <DonutChart centerLabel="hours" centerValue={data.totalHours} data={data.byLabType.map((b) => ({ name: labLabel(b.labType), value: b.hours, color: LAB_META[b.labType].color }))} />
          )}
        </Card>
      </div>
    </>
  );
}
