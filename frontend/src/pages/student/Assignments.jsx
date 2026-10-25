import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Award, CalendarClock, Lock, File as FileIcon, Folder, CheckCircle2, ClipboardList, Database, ExternalLink, Play, Send, Terminal, User } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { Banner, Button, Card, EmptyState, Field, Modal, PageHeader, Skeleton, StatusBadge, Textarea } from '../../components/ui';
import CreateLabModal from '../../components/labs/CreateLabModal';
import LabIcon from '../../components/labs/LabIcon';
import { cx, formatDateTime, timeAgo } from '../../utils/format';

const LOCK_TEXT = {
  closed: 'Your faculty has stopped accepting submissions.',
  pastDue: 'The due date has passed and late submissions are not accepted.',
  graded: 'Graded. Ask your faculty to reopen it if you need to change it.',
};
const STATUS_LABEL = { assigned: 'Not started', inProgress: 'In progress', submitted: 'Submitted' };

function Assignment({ a, onStart, onOpen, onMyLabs, onSubmit }) {
  const submitted = a.status === 'submitted';
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <LabIcon type={a.lab.type} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">{a.title}</p>
          <p className="mt-0.5 text-sm text-gray-400">{a.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className={cx('flex items-center gap-1', a.overdue && 'text-red-300')}>
              <CalendarClock className="h-3.5 w-3.5" />Due {formatDateTime(a.dueDate)}{a.overdue ? ' · overdue' : ''}
            </span>
            <span>{a.lab.name}</span>
            {a.dataset && <span className="flex items-center gap-1"><Database className="h-3.5 w-3.5" />{a.dataset.name}</span>}
            {a.assignedBy && <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{a.assignedBy} · {timeAgo(a.createdAt)}</span>}
          </p>
          {submitted && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
              <CheckCircle2 className="h-3.5 w-3.5 text-status-running" />
              Submitted {formatDateTime(a.submission.submittedAt)}{a.submission.late ? ' · late' : ''}
              {a.submission.note && <span className="text-gray-500">· “{a.submission.note}”</span>}
              {a.submission.paths?.length > 0 && <span className="text-gray-500">· handed in: {a.submission.paths.join(', ')}</span>}
            </p>
          )}
          {submitted && (a.submission.marks != null ? (
            <div className="mt-3 rounded-xl border border-status-running/30 bg-status-running/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-white"><Award className="h-4 w-4 text-status-running" />Marks: {a.submission.marks} / {a.maxMarks}</p>
              {a.submission.feedback && <p className="mt-1 whitespace-pre-line text-sm text-gray-300">{a.submission.feedback}</p>}
            </div>
          ) : <p className="mt-2 text-xs text-gray-600">Not graded yet.</p>)}
        </div>
        <StatusBadge status={a.status} label={STATUS_LABEL[a.status]} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {a.status === 'assigned' && <Button size="sm" icon={Play} onClick={() => onStart(a)}>Start lab</Button>}
        {a.status === 'inProgress' && (a.liveEnvironmentId
          ? <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => onOpen(a)}>Open lab</Button>
          : <Button size="sm" variant="secondary" icon={Terminal} onClick={onMyLabs}>Resume in My Labs</Button>)}
        {a.canSubmit
          ? <Button size="sm" variant={submitted ? 'secondary' : 'primary'} icon={Send} onClick={() => onSubmit(a)}>{submitted ? 'Update submission' : 'Submit'}</Button>
          : <span className="flex items-center gap-2 text-xs text-yellow-300"><Lock className="h-3.5 w-3.5" />{LOCK_TEXT[a.lockedReason]}</span>}
      </div>
    </motion.li>
  );
}

/** Activities faculty assigned to this student. Work is saved in your workspace; press Submit when you are finished. */
export default function Assignments() {
  const navigate = useNavigate();
  const toast = useToast();
  const list = useQuery(() => api.listAssignments(), [], { interval: 10000 });
  const labs = useQuery(() => api.listLabs(), []);
  const [starting, setStarting] = useState(null);
  const [submitting, setSubmitting] = useState(null);
  const [note, setNote] = useState('');
  const [wsItems, setWsItems] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [saving, setSaving] = useState(false);

  const items = list.data?.data ?? [];
  const todo = useMemo(() => items.filter((a) => a.status !== 'submitted'), [items]);
  const done = useMemo(() => items.filter((a) => a.status === 'submitted'), [items]);
  const labList = labs.data?.data;
  const initialLab = starting && labList ? labList.find((l) => l.id === starting.lab.id) : undefined;

  const openSubmit = async (a) => {
    setSubmitting(a); setNote(a.submission?.note ?? ''); setWsItems(null);
    setChosen(a.submission?.paths ?? []);
    try { setWsItems(await api.listWorkspaceItems()); } catch (err) { toast.apiError(err); setWsItems([]); }
  };
  const toggle = (name) => setChosen((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));
  const confirmSubmit = async () => {
    setSaving(true);
    try {
      await api.submitAssignment(submitting.id, note.trim(), chosen);
      toast.success(submitting.status === 'submitted' ? 'Submission updated' : 'Submitted. Your faculty can now see your work.');
      setSubmitting(null);
      list.refresh();
    } catch (err) { toast.apiError(err); } finally { setSaving(false); }
  };

  const row = (a) => <Assignment key={a.id} a={a} onStart={setStarting} onOpen={(x) => navigate(`/student/workspace/${x.liveEnvironmentId}`)} onMyLabs={() => navigate('/student/labs')} onSubmit={openSubmit} />;

  return (
    <>
      <PageHeader title="Assignments" description="Activities your faculty have assigned to you." />
      {list.loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={ClipboardList} title="Nothing assigned yet" message="When a faculty member assigns you an activity, it appears here with its due date." /></Card>
      ) : (
        <div className="space-y-6">
          <Banner tone="info">Your files are saved in your workspace, so you can stop a lab and carry on another day. Press <b>Submit</b> when you are finished.</Banner>
          <Card title="To do" subtitle={`${todo.length} open`}>
            {todo.length ? <ul className="space-y-3">{todo.map(row)}</ul> : <p className="text-sm text-gray-500">You are all caught up.</p>}
          </Card>
          {done.length > 0 && <Card title="Submitted" subtitle={`${done.length} handed in`}><ul className="space-y-3">{done.map(row)}</ul></Card>}
        </div>
      )}

      <Modal open={!!submitting} onClose={() => setSubmitting(null)} title={submitting?.status === 'submitted' ? 'Update submission' : 'Submit activity'} description={submitting?.title}
        footer={<><Button variant="secondary" onClick={() => setSubmitting(null)}>Cancel</Button><Button icon={Send} loading={saving} onClick={confirmSubmit}>{submitting?.status === 'submitted' ? 'Update' : 'Submit'}</Button></>}>
        <p className="mb-3 text-sm text-gray-400">Choose what to hand in. Your faculty can open <b>only</b> the folders and files you tick, exactly as they are now. Anything else in your workspace stays private.</p>
        <div className="mb-4 max-h-48 overflow-y-auto rounded-xl border border-line">
          {wsItems === null ? <p className="p-3 text-sm text-gray-500">Loading your workspace…</p>
            : wsItems.length === 0 ? <p className="p-3 text-sm text-gray-500">Your workspace is empty. You can still submit with a note.</p>
            : wsItems.map((i) => (
              <label key={i.name} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm text-gray-300 last:border-0 hover:bg-white/[0.03]">
                <input type="checkbox" checked={chosen.includes(i.name)} onChange={() => toggle(i.name)} className="h-4 w-4 accent-teal-500" />
                {i.type === 'folder' ? <Folder className="h-4 w-4 text-accent" /> : <FileIcon className="h-4 w-4 text-gray-500" />}
                <span className="flex-1">{i.name}</span>
              </label>
            ))}
        </div>
        {wsItems && wsItems.length > 0 && chosen.length === 0 && <p className="mb-3 text-xs text-yellow-300">Nothing is ticked, so your faculty will see only your note.</p>}
        <Field label="Note (optional)" htmlFor="sub-note"><Textarea id="sub-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Anything your faculty should know?" /></Field>
      </Modal>

      <CreateLabModal open={!!starting} onClose={() => setStarting(null)} labs={labList} initialLab={initialLab} onCreated={list.refresh} />
    </>
  );
}
