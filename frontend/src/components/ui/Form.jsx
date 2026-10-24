import { forwardRef } from 'react';
import { cx } from '../../utils/format';

const base = 'w-full rounded-xl border border-line bg-white/[0.03] px-3.5 text-sm text-white placeholder:text-gray-500 transition focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50';

export function Field({ label, htmlFor, error, hint, children, className }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-300">{label}</label>}
      {children}
      {error ? <p className="text-xs text-red-400">{error}</p> : hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, icon: Icon, ...rest }, ref) {
  if (Icon) {
    return (
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <input ref={ref} className={cx(base, 'h-10 pl-9', invalid && 'border-red-500/60', className)} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cx(base, 'h-10', invalid && 'border-red-500/60', className)} {...rest} />;
});

export function Textarea({ className, invalid, ...rest }) {
  return <textarea className={cx(base, 'min-h-[88px] py-2.5', invalid && 'border-red-500/60', className)} {...rest} />;
}

export function Select({ className, children, invalid, ...rest }) {
  return (
    <select className={cx(base, 'h-10 appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9', invalid && 'border-red-500/60', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-white/10')}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

export function Slider({ value, onChange, min, max, step = 1, id, ...rest }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="cl-slider w-full"
      style={{ '--pct': `${pct}%` }}
      {...rest}
    />
  );
}
