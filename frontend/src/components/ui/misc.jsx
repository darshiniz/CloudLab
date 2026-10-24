import { motion } from 'framer-motion';
import { AlertTriangle, Info, ShieldAlert, XCircle } from 'lucide-react';
import { capitalize, cx, initials } from '../../utils/format';

/** Page title + description + actions */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BANNER = {
  info: ['border-brand-from/30 bg-brand-from/10 text-blue-200', Info],
  warning: ['border-orange-500/30 bg-orange-500/10 text-orange-200', AlertTriangle],
  error: ['border-red-500/30 bg-red-500/10 text-red-200', XCircle],
  queued: ['border-yellow-500/30 bg-yellow-500/10 text-yellow-200', ShieldAlert],
};
export function Banner({ tone = 'info', title, children, action, className }) {
  const [style, Icon] = BANNER[tone];
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={cx('flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center', style, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="h-5 w-5 shrink-0" />
      <div className="flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(title && 'opacity-80')}>{children}</div>}
      </div>
      {action}
    </motion.div>
  );
}

const ROLE_STYLE = {
  student: 'bg-role-student/15 text-blue-300 ring-role-student/30',
  faculty: 'bg-role-faculty/15 text-teal-300 ring-role-faculty/30',
  admin: 'bg-role-admin/15 text-violet-300 ring-role-admin/30',
};
export function RoleBadge({ role, className }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', ROLE_STYLE[role], className)}>{capitalize(role)}</span>;
}

export function Chip({ children, className }) {
  return <span className={cx('inline-flex items-center rounded-lg border border-line bg-white/[0.04] px-2 py-0.5 text-xs text-gray-300', className)}>{children}</span>;
}

export function Avatar({ name, size = 'md', className }) {
  const s = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' }[size];
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-accent/20 font-semibold text-white ring-1 ring-accent/30', s, className)}>{initials(name)}</span>;
}

export function Mono({ children, className }) {
  return <span className={cx('font-mono text-xs text-gray-400', className)}>{children}</span>;
}

/** Fade-up on scroll, used everywhere for the "Motion" rule in the design system. */
export function FadeUp({ children, delay = 0, className, as = 'div' }) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}

/** Staggered grid: children fade up one after another */
export function Stagger({ children, className }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      {children}
    </motion.div>
  );
}
export const staggerItem = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } } };
