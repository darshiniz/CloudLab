import { useState } from 'react';
import { Database, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Banner, Button, Card, Chip, DataTable, Dropzone, EmptyState, Field, Input, Mono, PageHeader } from '../../components/ui';
import { formatBytes, formatDate } from '../../utils/format';

export default function FacultyDatasets() {
  const { user } = useAuth();
  const { run, busy } = useAction();
  const ds = useQuery(() => api.listDatasets('shared'), []);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', courses: 'MCA-Python' });

  const pick = (f) => { setFile(f); setForm((x) => ({ ...x, name: f.name })); };
  const upload = async (e) => {
    e.preventDefault();
    const r = await run('up', () => api.uploadDataset({ file, name: form.name, description: form.description, scope: 'shared', courses: form.courses.split(',').map((c) => c.trim()).filter(Boolean) }),
      { success: (d) => `${d.name} shared with ${d.courses.join(', ') || 'everyone'}`, after: ds.refresh });
    if (r) { setFile(null); setForm({ name: '', description: '', courses: 'MCA-Python' }); }
  };
  const canDelete = (d) => user.role === 'admin' || d.uploadedBy === user.id;

  return (
    <>
      <PageHeader title="Shared Datasets" description="Upload CSVs once. Every student lab mounts them read-only at /data/shared." />
      <Banner tone="info" className="mb-6">Stored in the Cloud Storage bucket under <Mono className="text-blue-200">datasets/</Mono>. Students can't change or delete shared datasets.</Banner>
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card title="Upload CSV">
          {!file ? <Dropzone onFile={pick} accept=".csv" hint="CSV up to 100 MB" /> : (
            <form onSubmit={upload} className="space-y-4">
              <div className="rounded-xl border border-line bg-white/[0.02] p-3"><p className="truncate text-sm text-white">{file.name}</p><p className="font-mono text-xs text-gray-500">{formatBytes(file.size)}</p></div>
              <Field label="Name" htmlFor="d-name"><Input id="d-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Description" htmlFor="d-desc"><Input id="d-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <Field label="Courses with access" htmlFor="d-courses" hint="Comma separated, e.g. MCA-Python, MCA-DataScience"><Input id="d-courses" value={form.courses} onChange={(e) => setForm({ ...form, courses: e.target.value })} /></Field>
              <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setFile(null)}>Cancel</Button><Button type="submit" className="flex-1" loading={busy === 'up'}>Upload</Button></div>
            </form>
          )}
        </Card>
        <Card padded={false}>
          <DataTable loading={ds.loading} rows={ds.data?.data ?? []} searchKeys={['name', 'description', (d) => d.courses.join(' ')]} searchPlaceholder="Search datasets…"
            empty={<EmptyState icon={Database} title="No shared datasets" message="Upload a CSV to share it with your classes." />}
            columns={[
              { key: 'name', header: 'Dataset', render: (d) => <div><p className="font-medium text-white">{d.name}</p><p className="text-xs text-gray-500">{d.description}</p></div> },
              { key: 'sizeBytes', header: 'Size', render: (d) => <Mono>{formatBytes(d.sizeBytes)}</Mono> },
              { key: 'rows', header: 'Rows', render: (d) => <Mono>{d.rows?.toLocaleString('en-IN') ?? '—'}</Mono> },
              { key: 'courses', header: 'Courses', sortable: false, render: (d) => <div className="flex flex-wrap gap-1">{d.courses.map((c) => <Chip key={c}>{c}</Chip>)}</div>, hideOnMobile: true },
              { key: 'uploadedAt', header: 'Uploaded', render: (d) => formatDate(d.uploadedAt), hideOnMobile: true },
              { key: 'x', header: '', sortable: false, render: (d) => canDelete(d) && <div className="text-right"><Button size="sm" variant="danger" icon={Trash2} loading={busy === d.id} onClick={() => run(d.id, () => api.deleteDataset(d.id), { success: `${d.name} deleted`, after: ds.refresh })}>Delete</Button></div> },
            ]} />
        </Card>
      </div>
    </>
  );
}
