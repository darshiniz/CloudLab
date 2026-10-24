import { capitalize, cx } from '../../utils/format';

// Colours from the Build Guide: Requested slate, Provisioning cyan (pulse), Running green (pulse dot),
// Inactive orange, Stopped gray, Failed red, Terminated dark gray. Plus node/user/activity states.
const STYLES = {
  requested: 'bg-slate-400/10 text-slate-300 ring-slate-400/30',
  queued: 'bg-yellow-500/10 text-yellow-300 ring-yellow-500/30',
  provisioning: 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/30',
  running: 'bg-green-500/10 text-green-300 ring-green-500/30',
  inactive: 'bg-orange-500/10 text-orange-300 ring-orange-500/30',
  stopped: 'bg-slate-500/10 text-slate-400 ring-slate-500/30',
  failed: 'bg-red-500/10 text-red-300 ring-red-500/30',
  terminated: 'bg-slate-700/30 text-slate-500 ring-slate-600/30',
  // nodes
  online: 'bg-green-500/10 text-green-300 ring-green-500/30',
  degraded: 'bg-orange-500/10 text-orange-300 ring-orange-500/30',
  offline: 'bg-red-500/10 text-red-300 ring-red-500/30',
  // users
  active: 'bg-green-500/10 text-green-300 ring-green-500/30',
  // activities
  assigned: 'bg-blue-500/10 text-blue-300 ring-blue-500/30',
  inProgress: 'bg-cyan-500/10 text-cyan-300 ring-cyan-500/30',
  completed: 'bg-green-500/10 text-green-300 ring-green-500/30',
};
const DOT = {
  provisioning: 'bg-cyan-400 animate-pulse',
  running: 'bg-green-400',
  online: 'bg-green-400',
  queued: 'bg-yellow-400 animate-pulse',
};
const LABELS = { inProgress: 'In progress', inactive: 'Inactive' };

export default function StatusBadge({ status, className, label }) {
  const pulse = status === 'running' || status === 'online';
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', STYLES[status] ?? STYLES.stopped, className)}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />}
        <span className={cx('relative inline-flex h-1.5 w-1.5 rounded-full', DOT[status] ?? 'bg-current')} />
      </span>
      {label ?? LABELS[status] ?? capitalize(status)}
    </span>
  );
}
