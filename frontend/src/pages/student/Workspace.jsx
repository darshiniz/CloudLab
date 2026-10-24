import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ChevronDown, ChevronRight, Cpu, File, FileCode2, Folder, HardDrive, Loader2, MemoryStick,
  Play, Square, Terminal as TerminalIcon, Timer, X,
} from 'lucide-react';
import { api, isMocked } from '../../services/api';
import { ENV_STATUS, LIMITS } from '../../constants/enums';
import { useToast } from '../../context/ToastContext';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Button, ResourceBar, StatusBadge } from '../../components/ui';
import ProvisioningStepper from '../../components/labs/ProvisioningStepper';
import InactivityWarning from '../../components/labs/InactivityWarning';
import LabIcon from '../../components/labs/LabIcon';
import Logo from '../../components/layout/Logo';
import { cx, labLabel } from '../../utils/format';

// Placeholder editor content per lab type (the real editor arrives with the workspace URL)
const SAMPLE = {
  python: { file: 'analysis.py', lang: 'python', code: `import pandas as pd\n\n# Dataset is mounted read-only at /data/shared\ndf = pd.read_csv("/data/shared/titanic.csv")\n\nprint(df.shape)\nsurvival = df.groupby("Sex")["Survived"].mean()\nprint(survival.round(2))\n\ndef clean(frame):\n    frame = frame.dropna(subset=["Age"])\n    frame["Fare"] = frame["Fare"].clip(upper=300)\n    return frame\n` },
  java: { file: 'Account.java', lang: 'java', code: `public class Account {\n    private final String id;\n    private double balance;\n\n    public Account(String id) {\n        this.id = id;\n    }\n\n    public void deposit(double amount) {\n        if (amount <= 0) throw new IllegalArgumentException("Amount must be positive");\n        balance += amount;\n    }\n\n    public double getBalance() { return balance; }\n}\n` },
  web: { file: 'app.js', lang: 'javascript', code: `const express = require('express');\nconst app = express();\n\napp.use(express.static('public'));\n\napp.get('/api/hello', (req, res) => {\n  res.json({ message: 'Hello from CloudLab' });\n});\n\napp.listen(3000, () => console.log('Listening on :3000'));\n` },
};
const TREE = {
  python: [{ name: 'src', children: ['analysis.py', 'clean.py'] }, { name: 'notebooks', children: ['explore.ipynb'] }, { name: 'data', children: ['shared → /data/shared', 'mine → /data/mine'] }, 'requirements.txt', 'README.md'],
  java: [{ name: 'src', children: ['Account.java', 'Bank.java', 'Main.java'] }, 'pom.xml', 'README.md'],
  web: [{ name: 'public', children: ['index.html', 'style.css'] }, 'app.js', 'package.json', 'README.md'],
};
const KEYWORDS = /\b(import|from|def|return|print|public|private|final|class|void|double|if|throw|new|const|require|this|true|false|null)\b/g;

function highlight(line) {
  const parts = [];
  let last = 0;
  const re = new RegExp(`(#.*$|//.*$)|("[^"]*"|'[^']*')|${KEYWORDS.source}`, 'g');
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const cls = m[1] ? 'text-gray-500 italic' : m[2] ? 'text-green-300' : 'text-violet-300';
    parts.push(<span key={m.index} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  parts.push(line.slice(last));
  return parts;
}

function useSessionTimer(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  if (!startedAt) return '00:00:00';
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function FakeTerminal({ env }) {
  const [lines, setLines] = useState(() => [
    { t: `Connected to ${env.containerId ?? 'container'} on ${env.workerId ?? 'worker'} · ${env.resources.cpu} vCPU / ${env.resources.memoryGb} GB`, c: 'text-gray-500' },
    { t: 'Type "help" to see demo commands.', c: 'text-gray-500' },
  ]);
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [lines]);
  const RUN = {
    help: 'Commands: ls, pwd, whoami, ls /data/shared, python --version, java -version, node -v, nproc, free -h, clear',
    ls: 'src  notebooks  data  requirements.txt  README.md',
    pwd: '/home/student/project',
    whoami: 'student',
    'ls /data/shared': 'housing.csv  iris.csv  titanic.csv',
    'python --version': 'Python 3.12.4',
    'java -version': 'openjdk version "21.0.3" 2024-04-16',
    'node -v': 'v20.15.0',
    nproc: String(env.resources.cpu),
    'free -h': `Mem:   ${env.resources.memoryGb}.0Gi   used ${Math.round(env.usage.memoryPercent * env.resources.memoryGb) / 100}Gi`,
  };
  const submit = (e) => {
    e.preventDefault();
    const cmd = input.trim();
    setInput('');
    if (cmd === 'clear') return setLines([]);
    setLines((l) => [...l, { t: `$ ${cmd}`, c: 'text-gray-200' }, ...(cmd ? [{ t: RUN[cmd] ?? `${cmd.split(' ')[0]}: command not found (demo terminal)`, c: RUN[cmd] ? 'text-gray-400' : 'text-red-400' }] : [])]);
    return undefined;
  };
  return (
    <div className="flex h-full flex-col font-mono text-[12.5px]">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {lines.map((l, i) => <p key={i} className={cx('whitespace-pre-wrap leading-relaxed', l.c)}>{l.t}</p>)}
        <form onSubmit={submit} className="flex items-center gap-2">
          <span className="text-green-400">student@cloudlab</span><span className="text-gray-500">:~$</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} className="flex-1 bg-transparent text-gray-200 outline-none" aria-label="Terminal input" spellCheck={false} autoComplete="off" />
        </form>
        <div ref={endRef} />
      </div>
    </div>
  );
}

export default function Workspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const env = useQuery(() => api.getEnvironment(id), [id], { interval: LIMITS.pollMs });
  const e = env.data;
  const live = e && [ENV_STATUS.RUNNING, ENV_STATUS.INACTIVE].includes(e.status);
  const metrics = useQuery(() => api.getMetrics(id), [id], { interval: 5000, enabled: !!live });
  const access = useQuery(() => api.getAccess(id), [id, live], { enabled: !!live });
  const [openFolders, setOpenFolders] = useState({ src: true });
  const [termOpen, setTermOpen] = useState(true);
  const timer = useSessionTimer(e?.startedAt);
  const sample = SAMPLE[e?.labType] ?? SAMPLE.python;
  const tree = TREE[e?.labType] ?? TREE.python;
  // With the real backend the workspace URL opens the lab's own IDE (code-server); with mocks we keep the preview.
  const realIde = !isMocked('environments') && access.data?.workspaceUrl;
  const lines = useMemo(() => sample.code.split('\n'), [sample]);

  // Heartbeat every 60 s while this tab is open (contract 7.3)
  useEffect(() => {
    if (!live) return undefined;
    api.heartbeat(id).catch(() => {});
    const t = setInterval(() => { if (!document.hidden) api.heartbeat(id).catch(() => {}); }, LIMITS.heartbeatMs);
    return () => clearInterval(t);
  }, [id, live]);

  useEffect(() => { if (env.error) toast.apiError(env.error); }, [env.error, toast]);

  const stop = () => run('stop', () => api.stopEnvironment(id), { success: 'Lab stopped. Your files are saved.', after: () => navigate('/student/labs') });
  const start = () => run('start', () => api.startEnvironment(id), { success: 'Starting lab…', after: env.refresh });
  const m = metrics.data ?? (e ? { cpuPercent: e.usage.cpuPercent, memoryPercent: e.usage.memoryPercent, diskPercent: 24 } : null);

  if (env.loading) return <div className="flex h-screen items-center justify-center bg-bg"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>;
  if (!e) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg text-center">
        <p className="text-lg text-white">Lab not found</p>
        <Button as={Link} to="/student/labs" variant="secondary" icon={ArrowLeft}>Back to My Labs</Button>
      </div>
    );
  }

  return (
    <div data-role="student" className="flex h-screen flex-col overflow-hidden bg-[#080B15]">
      {/* Top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg px-3 py-2 sm:px-4">
        <Link to="/student/labs" className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white" aria-label="Back to My Labs"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="hidden sm:block"><Logo collapsed to="/student" /></div>
        <div className="flex min-w-0 items-center gap-2.5">
          <LabIcon type={e.labType} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{e.name}</p>
            <p className="font-mono text-[11px] text-gray-500">{e.id} · {labLabel(e.labType)}</p>
          </div>
          <StatusBadge status={e.status} />
        </div>
        <div className="ml-auto flex items-center gap-4">
          {live && (
            <>
              <span className="hidden items-center gap-1.5 font-mono text-sm text-gray-300 md:flex" title="Session time"><Timer className="h-4 w-4 text-gray-500" />{timer}</span>
              <div className="hidden w-64 grid-cols-3 gap-3 lg:grid">
                <ResourceBar label="CPU" icon={Cpu} value={m?.cpuPercent} size="sm" />
                <ResourceBar label="RAM" icon={MemoryStick} value={m?.memoryPercent} size="sm" />
                <ResourceBar label="Disk" icon={HardDrive} value={m?.diskPercent} size="sm" />
              </div>
              <Button size="sm" variant="danger" icon={Square} loading={busy === 'stop'} onClick={stop}>Stop</Button>
            </>
          )}
        </div>
      </header>

      {e.status === ENV_STATUS.INACTIVE && <div className="border-b border-line p-2"><InactivityWarning env={e} onStillHere={() => run('hb', () => api.heartbeat(id, true), { success: 'Timer reset', after: env.refresh })} compact /></div>}

      {!live ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6">
            {e.status === ENV_STATUS.PROVISIONING ? (
              <><p className="mb-4 font-medium text-white">Starting your lab…</p><ProvisioningStepper steps={e.provisioning.steps} /></>
            ) : e.status === ENV_STATUS.QUEUED ? (
              <p className="text-yellow-200">All servers are at capacity. You are #{e.queuePosition} in the queue.</p>
            ) : (
              <div className="text-center">
                <p className="text-white">This lab is <StatusBadge status={e.status} /></p>
                {e.failureReason && <p className="mt-3 text-sm text-red-300">{e.failureReason}</p>}
                {e.status === ENV_STATUS.STOPPED && <Button className="mt-5" icon={Play} loading={busy === 'start'} onClick={start}>Start lab</Button>}
                {e.status === ENV_STATUS.FAILED && <Button className="mt-5" onClick={() => run('restart', () => api.restartEnvironment(id), { after: env.refresh })}>Retry</Button>}
              </div>
            )}
          </div>
        </div>
      ) : realIde ? (
        <iframe title={`${e.name} workspace`} src={access.data.workspaceUrl} className="min-h-0 w-full flex-1 border-0 bg-[#1e1e1e]" allow="clipboard-read; clipboard-write" />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Explorer */}
          <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-bg/60 py-3 md:block">
            <p className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Explorer</p>
            <ul className="text-[13px]">
              {tree.map((node) => typeof node === 'string' ? (
                <li key={node} className={cx('flex cursor-default items-center gap-2 px-4 py-1 text-gray-400 hover:bg-white/[0.03]')}><File className="h-3.5 w-3.5" />{node}</li>
              ) : (
                <li key={node.name}>
                  <button onClick={() => setOpenFolders((o) => ({ ...o, [node.name]: !o[node.name] }))} className="flex w-full items-center gap-1.5 px-3 py-1 text-gray-300 hover:bg-white/[0.03]">
                    {openFolders[node.name] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}<Folder className="h-3.5 w-3.5 text-accent" />{node.name}
                  </button>
                  {openFolders[node.name] && (
                    <ul>{node.children.map((c) => (
                      <li key={c} className={cx('flex items-center gap-2 py-1 pl-10 pr-3', c === sample.file ? 'bg-accent/10 text-white' : 'text-gray-400 hover:bg-white/[0.03]')}><FileCode2 className="h-3.5 w-3.5" />{c}</li>
                    ))}</ul>
                  )}
                </li>
              ))}
            </ul>
          </aside>

          {/* Editor + terminal */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center border-b border-line bg-bg/60 text-[13px]">
              <span className="flex items-center gap-2 border-r border-line border-t-2 border-t-accent bg-[#080B15] px-4 py-2 text-gray-200"><FileCode2 className="h-3.5 w-3.5 text-accent" />{sample.file}<X className="h-3 w-3 text-gray-600" /></span>
              {access.data && <span className="ml-auto hidden truncate px-4 font-mono text-[11px] text-gray-600 lg:block" title="Workspace URL from GET /environments/:id/access">{access.data.workspaceUrl}</span>}
            </div>
            <div className="relative min-h-0 flex-1 overflow-auto">
              <pre className="py-3 font-mono text-[13px] leading-6">
                {lines.map((l, i) => (
                  <div key={i} className="flex hover:bg-white/[0.02]">
                    <span className="w-12 shrink-0 select-none pr-4 text-right text-gray-600">{i + 1}</span>
                    <code className="whitespace-pre text-gray-300">{highlight(l)}</code>
                  </div>
                ))}
              </pre>
              <span className="pointer-events-none absolute bottom-3 right-4 rounded-lg border border-line bg-card/90 px-3 py-1.5 text-[11px] text-gray-500">Editor preview · live editor loads from the workspace URL</span>
            </div>
            <motion.div animate={{ height: termOpen ? 220 : 36 }} transition={{ duration: 0.25 }} className="shrink-0 overflow-hidden border-t border-line bg-[#060911]">
              <button onClick={() => setTermOpen((o) => !o)} className="flex h-9 w-full items-center gap-2 border-b border-line px-4 text-xs font-medium uppercase tracking-wider text-gray-400 hover:text-white">
                <TerminalIcon className="h-3.5 w-3.5" />Terminal{termOpen ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
              </button>
              <div className="h-[184px]"><FakeTerminal env={e} /></div>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}
