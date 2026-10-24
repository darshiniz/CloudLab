import { motion } from 'framer-motion';
import useCountUp from '../../hooks/useCountUp';
import Sparkline from './Sparkline';
import Skeleton from './Skeleton';

/** Number tile with count-up + optional sparkline. */
export default function StatCard({ label, value, suffix = '', decimals = 0, icon: Icon, hint, trend, color, loading, format }) {
  const n = useCountUp(typeof value === 'number' ? value : 0);
  const shown = typeof value === 'number' ? (format ? format(n) : n.toFixed(decimals)) : value;
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className="group relative overflow-hidden rounded-2xl border border-line bg-card/80 p-4 sm:p-5 backdrop-blur-sm transition-shadow duration-300 hover:shadow-glow-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="mt-1.5 text-xl font-bold tabular-nums text-white sm:text-3xl">
              {shown}<span className="ml-0.5 text-base font-semibold text-gray-400">{suffix}</span>
            </p>
          )}
          {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
        </div>
        {Icon && (
          <div className="hidden rounded-xl bg-accent/10 p-2.5 min-[420px]:block text-accent ring-1 ring-inset ring-accent/20" style={color ? { color, background: `${color}1a` } : undefined}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {trend && <div className="mt-3"><Sparkline data={trend} color={color} width={160} height={28} fluid /></div>}
    </motion.div>
  );
}
