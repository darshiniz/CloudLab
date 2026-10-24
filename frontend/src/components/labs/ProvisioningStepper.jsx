import { motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';
import { cx } from '../../utils/format';

/** Draws env.provisioning.steps (always all 7, contract section 5). */
export default function ProvisioningStepper({ steps, compact = false }) {
  if (compact) {
    const done = steps.filter((s) => s.state === 'done').length;
    const active = steps.find((s) => s.state === 'active' || s.state === 'failed');
    return (
      <div>
        <div className="mb-1.5 flex justify-between text-xs"><span className="text-cyan-300">{active?.label ?? 'Starting…'}</span><span className="font-mono text-gray-500">{done}/7</span></div>
        <div className="flex gap-1">
          {steps.map((s) => (
            <span key={s.key} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-500', s.state === 'done' ? 'bg-status-running' : s.state === 'active' ? 'animate-pulse bg-status-provisioning' : s.state === 'failed' ? 'bg-status-failed' : 'bg-white/10')} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <motion.li key={s.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="relative flex items-center gap-3 py-1.5">
          {i < steps.length - 1 && <span className={cx('absolute left-[13px] top-9 h-[calc(100%-18px)] w-px', s.state === 'done' ? 'bg-status-running/50' : 'bg-white/10')} />}
          <span className={cx('relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-colors duration-300',
            s.state === 'done' && 'bg-status-running/15 text-status-running ring-status-running/40',
            s.state === 'active' && 'bg-status-provisioning/15 text-status-provisioning ring-status-provisioning/40',
            s.state === 'failed' && 'bg-status-failed/15 text-status-failed ring-status-failed/40',
            s.state === 'pending' && 'bg-white/[0.03] text-gray-600 ring-white/10')}>
            {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : s.state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.state === 'failed' ? <X className="h-3.5 w-3.5" /> : <span className="text-[11px] font-mono">{i + 1}</span>}
          </span>
          <span className={cx('text-sm', s.state === 'pending' ? 'text-gray-500' : s.state === 'failed' ? 'text-red-300' : 'text-gray-200')}>{s.label}</span>
          {s.state === 'active' && <span className="ml-auto text-xs text-cyan-400">in progress</span>}
        </motion.li>
      ))}
    </ol>
  );
}
