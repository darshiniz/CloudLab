import { useEffect, useState } from 'react';
import { Globe, Save } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { Button, Card, DataTable, Field, Mono, PageHeader, Select, Skeleton } from '../../components/ui';
import { formatDateTime } from '../../utils/format';

const REGIONS = [['asia-south1', 'asia-south1 (Mumbai)'], ['asia-south2', 'asia-south2 (Delhi)'], ['asia-southeast1', 'asia-southeast1 (Singapore)']];

export default function Settings() {
  const toast = useToast();
  const settings = useQuery(() => api.getSettings(), []);
  const audit = useQuery(() => api.getAuditLog({ pageSize: 50 }), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);
  const dirty = form && JSON.stringify(form) !== JSON.stringify(settings.data);
  const setDefault = (k) => (e) => setForm({ ...form, defaults: { ...form.defaults, [k]: Number(e.target.value) } });

  const save = async () => {
    setSaving(true);
    try { settings.setData(await api.updateSettings(form)); toast.success('Settings saved'); audit.refresh(); } catch (err) { toast.apiError(err); } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="System Settings" description="Platform-wide defaults." actions={<Button icon={Save} disabled={!dirty} loading={saving} onClick={save}>Save</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="GCP region" action={<Globe className="h-4 w-4 text-gray-500" />}>
          {!form ? <Skeleton className="h-16" /> : (
            <Field label="Region for new VMs" htmlFor="region" hint="Changing this only affects new worker VMs.">
              <Select id="region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>{REGIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </Field>
          )}
        </Card>
        <Card title="Resource defaults" subtitle="Used when a template doesn't say otherwise">
          {!form ? <Skeleton className="h-16" /> : (
            <div className="grid grid-cols-3 gap-3">
              <Field label="vCPU" htmlFor="d-cpu"><Select id="d-cpu" value={form.defaults.cpu} onChange={setDefault('cpu')}>{[1, 2].map((v) => <option key={v}>{v}</option>)}</Select></Field>
              <Field label="RAM (GB)" htmlFor="d-mem"><Select id="d-mem" value={form.defaults.memoryGb} onChange={setDefault('memoryGb')}>{[1, 2].map((v) => <option key={v}>{v}</option>)}</Select></Field>
              <Field label="Storage (GB)" htmlFor="d-sto"><Select id="d-sto" value={form.defaults.storageGb} onChange={setDefault('storageGb')}>{[1, 2, 5].map((v) => <option key={v}>{v}</option>)}</Select></Field>
            </div>
          )}
        </Card>
      </div>
      <Card title="Audit log" className="mt-6" padded={false}>
        <DataTable loading={audit.loading} rows={audit.data?.data ?? []} searchKeys={['actorName', 'action', 'target']} searchPlaceholder="Search audit log…" columns={[
          { key: 'at', header: 'When', render: (r) => formatDateTime(r.at) },
          { key: 'actorName', header: 'Who' },
          { key: 'action', header: 'Action', render: (r) => <Mono className="text-accent">{r.action}</Mono> },
          { key: 'target', header: 'Target', render: (r) => <span className="text-gray-400">{r.target}</span> },
        ]} />
      </Card>
    </>
  );
}
