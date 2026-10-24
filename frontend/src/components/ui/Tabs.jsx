import { motion } from 'framer-motion';
import { cx } from '../../utils/format';

/** tabs: [{ value, label, count? }] */
export default function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('inline-flex rounded-xl border border-line bg-white/[0.03] p-1', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx('relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors', value === t.value ? 'text-white' : 'text-gray-400 hover:text-gray-200')}
        >
          {value === t.value && <motion.span layoutId={`tab-${tabs.map((x) => x.value).join()}`} className="absolute inset-0 rounded-lg bg-accent/20 ring-1 ring-inset ring-accent/30" transition={{ duration: 0.25 }} />}
          <span className="relative">{t.label}{t.count != null && <span className="ml-1.5 text-xs text-gray-500">{t.count}</span>}</span>
        </button>
      ))}
    </div>
  );
}
