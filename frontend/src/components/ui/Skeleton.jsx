import { cx } from '../../utils/format';

/** Shimmering placeholder while data loads. */
export default function Skeleton({ className }) {
  return (
    <div className={cx('relative overflow-hidden rounded-lg bg-white/5', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}

export function SkeletonCards({ count = 3, className = 'h-44' }) {
  return Array.from({ length: count }, (_, i) => <Skeleton key={i} className={cx('rounded-2xl', className)} />);
}
