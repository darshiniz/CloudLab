import { useState } from 'react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Card, DataTable, Input, Mono, PageHeader, ResourceBar, Select, Skeleton, StatusBadge } from '../../components/ui';
import { BarChartX } from '../../components/charts';
import LabIcon from '../../components/labs/LabIcon';
import { LAB_META, formatDuration, labLabel } from '../../utils/format';

export default function UsageMonitor() {
  const [labType, setLabType] = useState('');
  const [from, setFrom] = useState('');
  const sessions = useQuery(() => api.listSessions({ labType: labType || undefined, from: from ? new Date(from).toISOString() : undefined, pageSize: 100 }), [labType, from], { interval: 10000 });
  const summary = useQuery(() => api.getUsageSummary(), []);

  const columns = [
    { key: 'studentName', header: 'Student' },
    { key: 'labType', header: 'Lab', render: (r) => <span className="flex items-center gap-2"><LabIcon type={r.labType} size="sm" />{labLabel(r.labType)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'durationMinutes', header: 'Duration', render: (r) => <Mono>{formatDuration(r.durationMinutes)}</Mono> },
    { key: 'cpuPercent', header: 'CPU', render: (r) => <ResourceBar value={r.cpuPercent} className="w-24" size="sm" />, hideOnMobile: true },
    { key: 'memoryPercent', header: 'RAM', render: (r) => <ResourceBar value={r.memoryPercent} className="w-24" size="sm" />, hideOnMobile: true },
    { key: 'environmentId', header: 'Environment', render: (r) => <Mono>{r.environmentId}</Mono>, hideOnMobile: true },
  ];

  return (
    <>
      <PageHeader title="Usage Monitor" description="Every student lab session, live." />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Most-used labs">
          {summary.loading ? <Skeleton className="h-48" /> : <BarChartX data={summary.data.mostUsedLabs.map((m) => ({ ...m, name: labLabel(m.labType) }))} xKey="name" yKey="count" layout="vertical" name="Sessions" height={180} colors={summary.data.mostUsedLabs.map((m) => LAB_META[m.labType].color)} />}
        </Card>
        <Card title="Activity per student" subtitle="Lab hours this term">
          {summary.loading ? <Skeleton className="h-48" /> : <BarChartX data={summary.data.hoursPerStudent.slice(0, 8).map((h) => ({ ...h, short: h.name.split(' ')[0] }))} xKey="short" yKey="hours" name="Hours" height={180} formatY={(v) => `${v}h`} />}
        </Card>
      </div>
      <Card padded={false} title="Lab sessions">
        <DataTable columns={columns} rows={sessions.data?.data ?? []} loading={sessions.loading} searchKeys={['studentName', 'environmentId']} searchPlaceholder="Search student…" pageSize={10}
          toolbar={<>
            <Select value={labType} onChange={(e) => setLabType(e.target.value)} aria-label="Filter by lab type" className="h-9 w-36"><option value="">All labs</option>{['python', 'java', 'web'].map((t) => <option key={t} value={t}>{labLabel(t)}</option>)}</Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Sessions from date" className="h-9 w-40" />
          </>} />
      </Card>
    </>
  );
}
