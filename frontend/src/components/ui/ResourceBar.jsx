import { motion } from 'framer-motion';
import { cx } from '../../utils/format';

/** CPU / RAM / disk bar with animated fill. Turns orange at 70% and red at 85%. */
export default function ResourceBar({ label, value = 0, max = 100, display, icon: Icon, className, size = 'md', color }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const fill = color ?? (pct >= 85 ? '#EF4444' : pct >= 70 ? '#F97316' : 'rgb(var(--accent))');
  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-gray-400">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</span>
          <span className="font-mono text-gray-300">{display ?? `${Math.round(pct)}%`}</span>
        </div>
      )}
      <div className={cx('overflow-hidden rounded-full bg-white/5', size === 'sm' ? 'h-1' : 'h-1.5')}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: fill }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
