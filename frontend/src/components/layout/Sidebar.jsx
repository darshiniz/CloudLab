import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import Logo from './Logo';
import { cx } from '../../utils/format';

/** Collapsible on desktop, slide-in drawer on mobile. Links come from config/navigation.js */
export default function Sidebar({ links, collapsed, onToggle, mobileOpen, onCloseMobile, home }) {
  const nav = (isMobile) => (
    <nav className="flex-1 space-y-1 px-3">
      {links.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={isMobile ? onCloseMobile : undefined}
          title={collapsed && !isMobile ? label : undefined}
          className={({ isActive }) => cx(
            'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            isActive ? 'text-white' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200',
            collapsed && !isMobile && 'justify-center px-0',
          )}
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId={isMobile ? 'nav-m' : 'nav-d'} className="absolute inset-0 rounded-xl bg-accent/15 ring-1 ring-inset ring-accent/25" transition={{ duration: 0.25 }} />}
              <Icon className={cx('relative h-[18px] w-[18px] shrink-0', isActive && 'text-accent')} />
              {(!collapsed || isMobile) && <span className="relative truncate">{label}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-[#0C1120] py-5 transition-[width] duration-300 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <div className={cx('mb-8 px-5', collapsed && 'flex justify-center px-0')}><Logo collapsed={collapsed} to={home} /></div>
        {nav(false)}
        <div className="px-3">
          <button onClick={onToggle} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:bg-white/[0.04] hover:text-gray-300', collapsed && 'justify-center px-0')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <><ChevronsLeft className="h-[18px] w-[18px]" />Collapse</>}
          </button>
        </div>
      </aside>

      {/* Mobile */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div className="absolute inset-0 bg-black/60" onClick={onCloseMobile} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-[#0C1120] py-5" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ duration: 0.25 }}>
              <div className="mb-8 flex items-center justify-between px-5">
                <Logo to={home} />
                <button onClick={onCloseMobile} className="rounded-lg p-1 text-gray-400 hover:text-white" aria-label="Close menu"><X className="h-5 w-5" /></button>
              </div>
              {nav(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
