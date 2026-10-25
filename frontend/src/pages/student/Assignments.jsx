import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarClock, ClipboardList, Database, ExternalLink, Play, User } from 'lucide-react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { Button, Card, EmptyState, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import CreateLabModal from '../../components/labs/CreateLabModal';
import LabIcon from '../../components/labs/LabIcon';
import { cx, formatDateTime, timeAgo } from '../../utils/format';

const STATUS_LABEL = { assigned: 'Not started', inProgress: 'In progress', completed: 'Done' };

function Assignment({ a, onStart, onOpen }) {
  const done = a.status === 'completed';
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
        </div>
        <StatusBadge status={a.status} label={STATUS_LABEL[a.status]} />
      </div>
      {!done && (
        <div className="mt-4 flex flex-wrap gap-2">
          {a.status === 'inProgress' && a.environmentId
            ? <Button size="sm" icon={ExternalLink} onClick={() => onOpen(a)}>Open lab</Button>
            : <Button size="sm" icon={Play} onClick={() => onStart(a)}>Start lab</Button>}
        </div>
      )}
    </motion.li>
  );
}

/** Activities faculty assigned to this student. "Start lab" opens Create Lab with the right template already chosen. */
export default function Assignments() {
  const navigate = useNavigate();
  const list = useQuery(() => api.listAssignments(), [], { interval: 10000 });
  const labs = useQuery(() => api.listLabs(), []);
  const [starting, setStarting] = useState(null);

  const items = list.data?.data ?? [];
  const todo = useMemo(() => items.filter((a) => a.status !== 'completed'), [items]);
  const done = useMemo(() => items.filter((a) => a.status === 'completed'), [items]);
  const labList = labs.data?.data;
  const initialLab = starting && labList ? labList.find((l) => l.id === starting.lab.id) : undefined;

  return (
    <>
      <PageHeader title="Assignments" description="Activities your faculty have assigned to you." />
      {list.loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={ClipboardList} title="Nothing assigned yet" message="When a faculty member assigns you an activity, it appears here with its due date." /></Card>
      ) : (
        <div className="space-y-6">
          <Card title="To do" subtitle={`${todo.length} open`}>
            {todo.length ? <ul className="space-y-3">{todo.map((a) => <Assignment key={a.id} a={a} onStart={setStarting} onOpen={(x) => navigate(`/student/workspace/${x.environmentId}`)} />)}</ul>
              : <p className="text-sm text-gray-500">You are all caught up.</p>}
          </Card>
          {done.length > 0 && (
            <Card title="Done" subtitle={`${done.length} finished`}>
              <ul className="space-y-3">{done.map((a) => <Assignment key={a.id} a={a} />)}</ul>
            </Card>
          )}
        </div>
      )}
      <CreateLabModal open={!!starting} onClose={() => setStarting(null)} labs={labList} initialLab={initialLab} onCreated={list.refresh} />
    </>
  );
}