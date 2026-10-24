import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { StatusBadge } from '../ui';

const COMMAND = 'cloudlab create python-lab';
const OUTPUT = [
  { text: '✓ Request validated', delay: 300 },
  { text: '✓ Worker VM 2 selected (asia-south1)', delay: 400 },
  { text: '✓ Template cloudlab/python:1.0', delay: 350 },
  { text: 'Container provisioned, 1 vCPU, 2 GB RAM, 5 GB storage', delay: 500, highlight: true },
];

/** Types "cloudlab create python-lab", prints the result, then shows a Running badge. Loops. */
export default function AnimatedTerminal({ className = '' }) {
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(reduce ? COMMAND.length : 0);
  const [lines, setLines] = useState(reduce ? OUTPUT.length : 0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (reduce) return undefined;
    setTyped(0); setLines(0);
    const timers = [];
    let t = 500;
    for (let i = 1; i <= COMMAND.length; i++) { t += 55; timers.push(setTimeout(() => setTyped(i), t)); }
    t += 400;
    OUTPUT.forEach((o, i) => { t += o.delay; timers.push(setTimeout(() => setLines(i + 1), t)); });
    timers.push(setTimeout(() => setCycle((c) => c + 1), t + 4500));
    return () => timers.forEach(clearTimeout);
  }, [cycle, reduce]);

  return (
    <div className={`overflow-hidden rounded-2xl border border-line bg-[#0B1020]/90 shadow-2xl shadow-brand-from/10 backdrop-blur ${className}`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-500/70" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <span className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 font-mono text-xs text-gray-500">student@cloudlab: ~</span>
      </div>
      <div className="min-h-[220px] space-y-2 p-5 font-mono text-[13px] leading-relaxed">
        <p className="text-gray-200">
          <span className="text-brand-from">$</span> {COMMAND.slice(0, typed)}
          {typed < COMMAND.length && <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-gray-300" />}
        </p>
        {OUTPUT.slice(0, lines).map((o) => (
          <motion.p key={o.text} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={o.highlight ? 'text-white' : 'text-gray-400'}>
            {o.highlight ? <span className="text-green-400">➜ </span> : null}{o.text}
          </motion.p>
        ))}
        {lines === OUTPUT.length && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 pt-2">
            <StatusBadge status="running" />
            <span className="text-xs text-gray-500">env_5012 · ready in 8.4 s</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
