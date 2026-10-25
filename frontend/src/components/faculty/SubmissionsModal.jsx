import { useState } from 'react';
import { ArrowLeft, ChevronRight, Download, File as FileIcon, Folder, Eye, Award } from 'lucide-react';
import { api, saveDownload } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { useToast } from '../../context/ToastContext';
import { Button, EmptyState, Field, Input, Modal, Skeleton, StatusBadge, Textarea } from '../ui';
import { formatBytes, formatDateTime } from '../../utils/format';

const LABEL = { assigned: 'Not started', inProgress: 'In progress', submitted: 'Submitted' };

/** Read-only view of a submitted student's workspace. */
function FileBrowser({ activityId, student, onBack }) {
  const toast = useToast();
  const [path, setPath] = useState('/');
  const files = useQuery(() => api.listSubmissionFiles(activityId, student.studentId, path), [path]);
  const crumbs = path.split('/').filter(Boolean);
  const download = async (f) => {
    try { saveDownload(await api.downloadSubmissionFile(activityId, student.studentId, f.path)); } catch (err) { toast.apiError(err); }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="secondary" icon={ArrowLeft} onClick={onBack}>All students</Button>
        <span className="text-gray-400">{student.name}'s workspace</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1 font-mono text-xs text-gray-500">
        <button type="button" className="hover:text-white" onClick={() => setPath('/')}>/</button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1"><ChevronRight className="h-3 w-3" />
            <button type="button" className="hover:text-white" onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>
        ))}
      </div>
      {files.loading ? <Skeleton className="h-32" /> : files.error ? <p className="text-sm text-red-300">{files.error.message}</p> : (files.data?.data ?? []).length === 0 ? (
        <EmptyState icon={Folder} title="Empty folder" message="Nothing here." />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {files.data.data.map((f) => (
            <li key={f.path} className="flex items-center gap-3 px-3 py-2 text-sm">
              {f.type === 'folder' ? <Folder className="h-4 w-4 text-accent" /> : <FileIcon className="h-4 w-4 text-gray-500" />}
              {f.type === 'folder'
                ? <button type="button" className="flex-1 text-left text-white hover:underline" onClick={() => setPath(f.path)}>{f.name}</button>
                : <span className="flex-1 text-gray-200">{f.name}</span>}
              {f.type === 'file' && <><span className="text-xs text-gray-500">{formatBytes(f.sizeBytes)}</span><Button size="sm" variant="secondary" icon={Download} onClick={() => download(f)}>Download</Button></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Marks and feedback for one submission. */
function GradeForm({ activity, row, onSaved, onCancel }) {
  const toast = useToast();
  const max = activity.maxMarks ?? 100;
  const [marks, setMarks] = useState(row.marks ?? '');
  const [feedback, setFeedback] = useState(row.feedback ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const n = Number(marks);
    if (marks === '' || Number.isNaN(n) || n < 0 || n > max) { setError(`Enter marks from 0 to ${max}`); return; }
    setError(''); setSaving(true);
    try {
      await api.gradeSubmission(activity.id, row.studentId, { marks: n, feedback: feedback.trim() });
      toast.success(`Marks saved for ${row.name}`);
      onSaved();
    } catch (err) { toast.apiError(err); } finally { setSaving(false); }
  };
  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={`Marks (out of ${max})`} htmlFor={`m-${row.studentId}`} error={error}>
          <Input id={`m-${row.studentId}`} type="number" min="0" max={max} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} invalid={!!error} />
        </Field>
        <Field label="Feedback for the student" htmlFor={`f-${row.studentId}`} className="sm:col-span-3">
          <Textarea id={`f-${row.studentId}`} value={feedback} maxLength={2000} onChange={(e) => setFeedback(e.target.value)} placeholder="What went well, what to improve" />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button size="sm" icon={Award} loading={saving} onClick={save}>Save marks</Button>
      </div>
    </div>
  );
}

export default function SubmissionsModal({ activity, onClose }) {
  const toast = useToast();
  const subs = useQuery(() => (activity ? api.listSubmissions(activity.id) : Promise.resolve({ data: [] })), [activity?.id]);
  const [student, setStudent] = useState(null);
  const [grading, setGrading] = useState(null);
  const rows = subs.data?.data ?? [];
  const close = () => { setStudent(null); setGrading(null); onClose(); };
  const counts = { submitted: rows.filter((r) => r.status === 'submitted').length, total: rows.length };

  return (
    <Modal open={!!activity} onClose={close} size="lg" title={activity ? `Submissions · ${activity.title}` : ''}
      description={activity ? `${counts.submitted} of ${counts.total} students have submitted` : ''}>
      {student ? <FileBrowser activityId={activity.id} student={student} onBack={() => setStudent(null)} /> : subs.loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? <p className="text-sm text-gray-500">No students are assigned to this activity.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.studentId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{r.name} <span className="ml-1 font-mono text-xs text-gray-600">{r.rollNo}</span></p>
                {r.status === 'submitted'
                  ? <p className="text-xs text-gray-500">Submitted {formatDateTime(r.submittedAt)}{r.late ? ' · late' : ''}{r.note ? ` · “${r.note}”` : ''}{r.paths?.length ? ` · handed in: ${r.paths.join(', ')}` : ' · no files handed in'}{r.marks != null ? ` · ${r.marks}/${r.maxMarks} marks` : ' · not graded'}</p>
                  : <p className="text-xs text-gray-600">{r.status === 'inProgress' ? 'Started a lab, not submitted yet' : 'Has not started'}</p>}
              </div>
              <StatusBadge status={r.status} label={r.late && r.status === 'submitted' ? 'Submitted late' : LABEL[r.status]} />
              {r.status === 'submitted' && <Button size="sm" variant="secondary" icon={Eye} onClick={() => setStudent(r)}>View files</Button>}
              {r.status === 'submitted' && <Button size="sm" variant="secondary" icon={Award} onClick={() => setGrading(grading === r.studentId ? null : r.studentId)}>{r.marks != null ? 'Edit marks' : 'Grade'}</Button>}
              {r.status === 'submitted' && r.marks != null && (
                <Button size="sm" variant="secondary" onClick={async () => {
                  if (!window.confirm(`Take back ${r.name}'s grade so they can update their submission? Their marks and feedback will be cleared.`)) return;
                  try { await api.reopenSubmission(activity.id, r.studentId); toast.success(`${r.name} can update the submission now`); subs.refresh(); } catch (err) { toast.apiError(err); }
                }}>Reopen</Button>
              )}
              {grading === r.studentId && <GradeForm activity={activity} row={r} onCancel={() => setGrading(null)} onSaved={() => { setGrading(null); subs.refresh(); }} />}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
