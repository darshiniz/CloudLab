import { useEffect, useState } from 'react';
import { Power, Save, Timer } from 'lucide-react';
import { api } from '../../services/api';
import { LIMITS } from '../../constants/enums';
import useQuery from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { Button, Card, DataTable, Field, Input, Mono, PageHeader, Skeleton, Slider, Toggle } from '../../components/ui';
import LabIcon from '../../components/labs/LabIcon';
import { formatDateTime, labLabel } from '../../utils/format';

export default function Policy() {
  const toast = useToast();
  const policy = useQuery(() => api.getPolicy(), []);
  const log = useQuery(() => api.getAutoStopLog({ pageSize: 50 }), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (policy.data) setForm(policy.data); }, [policy.data]);

  const dirty = form && policy.data && JSON.stringify(form) !== JSON.stringify(policy.data);
  const save = async () => {
    setSaving(true);
    try { const p = await api.updatePolicy(form); policy.setData(p); toast.success('Policy saved'); } catch (err) { toast.apiError(err); } finally { setSaving(false); }
  };
  const warnAt = form ? Math.max(form.inactivityMinutes - 10, 1) : 0;

  return (
    <>
      <PageHeader title="Inactivity Policy" description="Idle labs stop themselves to free slots and save cloud cost." actions={<Button icon={Save} disabled={!dirty} loading={saving} onClick={save}>Save changes</Button>} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Rules" className="lg:col-span-3">
          {!form ? <Skeleton className="h-56" /> : (
            <div className="space-y-8">
              <div className="flex items-center justify-between gap-4">
                <div><p className="font-medium text-white">Auto-stop inactive labs</p><p className="text-sm text-gray-500">Stop a lab when nobody has used it for the timeout below.</p></div>
                <Toggle checked={form.autoStopEnabled} onChange={(v) => setForm({ ...form, autoStopEnabled: v })} label="Auto-stop" />
              </div>
              <div className={form.autoStopEnabled ? '' : 'pointer-events-none opacity-40'}>
                <div className="mb-3 flex items-baseline justify-between"><label htmlFor="timeout" className="font-medium text-white">Inactivity timeout</label><span className="font-mono text-2xl font-bold text-accent">{form.inactivityMinutes} min</span></div>
                <Slider id="timeout" min={LIMITS.inactivityMin} max={LIMITS.inactivityMax} step={5} value={form.inactivityMinutes} onChange={(v) => setForm({ ...form, inactivityMinutes: v })} />
                <div className="mt-1 flex justify-between font-mono text-xs text-gray-600"><span>{LIMITS.inactivityMin} min</span><span>{LIMITS.inactivityMax} min</span></div>
              </div>
              <Field label="Max concurrent labs per worker" htmlFor="maxlabs" hint={`Between ${LIMITS.maxLabsPerWorkerMin} and ${LIMITS.maxLabsPerWorkerMax}. Default 4 for an e2-medium. Total cluster capacity: ${form.maxLabsPerWorker * 2} slots.`}>
                <Input id="maxlabs" type="number" min={1} max={8} className="w-32 font-mono" value={form.maxLabsPerWorker}
                  onChange={(e) => setForm({ ...form, maxLabsPerWorker: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} />
              </Field>
            </div>
          )}
        </Card>
        <Card title="Rule preview" className="lg:col-span-2">
          {form && (
            <ol className="space-y-4 text-sm">
              <li className="flex gap-3"><span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-status-running" /><span className="text-gray-300">A lab is <b className="text-green-300">running</b> while the student's workspace sends a heartbeat every 60 s.</span></li>
              <li className="flex gap-3"><span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-status-inactive" /><span className="text-gray-300">After 10 min with no heartbeat it becomes <b className="text-orange-300">inactive</b> and the student sees “Auto-stops in {form.inactivityMinutes - 10} min due to inactivity”.</span></li>
              <li className="flex gap-3"><span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-status-stopped" /><span className="text-gray-300">{form.autoStopEnabled ? <>At <b className="text-white">{form.inactivityMinutes} min</b> idle it is <b>stopped</b>. Files stay on disk, and the slot goes to the next queued request.</> : <>Auto-stop is <b className="text-white">off</b>. Inactive labs keep their slot until someone stops them.</>}</span></li>
            </ol>
          )}
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-gray-400"><Timer className="h-4 w-4 text-accent" />Warning shown from minute {warnAt} onwards</div>
        </Card>
      </div>

      <Card title="Auto-stopped environments" className="mt-6" padded={false} action={<Power className="h-4 w-4 text-gray-500" />}>
        <DataTable loading={log.loading} rows={(log.data?.data ?? []).map((r) => ({ ...r, id: r.environmentId + r.stoppedAt }))} searchKeys={['userName', 'environmentId']} searchPlaceholder="Search log…" columns={[
          { key: 'environmentId', header: 'Environment', render: (r) => <Mono className="text-gray-300">{r.environmentId}</Mono> },
          { key: 'userName', header: 'Student' },
          { key: 'labType', header: 'Lab', render: (r) => <span className="flex items-center gap-2"><LabIcon type={r.labType} size="sm" />{labLabel(r.labType)}</span> },
          { key: 'idleMinutes', header: 'Idle for', render: (r) => <Mono>{r.idleMinutes} min</Mono> },
          { key: 'stoppedAt', header: 'Stopped at', render: (r) => formatDateTime(r.stoppedAt) },
        ]} />
      </Card>
    </>
  );
}
