import { Link } from 'react-router-dom';
import { Cloud } from 'lucide-react';
import { cx } from '../../utils/format';

export default function Logo({ collapsed = false, to = '/', className }) {
  return (
    <Link to={to} className={cx('flex items-center gap-2.5', className)} aria-label="CloudLab home">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-lg shadow-brand-from/30">
        <Cloud className="h-5 w-5 text-white" />
      </span>
      {!collapsed && <span className="text-lg font-bold tracking-tight text-white">Cloud<span className="text-gradient">Lab</span></span>}
    </Link>
  );
}
