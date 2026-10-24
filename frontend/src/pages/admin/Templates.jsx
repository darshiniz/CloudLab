import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { LAB_TYPE } from '../../constants/enums';
import useQuery from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input, Modal, PageHeader, Select, SkeletonCards, Stagger, Textarea, Toggle } from '../../components/ui';
import LabCard from '../../components/labs/LabCard';
import { labLabel } from '../../utils/format';

const BLANK = { name: '', type: 'python', description: '', dockerImage: 'cloudlab/', tools: '', cpu: 2, memoryGb: 2, storageGb: 5, enabled: true, comingSoon: false };

export default function Templates() {
  const toast = useToast();
  const labs = useQuery(() => api.listLabs({ includeDisabled: 'true' }), []);
  const [editing, setEditing] = useState(null); // null | 'new' | lab
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const open = (lab) => {
    setEditing(lab ?? 'new');
    setErrors({});
    setForm(lab ? { ...lab, tools: lab.tools.join(', '), ...lab.limits } : BLANK);
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });

  const save = async (e) => {
    e.preventDefault();
    const body = {
      name: form.name, type: form.type, description: form.description, dockerImage: form.dockerImage,
      tools: form.tools.split(',').map((t) => t.trim()).filter(Boolean),
      limits: { cpu: Number(form.cpu), memoryGb: Number(form.memoryGb), storageGb: Number(form.storageGb) },
      enabled: form.enabled, comingSoon: form.comingSoon,
    };
    setSaving(true);
    try {
      if (editing === 'new') await api.createLab(body); else await api.updateLab(editing.id, body);
      toast.success(editing === 'new' ? 'Template created' : 'Template saved');
      setEditing(null);
      labs.refresh();
    } catch (err) { setErrors(err.details ?? {}); toast.apiError(err); } finally { setSaving(false); }
  };

  const toggleEnabled = async (lab) => {
    try { await api.updateLab(lab.id, { enabled: !lab.enabled }); toast.success(`${lab.name} ${lab.enabled ? 'disabled' : 'enabled'}`); labs.refresh(); } catch (err) { toast.apiError(err); }
  };

  return (
    <>
      <PageHeader title="Lab Templates" description="Templates are never deleted. Switch one off to hide it from students." actions={<Button icon={Plus} onClick={() => open(null)}>New template</Button>} />
      {labs.loading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"><SkeletonCards count={5} className="h-80" /></div> : (
        <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {labs.data.data.map((l) => (
            <LabCard key={l.id} lab={{ ...l, comingSoon: l.comingSoon }} action={
              <div className="flex items-center gap-3 border-t border-line pt-4">
                <Toggle checked={l.enabled} onChange={() => toggleEnabled(l)} label={`${l.name} enabled`} />
                <span className="text-xs text-gray-400">{l.enabled ? 'Enabled' : 'Disabled'}</span>
                <span className="ml-1 font-mono text-[11px] text-gray-600">{l.dockerImage}</span>
                <Button size="sm" variant="secondary" icon={Pencil} className="ml-auto" onClick={() => open(l)}>Edit</Button>
              </div>
            } />
          ))}
        </Stagger>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === 'new' ? 'New lab template' : `Edit ${editing?.name ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="tpl" loading={saving}>Save template</Button></>}>
        <form id="tpl" onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" htmlFor="t-name" error={errors.name}><Input id="t-name" value={form.name} onChange={set('name')} invalid={!!errors.name} /></Field>
          <Field label="Lab type" htmlFor="t-type" error={errors.type}>
            <Select id="t-type" value={form.type} onChange={set('type')} disabled={editing !== 'new'}>{Object.values(LAB_TYPE).map((t) => <option key={t} value={t}>{labLabel(t)}</option>)}</Select>
          </Field>
          <Field label="Docker image" htmlFor="t-img" error={errors.dockerImage} className="sm:col-span-2"><Input id="t-img" className="font-mono" value={form.dockerImage} onChange={set('dockerImage')} invalid={!!errors.dockerImage} /></Field>
          <Field label="Description" htmlFor="t-desc" className="sm:col-span-2"><Textarea id="t-desc" value={form.description} onChange={set('description')} /></Field>
          <Field label="Tools" htmlFor="t-tools" hint="Comma separated, e.g. Python, pip, NumPy" className="sm:col-span-2"><Input id="t-tools" value={form.tools} onChange={set('tools')} /></Field>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Field label="Max vCPU" htmlFor="t-cpu"><Select id="t-cpu" value={form.cpu} onChange={set('cpu')}>{[1, 2].map((v) => <option key={v}>{v}</option>)}</Select></Field>
            <Field label="Max RAM (GB)" htmlFor="t-mem"><Select id="t-mem" value={form.memoryGb} onChange={set('memoryGb')}>{[1, 2].map((v) => <option key={v}>{v}</option>)}</Select></Field>
            <Field label="Storage (GB)" htmlFor="t-sto"><Select id="t-sto" value={form.storageGb} onChange={set('storageGb')}>{[1, 2, 5].map((v) => <option key={v}>{v}</option>)}</Select></Field>
          </div>
          <label className="flex items-center gap-3 text-sm text-gray-300"><Toggle checked={form.enabled} onChange={set('enabled')} label="Enabled" />Enabled</label>
          <label className="flex items-center gap-3 text-sm text-gray-300"><Toggle checked={form.comingSoon} onChange={set('comingSoon')} label="Coming soon" />Show as “Coming soon”</label>
        </form>
      </Modal>
    </>
  );
}
