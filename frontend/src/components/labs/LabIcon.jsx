import { LAB_META, cx } from '../../utils/format';

export default function LabIcon({ type, size = 'md', className }) {
  const meta = LAB_META[type] ?? LAB_META.python;
  const Icon = meta.icon;
  const s = { sm: 'h-8 w-8 [&>svg]:h-4 [&>svg]:w-4', md: 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5', lg: 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6' }[size];
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', s, className)} style={{ color: meta.color, background: `${meta.color}1a`, '--tw-ring-color': `${meta.color}33` }}>
      <Icon />
    </span>
  );
}
