import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from '../../utils/format';

const VARIANTS = {
  primary: 'bg-brand-gradient text-white shadow-lg shadow-brand-from/20 hover:shadow-brand-to/40 hover:brightness-110',
  accent: 'bg-accent text-white hover:brightness-110',
  secondary: 'border border-line bg-white/5 text-gray-200 hover:bg-white/10 hover:text-white',
  ghost: 'text-gray-300 hover:bg-white/5 hover:text-white',
  danger: 'border border-status-failed/30 bg-status-failed/10 text-red-300 hover:bg-status-failed/20',
  success: 'border border-status-running/30 bg-status-running/10 text-green-300 hover:bg-status-running/20',
};
const SIZES = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' };

/** as: 'button' (default) or a component like Link · variant: primary | accent | secondary | ghost | danger | success · size: sm | md | lg */
const Button = forwardRef(function Button(
  { as: Tag = 'button', variant = 'primary', size = 'md', icon: Icon, loading = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <Tag
      ref={ref}
      disabled={Tag === 'button' ? disabled || loading : undefined}
      aria-disabled={Tag !== 'button' && disabled ? true : undefined}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-xl font-medium transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-from/60 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </Tag>
  );
});
export default Button;
