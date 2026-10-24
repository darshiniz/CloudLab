import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LogOut, Menu, RotateCcw, Search, User } from 'lucide-react';
import { isMocked } from '../../services/api';
import { resetMockData } from '../../mocks/server';
import { useAuth } from '../../context/AuthContext';
import { Avatar, RoleBadge } from '../ui';

export default function Topbar({ links, onOpenMobile, title }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Quick search: jump to any page in this role's sidebar
  const results = useMemo(
    () => (q ? links.filter((l) => l.label.toLowerCase().includes(q.toLowerCase())) : []),
    [q, links],
  );

  useEffect(() => {
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (to) => { navigate(to); setQ(''); setSearchOpen(false); };
  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
      <button onClick={onOpenMobile} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <p className="hidden text-sm font-medium text-gray-300 xl:block">{title}</p>

      <div className="relative ml-auto w-full max-w-xs sm:ml-0 sm:flex-1 xl:ml-8">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          onKeyDown={(e) => e.key === 'Enter' && results[0] && go(results[0].to)}
          placeholder="Search pages…"
          aria-label="Search pages"
          className="h-9 w-full rounded-xl border border-line bg-white/[0.03] pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-accent/60 focus:outline-none"
        />
        <AnimatePresence>
          {searchOpen && results.length > 0 && (
            <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute left-0 right-0 top-11 overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
              {results.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <button onMouseDown={() => go(to)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5 hover:text-white">
                    <Icon className="h-4 w-4 text-accent" />{label}
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3 sm:ml-auto">
        <RoleBadge role={user.role} className="hidden sm:inline-flex" />
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-white/5" aria-haspopup="menu" aria-expanded={menuOpen}>
            <Avatar name={user.name} size="sm" />
            <span className="hidden max-w-[140px] truncate text-sm text-gray-200 md:block">{user.name}</span>
            <ChevronDown className="hidden h-4 w-4 text-gray-500 md:block" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
                className="absolute right-0 top-12 w-64 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
                <div className="border-b border-line p-4">
                  <p className="truncate text-sm font-medium text-white">{user.name}</p>
                  <p className="truncate text-xs text-gray-500">{user.email}</p>
                  {user.rollNo && <p className="mt-1 font-mono text-xs text-gray-500">{user.rollNo}</p>}
                </div>
                <div className="p-1.5">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400"><User className="h-4 w-4" />Signed in as <RoleBadge role={user.role} /></div>
                  {isMocked('environments') && (
                    <button role="menuitem" onClick={() => { resetMockData(); window.location.reload(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-white/5">
                      <RotateCcw className="h-4 w-4" />Reset demo data
                    </button>
                  )}
                  <button role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
                    <LogOut className="h-4 w-4" />Log out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
