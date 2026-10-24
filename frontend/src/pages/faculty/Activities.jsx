import { useMemo, useState } from 'react';
import { CalendarClock, ClipboardList, Database, Send } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import useQuery from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { Banner, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from '../../components/ui';
import LabIcon from '../../components/labs/LabIcon';
import { cx, formatDateTime, timeAgo } from '../../utils/format';

const tomorrow = () => { const d = new Date(Date.now() + 7 * 864e5); d.setHours(18, 0, 0, 0); return d.toISOString().slice(0, 16); };
const EMPTY = { title: '', description: '', labId: 'lab_python', dueDate: tomorrow(), datasetId: '', assignType: 'class', studentIds: [] };

function ActivityRow({ a, labs, datasets }) {
  const { assigned, inProgress, completed } = a.progress;
  const started = inProgress + completed;
  const status = completed === assigned ? 'completed' : started ? 'inProgress' : 'assigned';
  const lab = labs.find((l) => l.id === a.labId);
  const ds = datasets.find((d) => d.id === a.datasetId);
  const overdue = new Date(a.dueDate) < new Date() && status !== 'completed';
  return (
    <li className="rounded-2xl border border-line bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <LabIcon type={lab?.type} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">{a.title}</p>
          <p className="mt-0.5 text-sm text-gray-400">{a.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className={cx('flex items-center gap-1', overdue && 'text-red-300')}><CalendarClock className="h-3.5 w-3.5" />Due {formatDateTime(a.dueDate)}</span>
            {ds && <span className="flex items-center gap-1"><Database className="h-3.5 w-3.5" />{ds.name}</span>}
            <span>{a.assignTo.type === 'class' ? 'Whole class' : `${a.assignTo.studentIds.length} students`}</span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs"><span className="text-gray-400">{started} of {assigned} students started</span><span className="font-mono text-gray-500">{completed} done</span></div>
        <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
          <div className="bg-status-running transition-all duration-700" style={{ width: `${(completed / assigned) * 100}%` }} />
          <div className="bg-status-provisioning transition-all duration-700" style={{ width: `${(inProgress / assigned) * 100}%` }} />
        </div>
        <div className="mt-2 flex gap-2 text-[11px]">
          <StatusBadge status="assigned" label={`Assigned ${assigned}`} /><StatusBadge status="inProgress" label={`In progress ${inProgress}`} /><StatusBadge status="completed" label={`Completed ${completed}`} />
        </div>
      </div>
    </li>
  );
}

export default function Activities() {
  const { user } = useAuth();
  const toast = useToast();
  const activities = useQuery(() => api.listActivities(), []);
  const labs = useQuery(() => api.listLabs(), []);
  const datasets = useQuery(() => api.listDatasets('shared'), []);
  const students = useQuery(() => api.listStudents({ pageSize: 100 }), []);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const canAssign = user.role === 'faculty'; // admins can read but not assign (contract section 4)
  const labList = (labs.data?.data ?? []).filter((l) => !l.comingSoon);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const activeStudents = useMemo(() => (students.data?.data ?? []).filter((s) => s.status === 'active'), [students.data]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createActivity({
        title: form.title, description: form.description, labId: form.labId, dueDate: new Date(form.dueDate).toISOString(),
        datasetId: form.datasetId || null, assignTo: { type: form.assignType, studentIds: form.assignType === 'students' ? form.studentIds : [] },
      });
      toast.success('Activity assigned');
      setForm(EMPTY); setErrors({});
      activities.refresh();
    } catch (err) { setErrors(err.details ?? {}); toast.apiError(err); } finally { setSaving(false); }
  };

  const toggleStudent = (id) => setForm((f) => ({ ...f, studentIds: f.studentIds.includes(id) ? f.studentIds.filter((x) => x !== id) : [...f.studentIds, id] }));

  return (
    <>
      <PageHeader title="Assign Lab Activity" description="Give the class (or a few students) a lab task with a due date." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="New activity" className="lg:col-span-2">
          {!canAssign && <Banner tone="info" className="mb-4">Admins can view activities. Only faculty can assign them.</Banner>}
          <form onSubmit={submit} className="space-y-4" noValidate>
            <fieldset disabled={!canAssign} className="space-y-4 disabled:opacity-50">
              <Field label="Title" htmlFor="a-title" error={errors.title}><Input id="a-title" value={form.title} onChange={set('title')} invalid={!!errors.title} placeholder="Pandas basics" /></Field>
              <Field label="Description" htmlFor="a-desc"><Textarea id="a-desc" value={form.description} onChange={set('description')} placeholder="What should students do?" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Lab template" htmlFor="a-lab" error={errors.labId}><Select id="a-lab" value={form.labId} onChange={set('labId')}>{labList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
                <Field label="Due date" htmlFor="a-due" error={errors.dueDate}><Input id="a-due" type="datetime-local" value={form.dueDate} onChange={set('dueDate')} invalid={!!errors.dueDate} /></Field>
              </div>
              <Field label="Dataset (optional)" htmlFor="a-ds">
                <Select id="a-ds" value={form.datasetId} onChange={set('datasetId')}><option value="">No dataset</option>{(datasets.data?.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
              </Field>
              <Field label="Assign to" error={errors.assignTo}>
                <div className="grid grid-cols-2 gap-2">
                  {[['class', 'Whole class'], ['students', 'Select students']].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setForm({ ...form, assignType: v })} className={cx('rounded-xl border px-3 py-2 text-sm transition', form.assignType === v ? 'border-accent bg-accent/10 text-white' : 'border-line text-gray-400 hover:border-white/20')}>{l}</button>
                  ))}
                </div>
              </Field>
              {form.assignType === 'students' && (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                  {activeStudents.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-gray-300 hover:bg-white/[0.03]">
                      <input type="checkbox" checked={form.studentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} className="h-4 w-4 accent-teal-500" />
                      {s.name}<span className="ml-auto font-mono text-xs text-gray-600">{s.rollNo}</span>
                    </label>
                  ))}
                </div>
              )}
              <Button type="submit" icon={Send} loading={saving} className="w-full">Assign activity</Button>
            </fieldset>
          </form>
        </Card>
        <Card title="Assigned activities" className="lg:col-span-3" action={<span className="text-xs text-gray-500">{activities.data?.meta?.total ?? 0} total</span>}>
          {activities.loading ? <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div> : activities.data.data.length ? (
            <ul className="space-y-3">{activities.data.data.map((a) => <ActivityRow key={a.id} a={a} labs={labs.data?.data ?? []} datasets={datasets.data?.data ?? []} />)}</ul>
          ) : <EmptyState icon={ClipboardList} title="No activities yet" message="Assign your first lab activity using the form." />}
          {activities.data?.data.length > 0 && <p className="mt-4 text-xs text-gray-600">Newest first · created {timeAgo(activities.data.data[0].createdAt)}</p>}
        </Card>
      </div>
    </>
  );
}
