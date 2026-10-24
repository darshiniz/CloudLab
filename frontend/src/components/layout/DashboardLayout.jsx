import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { NAV, ROLE_TITLE } from '../../config/navigation';
import { Banner } from '../ui';

/**
 * The shared frame for all three dashboards: Sidebar + Topbar + page.
 * `role` switches the links and the accent colour (Student blue, Faculty teal, Admin violet).
 */
export default function DashboardLayout({ role }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('cloudlab.sidebar') === 'collapsed'; } catch { return false; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const links = NAV[role];

  useEffect(() => { try { localStorage.setItem('cloudlab.sidebar', collapsed ? 'collapsed' : 'open'); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div data-role={role} className="flex min-h-screen bg-bg">
      <Sidebar links={links} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} home={`/${role}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar links={links} onOpenMobile={() => setMobileOpen(true)} title={ROLE_TITLE[role]} />
        <main className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {role === 'faculty' && (
            <Banner tone="info" className="mb-6 border-role-faculty/30 bg-role-faculty/10 text-teal-100">
              Faculty features are view and assign only; infrastructure controls are admin-only.
            </Banner>
          )}
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="border-t border-line px-6 py-4 text-center text-xs text-gray-600">
          CloudLab · Goa Business School, MCA Cloud Computing Project
        </footer>
      </div>
    </div>
  );
}
