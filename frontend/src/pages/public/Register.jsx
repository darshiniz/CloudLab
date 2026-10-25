import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Hash, Lock, Mail, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../services/api';
import { Button, Field, Input } from '../../components/ui';
import Logo from '../../components/layout/Logo';

const EMPTY = { name: '', email: '', rollNo: '', password: '', confirm: '' };

/** Student self-registration (BRD FR-15). The account stays Pending until an administrator approves it. */
export default function Register() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  if (user) return <Navigate to={`/${user.role}`} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (form.name.trim().length < 2) e.name = 'Enter your full name';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = 'Enter your institute email address';
    if (!form.rollNo.trim()) e.rollNo = 'Enter your roll number';
    if (form.password.length < 8) e.password = 'At least 8 characters';
    if (form.confirm !== form.password) e.confirm = 'Passwords do not match';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await api.register({ name: form.name.trim(), email: form.email.trim(), rollNo: form.rollNo.trim(), password: form.password });
      setDone(true);
    } catch (err) {
      setErrors(err.code === 'EMAIL_EXISTS' ? { email: 'This email is already registered' } : err.details ?? {});
      toast.apiError(err, 'Could not register');
    } finally { setSaving(false); }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="pointer-events-none absolute inset-0 glow-radial" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="glass relative w-full max-w-md rounded-3xl p-8 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <Link to="/login" className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"><ArrowLeft className="h-3.5 w-3.5" />Sign in</Link>
        </div>
        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-status-running" />
            <h1 className="mt-4 text-2xl font-bold">Registration received</h1>
            <p className="mt-2 text-sm text-gray-400">An administrator will review your request. You can sign in as soon as it is approved.</p>
            <Button as={Link} to="/login" className="mt-6 w-full" size="lg">Back to sign in</Button>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Create your account</h1>
            <p className="mt-1 text-sm text-gray-400">Use your institute email. An administrator approves new accounts.</p>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field label="Full name" htmlFor="r-name" error={errors.name}><Input id="r-name" icon={User} autoComplete="name" value={form.name} onChange={set('name')} invalid={!!errors.name} /></Field>
              <Field label="Institute email" htmlFor="r-email" error={errors.email}><Input id="r-email" type="email" icon={Mail} autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@gbs.edu" invalid={!!errors.email} /></Field>
              <Field label="Roll number" htmlFor="r-roll" error={errors.rollNo}><Input id="r-roll" icon={Hash} value={form.rollNo} onChange={set('rollNo')} placeholder="25P0320023" invalid={!!errors.rollNo} /></Field>
              <Field label="Password" htmlFor="r-pass" error={errors.password} hint="At least 8 characters"><Input id="r-pass" type="password" icon={Lock} autoComplete="new-password" value={form.password} onChange={set('password')} invalid={!!errors.password} /></Field>
              <Field label="Confirm password" htmlFor="r-conf" error={errors.confirm}><Input id="r-conf" type="password" icon={Lock} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} invalid={!!errors.confirm} /></Field>
              <Button type="submit" className="w-full" size="lg" loading={saving}>Request account</Button>
            </form>
            <p className="mt-5 text-center text-sm text-gray-500">Already approved? <Link to="/login" className="text-accent hover:underline">Sign in</Link></p>
          </>
        )}
      </motion.div>
    </div>
  );
}
