import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import {
  Activity, ArrowRight, BookOpen, Box, CheckCircle2, Cloud, Container, Cpu, Database, HardDrive,
  KeyRound, Layers, Lock, Menu, MonitorSmartphone, Power, ServerCog, ShieldCheck, TerminalSquare,
  Timer, User, Workflow, X, XCircle,
} from 'lucide-react';
import Logo from '../../components/layout/Logo';
import AnimatedTerminal from '../../components/landing/AnimatedTerminal';
import LabCard from '../../components/labs/LabCard';
import { Button, FadeUp, ResourceBar, StatusBadge, Stagger } from '../../components/ui';
import { labs } from '../../mocks/data/labs';
import useCountUp from '../../hooks/useCountUp';
import { cx } from '../../utils/format';

const NAV = [['Features', '#features'], ['How it works', '#how'], ['Labs', '#labs'], ['Roles', '#roles']];

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-content items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map(([l, h]) => <a key={h} href={h} className="text-sm text-gray-400 transition hover:text-white">{l}</a>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button as={Link} to="/login" variant="ghost">Log in</Button>
          <Button as={Link} to="/login">Get started</Button>
        </div>
        <button className="rounded-lg p-2 text-gray-300 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-t border-line md:hidden">
            <div className="space-y-1 px-4 py-3">
              {NAV.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-white/5">{l}</a>)}
              <div className="flex gap-2 pt-2"><Button as={Link} to="/login" variant="secondary" className="flex-1">Log in</Button><Button as={Link} to="/login" className="flex-1">Get started</Button></div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function Section({ id, eyebrow, title, subtitle, children, className }) {
  return (
    <section id={id} className={cx('scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24', className)}>
      <div className="mx-auto max-w-content">
        {(eyebrow || title) && (
          <FadeUp className="mx-auto mb-12 max-w-2xl text-center">
            {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-from">{eyebrow}</p>}
            {title && <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>}
            {subtitle && <p className="mt-4 text-gray-400">{subtitle}</p>}
          </FadeUp>
        )}
        {children}
      </div>
    </section>
  );
}

// ── 2. Hero ──
function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-20 pt-32 sm:px-6 sm:pt-40">
      <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      <div className="glow-radial pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-content items-center gap-12 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs text-gray-300">
            <span className="h-1.5 w-1.5 rounded-full bg-status-running" />On-demand labs on Google Cloud
          </span>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            <span className="text-gradient">Provision.</span><br /><span className="text-gradient">Develop.</span><br /><span className="text-gradient">Learn.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-gray-400">Launch pre-configured cloud labs in seconds. No installs, no setup.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button as={Link} to="/login" size="lg" icon={ArrowRight}>Get started</Button>
            <Button as="a" href="#how" size="lg" variant="secondary">How it works</Button>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}>
          <AnimatedTerminal />
        </motion.div>
      </div>
    </section>
  );
}

// ── 3. Problem vs solution ──
function ProblemSolution() {
  const bad = ['Manual installs on every machine', 'Inconsistent environments', 'Admin overhead for every reset', 'Wasted resources when idle'];
  const good = ['One-click lab creation', 'Isolated container per student', 'Standardized templates', 'Auto-shutdown of idle labs'];
  return (
    <Section eyebrow="Why CloudLab" title="From “install it everywhere” to “provision it when needed”">
      <div className="grid gap-6 md:grid-cols-2">
        <FadeUp className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-7">
          <h3 className="text-lg font-semibold text-red-200">Traditional labs</h3>
          <ul className="mt-5 space-y-3">{bad.map((b) => <li key={b} className="flex items-center gap-3 text-sm text-red-100/70"><XCircle className="h-4 w-4 shrink-0 text-red-400" />{b}</li>)}</ul>
        </FadeUp>
        <FadeUp delay={0.1} className="rounded-2xl border border-green-500/20 bg-green-500/[0.04] p-7">
          <h3 className="text-lg font-semibold text-green-200">CloudLab</h3>
          <ul className="mt-5 space-y-3">{good.map((g) => <li key={g} className="flex items-center gap-3 text-sm text-green-100/80"><CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />{g}</li>)}</ul>
        </FadeUp>
      </div>
    </Section>
  );
}

// ── 4. How it works ──
function HowItWorks() {
  const steps = [[User, 'Student', 'Clicks “Create Lab”'], [MonitorSmartphone, 'Web App', 'React dashboard'], [KeyRound, 'Auth', 'JWT + role check'], [Workflow, 'Provisioning Engine', 'Picks a worker'], [Container, 'Docker Container', 'Isolated, limited']];
  return (
    <Section id="how" eyebrow="How it works" title="Five steps, under ten seconds" className="bg-white/[0.01]">
      <div className="relative">
        <div className="absolute left-[10%] right-[10%] top-8 hidden h-px bg-white/10 md:block">
          <motion.div className="h-full origin-left bg-brand-gradient" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 1.6, ease: 'easeInOut' }} />
        </div>
        <ol className="relative grid gap-8 md:grid-cols-5">
          {steps.map(([Icon, t, d], i) => (
            <FadeUp key={t} delay={i * 0.15} as="li" className="flex flex-col items-center text-center">
              <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-card shadow-glow">
                <Icon className="h-7 w-7 text-brand-from" />
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient font-mono text-xs font-bold text-white">{i + 1}</span>
              </span>
              <h3 className="mt-4 text-sm font-semibold">{t}</h3>
              <p className="mt-1 text-xs text-gray-500">{d}</p>
            </FadeUp>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ── 5. Lab catalog preview ──
function Catalog() {
  return (
    <Section id="labs" eyebrow="Lab catalog" title="Ready-made environments for every subject" subtitle="Three labs are live. Two more are on the way.">
      <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {labs.map((l) => <LabCard key={l.id} lab={l} action={l.comingSoon ? <Button variant="secondary" size="sm" disabled className="w-full">Coming soon</Button> : <Button as={Link} to="/login" size="sm" className="w-full">Launch</Button>} />)}
      </Stagger>
    </Section>
  );
}

// ── 6. Features ──
function Features() {
  const items = [
    [Box, 'Isolated containers', 'One Docker container per student. Code never touches another student’s lab.'],
    [Cpu, 'Controlled resources', 'CPU, memory and storage are capped per lab, so one heavy job can’t starve the rest.'],
    [HardDrive, 'Persistent project storage', 'Files live on persistent disk and Cloud Storage. They survive when a container is deleted.'],
    [Power, 'Auto-shutdown of inactive labs', 'Idle labs stop themselves after 30 minutes, saving cloud cost.'],
    [Activity, 'Live monitoring', 'Admins watch CPU, memory and capacity across every worker VM in real time.'],
    [ShieldCheck, 'Role-based access', 'Students, faculty and admins each see exactly what they need, enforced by JWT.'],
  ];
  return (
    <Section id="features" eyebrow="Features" title="Everything a college lab needs" className="bg-white/[0.01]">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([Icon, t, d], i) => (
          <FadeUp key={t} delay={(i % 3) * 0.08}>
            <motion.div whileHover={{ y: -4 }} className="h-full rounded-2xl border border-line bg-card/70 p-6 transition-shadow duration-300 hover:shadow-glow">
              <span className="inline-flex rounded-xl bg-brand-from/10 p-3 text-brand-from ring-1 ring-inset ring-brand-from/20"><Icon className="h-5 w-5" /></span>
              <h3 className="mt-4 font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-gray-400">{d}</p>
            </motion.div>
          </FadeUp>
        ))}
      </div>
    </Section>
  );
}

// ── 7. Roles ──
function MiniDash({ role }) {
  const color = { student: '#3B82F6', faculty: '#14B8A6', admin: '#8B5CF6' }[role];
  return (
    <div className="rounded-2xl border border-line bg-[#0C1120] p-4 shadow-2xl" style={{ '--accent': { student: '59 130 246', faculty: '20 184 166', admin: '139 92 246' }[role] }} aria-hidden="true">
      <div className="mb-4 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: color }} /><span className="h-2 w-24 rounded bg-white/10" /><span className="ml-auto h-5 w-5 rounded-full bg-white/10" /></div>
      <div className="flex gap-3">
        <div className="hidden w-20 space-y-2 sm:block">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-2.5 rounded" style={{ background: i === 1 ? `${color}66` : 'rgba(255,255,255,.06)' }} />)}</div>
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-3 gap-2">{[64, 38, 12].map((v) => <div key={v} className="rounded-lg border border-line bg-card p-2"><div className="h-1.5 w-8 rounded bg-white/10" /><div className="mt-2 font-mono text-sm font-bold text-white">{v}</div></div>)}</div>
          <div className="rounded-lg border border-line bg-card p-3">
            <svg viewBox="0 0 200 50" className="h-12 w-full"><path d="M0,40 C20,35 30,20 50,24 S80,40 100,28 S140,8 160,16 S190,30 200,12" fill="none" stroke={color} strokeWidth="2" /></svg>
          </div>
          <div className="space-y-2 rounded-lg border border-line bg-card p-3">
            {role === 'admin' ? (<><ResourceBar label="Worker VM 1" value={4} max={4} display="4/4" size="sm" /><ResourceBar label="Worker VM 2" value={3} max={4} display="3/4" size="sm" /></>)
              : role === 'faculty' ? (<div className="flex items-center justify-between text-xs"><span className="text-gray-400">Pandas basics</span><StatusBadge status="inProgress" /></div>)
              : (<div className="flex items-center justify-between text-xs"><span className="text-gray-400">Pandas Practical 3</span><StatusBadge status="running" /></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Roles() {
  const [tab, setTab] = useState('student');
  const ROLES = {
    student: { icon: TerminalSquare, color: 'text-role-student', items: ['Launch Python, Java or Web labs in one click', 'Projects and files saved across sessions', 'Shared datasets mounted at /data in every lab'] },
    faculty: { icon: BookOpen, color: 'text-role-faculty', items: ['See which students are working right now', 'Assign lab activities with due dates and datasets', 'Monitor usage per student and per lab'] },
    admin: { icon: ShieldCheck, color: 'text-role-admin', items: ['Watch both worker VMs and the queue live', 'Manage users, templates and the inactivity policy', 'Usage analytics with CSV export'] },
  };
  const R = ROLES[tab];
  return (
    <Section id="roles" eyebrow="Roles" title="Built around the classroom">
      <div className="mb-10 flex justify-center">
        <div className="inline-flex rounded-xl border border-line bg-white/[0.03] p-1" role="tablist">
          {Object.keys(ROLES).map((r) => (
            <button key={r} role="tab" aria-selected={tab === r} onClick={() => setTab(r)} className={cx('relative rounded-lg px-5 py-2 text-sm font-medium capitalize transition', tab === r ? 'text-white' : 'text-gray-400 hover:text-gray-200')}>
              {tab === r && <motion.span layoutId="role-tab" className="absolute inset-0 rounded-lg bg-white/10" />}
              <span className="relative">{r}</span>
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <R.icon className={cx('h-10 w-10', R.color)} />
            <h3 className="mt-4 text-2xl font-bold capitalize">For {tab}s</h3>
            <ul className="mt-6 space-y-4">{R.items.map((i) => <li key={i} className="flex items-start gap-3 text-gray-300"><CheckCircle2 className={cx('mt-0.5 h-5 w-5 shrink-0', R.color)} />{i}</li>)}</ul>
          </div>
          <MiniDash role={tab} />
        </motion.div>
      </AnimatePresence>
    </Section>
  );
}

// ── 8. Architecture ──
function Architecture() {
  const layers = [
    [MonitorSmartphone, 'Web App', 'React + Vite, served by Nginx over HTTPS'],
    [Lock, 'Auth', 'JWT with role claims, checked on every call'],
    [Layers, 'API Layer', 'Node.js / Express on the Control VM'],
    [Workflow, 'Provisioning Engine', 'Scheduler picks a worker with free slots'],
    [ServerCog, 'Docker on 2 Worker VMs', 'e2-medium × 2, ~4 labs each, private network'],
    [Database, 'Cloud Storage', 'datasets/ (shared) and students/ (private)'],
  ];
  return (
    <Section eyebrow="Architecture" title="Two-VM design on Google Cloud" subtitle="A public control plane, private workers for untrusted student code, and managed storage." className="bg-white/[0.01]">
      <div className="mx-auto max-w-3xl space-y-3">
        {layers.map(([Icon, t, d], i) => (
          <motion.div key={t} initial={{ opacity: 0, x: i % 2 ? 30 : -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.45, delay: i * 0.08 }}
            className="flex items-center gap-4 rounded-2xl border border-line bg-card/70 p-4" style={{ marginLeft: `${i * 2}%`, marginRight: `${(layers.length - 1 - i) * 2}%` }}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gradient"><Icon className="h-5 w-5 text-white" /></span>
            <div className="min-w-0"><h3 className="text-sm font-semibold">{t}</h3><p className="truncate text-xs text-gray-500 sm:whitespace-normal">{d}</p></div>
            <span className="ml-auto font-mono text-xs text-gray-600">L{i + 1}</span>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ── 9. Stats ──
function Stat({ value, prefix = '', suffix, label }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const n = useCountUp(inView ? value : 0, 1400);
  return (
    <FadeUp className="text-center">
      <span ref={ref} />
      <p className="text-4xl font-extrabold text-gradient sm:text-5xl">{prefix}{Math.round(n)}{suffix}</p>
      <p className="mt-2 text-sm text-gray-400">{label}</p>
    </FadeUp>
  );
}
function Stats() {
  return (
    <Section>
      <div className="grid gap-10 rounded-3xl border border-line bg-card/60 p-10 sm:grid-cols-2 lg:grid-cols-4">
        <Stat prefix="<" value={10} suffix="s" label="Labs ready in under 10 seconds" />
        <Stat value={100} suffix="%" label="Isolated, one container each" />
        <Stat value={5} suffix=" GB" label="Storage per student" />
        <Stat value={30} suffix=" min" label="Auto-stop saves cloud cost" />
      </div>
    </Section>
  );
}

// ── 10. CTA + footer ──
function Cta() {
  return (
    <Section>
      <FadeUp className="relative overflow-hidden rounded-3xl border border-line bg-card p-10 text-center sm:p-16">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-30 blur-3xl" />
        <Cloud className="relative mx-auto h-10 w-10 text-brand-from" />
        <h2 className="relative mt-4 text-3xl font-bold sm:text-4xl">Your lab is one click away</h2>
        <p className="relative mx-auto mt-3 max-w-md text-gray-400">Log in with your college account and start coding in seconds.</p>
        <Button as={Link} to="/login" size="lg" icon={ArrowRight} className="relative mt-8">Get started</Button>
      </FadeUp>
    </Section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <main>
        <Hero />
        <ProblemSolution />
        <HowItWorks />
        <Catalog />
        <Features />
        <Roles />
        <Architecture />
        <Stats />
        <Cta />
      </main>
      <footer className="border-t border-line px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-4 text-sm text-gray-500 sm:flex-row">
          <Logo />
          <p>Goa Business School, MCA Cloud Computing Project</p>
          <p>Anushka Marcelo · Darshini Zoraunkar</p>
        </div>
      </footer>
    </div>
  );
}
