import { motion } from 'framer-motion';
import { cx } from '../../utils/format';

/** Glass card. `hover` adds lift + accent glow. `title`/`action` add a header row. */
export default function Card({ title, subtitle, action, hover = false, className, bodyClassName, children, padded = true, as = 'section' }) {
  const MotionTag = motion[as] ?? motion.section;
  return (
    <MotionTag
      whileHover={hover ? { y: -3 } : undefined}
      transition={{ duration: 0.2 }}
      className={cx(
        'rounded-2xl border border-line bg-card/80 backdrop-blur-sm',
        hover && 'transition-shadow duration-300 hover:shadow-glow-accent',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx(padded && 'p-5', bodyClassName)}>{children}</div>
    </MotionTag>
  );
}
