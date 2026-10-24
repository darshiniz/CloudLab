import { Timer } from 'lucide-react';
import { Button } from '../ui';
import { minutesUntil } from '../../utils/format';

/** "Auto-stops in 8 min due to inactivity" (Build Guide must-show) */
export default function InactivityWarning({ env, onStillHere, compact = false }) {
  const mins = minutesUntil(env.autoStopAt);
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'} text-orange-200`} role="status">
      <Timer className="h-4 w-4 shrink-0" />
      <span className="flex-1"><strong className="font-semibold">{env.name}</strong> auto-stops in {mins} min due to inactivity.</span>
      {onStillHere && <Button size="sm" variant="secondary" onClick={onStillHere}>I'm still here</Button>}
    </div>
  );
}
