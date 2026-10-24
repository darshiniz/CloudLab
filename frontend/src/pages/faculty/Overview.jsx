import { ClipboardList, Clock, TerminalSquare, Users } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Avatar, Card, EmptyState, PageHeader, Skeleton, StatCard } from '../../components/ui';
import { AreaChartX } from '../../components/charts';
import LabIcon from '../../components/labs/LabIcon';
import { formatDate, labLabel, timeAgo } from '../../utils/format';

export default function FacultyOverview() {
  const { data, loading } = useQuery(() => api.getFacultyOverview(), [], { interval: 10000 });
  const s = data?.stats;
  return (
    <>
      <PageHeader title="Class overview" description="What your students are doing in CloudLab." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Students" value={s?.students} icon={Users} loading={loading} />
        <StatCard label="Active labs now" value={s?.activeLabs} icon={TerminalSquare} loading={loading} trend={data?.usageByDay.slice(-7).map((d) => d.hours)} />
        <StatCard label="Assigned activities" value={s?.assignedActivities} icon={ClipboardList} loading={loading} />
        <StatCard label="Avg lab hours / student" value={s?.avgHoursPerStudent} decimals={1} suffix=" h" icon={Clock} loading={loading} />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Lab usage by day" subtitle="Total hours across all students, last 14 days" className="lg:col-span-3">
          {loading ? <Skeleton className="h-64" /> : <AreaChartX data={data.usageByDay} xKey="date" yKey="hours" name="Hours" formatX={(d) => formatDate(d)} formatY={(v) => `${v}h`} height={280} />}
        </Card>
        <Card title="Students active now" className="lg:col-span-2" action={<span className="flex items-center gap-1.5 text-xs text-green-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />Live</span>}>
          {loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : data.activeStudents.length ? (
            <ul className="space-y-1">
              {data.activeStudents.map((a) => (
                <li key={a.userId + a.since} className="flex items-center gap-3 rounded-xl p-2 hover:bg-white/[0.02]">
                  <Avatar name={a.name} size="sm" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm text-white">{a.name}</p><p className="text-xs text-gray-500">since {timeAgo(a.since)}</p></div>
                  <span className="flex items-center gap-2 text-xs text-gray-400"><LabIcon type={a.labType} size="sm" />{labLabel(a.labType)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Users} title="Nobody online" message="No student has a lab running right now." />}
        </Card>
      </div>
    </>
  );
}
