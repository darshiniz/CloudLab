import { useState } from 'react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Avatar, Card, DataTable, Drawer, Mono, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import { BarChartX } from '../../components/charts';
import LabIcon from '../../components/labs/LabIcon';
import { formatDate, labLabel, timeAgo } from '../../utils/format';

function StudentDrawer({ id, onClose }) {
  const { data, loading } = useQuery(() => (id ? api.getStudent(id) : Promise.resolve(null)), [id], { enabled: !!id });
  const st = data?.student;
  return (
    <Drawer open={!!id} onClose={onClose} title={st?.name ?? 'Student'} subtitle={st ? `${st.rollNo} · ${st.email}` : undefined}>
      {loading || !data ? <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-48" /><Skeleton className="h-32" /></div> : (
        <div className="space-y-6">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-white/[0.02] p-4">
            <Avatar name={st.name} size="lg" />
            <div className="flex-1"><p className="font-medium text-white">{st.name}</p><p className="text-xs text-gray-500">Last active {timeAgo(st.lastActiveAt)}</p></div>
            <StatusBadge status={st.status} />
          </div>
          <section>
            <h4 className="mb-3 text-sm font-semibold">Labs</h4>
            {data.environments.length ? (
              <ul className="space-y-2">
                {data.environments.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                    <LabIcon type={e.labType} size="sm" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm text-white">{e.name}</p><p className="text-xs text-gray-500">{labLabel(e.labType)} · {timeAgo(e.lastActivityAt)}</p></div>
                    <StatusBadge status={e.status} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-gray-500">No labs created yet.</p>}
          </section>
          <section>
            <h4 className="mb-3 text-sm font-semibold">Usage, last 7 days</h4>
            <BarChartX data={data.usageByDay.map((d) => ({ ...d, label: formatDate(d.date, { weekday: 'short' }) }))} xKey="label" yKey="hours" name="Hours" height={180} formatY={(v) => `${v}h`} />
          </section>
          <section>
            <h4 className="mb-3 text-sm font-semibold">Recent activity</h4>
            <ol className="space-y-3 border-l border-line pl-4">
              {data.recentActivity.map((a, i) => (
                <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" /><p className="text-sm text-gray-200">{a.message}</p><p className="text-xs text-gray-500">{timeAgo(a.at)}</p></li>
              ))}
            </ol>
          </section>
          <p className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-gray-500">Read-only. Faculty can view student labs but not start or stop them.</p>
        </div>
      )}
    </Drawer>
  );
}

export default function Students() {
  const { data, loading } = useQuery(() => api.listStudents({ pageSize: 100 }), []);
  const [open, setOpen] = useState(null);
  const columns = [
    { key: 'name', header: 'Name', render: (s) => <div className="flex items-center gap-3"><Avatar name={s.name} size="sm" /><div><p className="font-medium text-white">{s.name}</p><p className="text-xs text-gray-500">{s.email}</p></div></div> },
    { key: 'rollNo', header: 'Roll no', render: (s) => <Mono>{s.rollNo}</Mono> },
    { key: 'labsCreated', header: 'Labs created', render: (s) => <span className="font-mono">{s.labsCreated}</span> },
    { key: 'lastActiveAt', header: 'Last active', render: (s) => timeAgo(s.lastActiveAt), hideOnMobile: true },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
  ];
  return (
    <>
      <PageHeader title="Students" description="Click a student to see their labs, usage and recent activity." />
      <Card padded={false}>
        <DataTable columns={columns} rows={data?.data ?? []} loading={loading} searchKeys={['name', 'rollNo', 'email']} searchPlaceholder="Search by name or roll no…" onRowClick={(s) => setOpen(s.id)} pageSize={12} />
      </Card>
      <StudentDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}
