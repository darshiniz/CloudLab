import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpen, Lock, Mail, ShieldCheck, TerminalSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input } from '../../components/ui';
import Logo from '../../components/layout/Logo';
import AnimatedTerminal from '../../components/landing/AnimatedTerminal';
import { DEMO_ACCOUNTS } from '../../mocks/server';
import { isMocked } from '../../services/api';
import { cx } from '../../utils/format';

const ROLE_BUTTONS = [
  { role: 'student', label: 'Student', icon: TerminalSquare, ring: 'hover:border-role-student/60 hover:bg-role-student/10', text: 'text-role-student' },
  { role: 'faculty', label: 'Faculty', icon: BookOpen, ring: 'hover:border-role-faculty/60 hover:bg-role-faculty/10', text: 'text-role-faculty' },
  { role: 'admin', label: 'Admin', icon: ShieldCheck, ring: 'hover:border-role-admin/60 hover:bg-role-admin/10', text: 'text-role-admin' },
];

export default function Login() {
  const { user, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(null);

  if (user) return <Navigate to={`/${user.role}`} replace />;

  const signIn = async (e, p, key = 'form') => {
    setLoading(key);
    try {
      const u = await login(e, p);
      toast.success(`Welcome back, ${u.role === 'student' ? u.name.split(' ')[0] : u.name}`);
      // Redirect by role (contract 7.1). Go back to the page they wanted if it belongs to their role.
      const from = location.state?.from;
      navigate(from?.startsWith(`/${u.role}`) ? from : `/${u.role}`, { replace: true });
    } catch (err) {
      toast.apiError(err, 'Could not sign in');
      if (err.code === 'INVALID_CREDENTIALS') setErrors({ password: 'Wrong email or password' });
    } finally {
      setLoading(null);
    }
  };

  const submit = (ev) => {
    ev.preventDefault();
    const e = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = 'Enter a valid email address';
    if (password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    if (!Object.keys(e).length) signIn(email.trim(), password);
  };

  const demo = (role) => {
    const acc = DEMO_ACCOUNTS[role];
    setEmail(acc.email); setPassword(acc.password); setErrors({});
    signIn(acc.email, acc.password, role);
  };

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-2">
      {/* Left: terminal */}
      <div className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
        <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-brand-from/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-0 h-80 w-80 rounded-full bg-brand-to/20 blur-3xl" />
        <Logo className="relative" />
        <div className="relative">
          <h2 className="mb-2 text-3xl font-bold"><span className="text-gradient">Provision. Develop. Learn.</span></h2>
          <p className="mb-8 max-w-md text-gray-400">Your Python, Java and Web labs, ready in seconds. No installs.</p>
          <AnimatedTerminal />
        </div>
        <p className="relative text-xs text-gray-600">Goa Business School · MCA Cloud Computing Project</p>
      </div>

      {/* Right: glass card */}
      <div className="relative flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="pointer-events-none absolute inset-0 glow-radial lg:hidden" />
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="glass relative w-full max-w-md rounded-3xl p-8 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <Logo className="lg:hidden" />
            <Link to="/" className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"><ArrowLeft className="h-3.5 w-3.5" />Home</Link>
          </div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-gray-400">Use your college account.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label="Email" htmlFor="email" error={errors.email}>
              <Input id="email" type="email" icon={Mail} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gbs.edu" invalid={!!errors.email} />
            </Field>
            <Field label="Password" htmlFor="password" error={errors.password}>
              <Input id="password" type="password" icon={Lock} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" invalid={!!errors.password} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading === 'form'}>Sign in</Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-gray-500"><span className="h-px flex-1 bg-line" />or try a demo role<span className="h-px flex-1 bg-line" /></div>
          <div className="grid grid-cols-3 gap-2">
            {ROLE_BUTTONS.map(({ role, label, icon: Icon, ring, text }) => (
              <button key={role} onClick={() => demo(role)} disabled={!!loading}
                className={cx('flex flex-col items-center gap-1.5 rounded-xl border border-line bg-white/[0.02] px-2 py-3 text-xs font-medium text-gray-300 transition disabled:opacity-50', ring)}>
                <Icon className={cx('h-5 w-5', text, loading === role && 'animate-pulse')} />{label}
              </button>
            ))}
          </div>
          {isMocked('auth') && (
            <p className="mt-5 text-center text-xs text-gray-600">Mock mode · student123 / faculty123 / admin123</p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
