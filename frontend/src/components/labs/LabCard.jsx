import { motion } from 'framer-motion';
import { Cpu, HardDrive, MemoryStick, Plus, Sparkles } from 'lucide-react';
import { Button, Chip, staggerItem } from '../ui';
import LabIcon from './LabIcon';
import { cx } from '../../utils/format';

/** A lab template in the catalog. comingSoon → disabled. `actionLabel` lets faculty/admin reuse it. */
export default function LabCard({ lab, onCreate, actionLabel = 'Create Lab', action, compact = false }) {
  const soon = lab.comingSoon;
  return (
    <motion.article
      variants={staggerItem}
      whileHover={soon ? undefined : { y: -4 }}
      className={cx('relative flex flex-col rounded-2xl border border-line bg-card/80 p-5 backdrop-blur-sm transition-shadow duration-300',
        soon ? 'opacity-60' : 'hover:shadow-glow-accent', !lab.enabled && 'opacity-50')}
    >
      {soon && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30">
          <Sparkles className="h-3 w-3" />Coming soon
        </span>
      )}
      <LabIcon type={lab.type} size="lg" />
      <h3 className="mt-4 text-base font-semibold text-white">{lab.name}</h3>
      <p className="mt-1 text-sm text-gray-400">{lab.description}</p>
      {!compact && (
        <div className="mt-4 flex flex-wrap gap-1.5">{lab.tools.map((t) => <Chip key={t}>{t}</Chip>)}</div>
      )}
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-line bg-white/[0.02] p-3 text-center">
        {[[Cpu, `1–${lab.limits.cpu} vCPU`], [MemoryStick, `1–${lab.limits.memoryGb} GB`], [HardDrive, `${lab.limits.storageGb} GB`]].map(([Icon, v]) => (
          <div key={v}>
            <Icon className="mx-auto h-4 w-4 text-gray-500" />
            <dd className="mt-1 font-mono text-xs text-gray-300">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex-1" />
      {action ?? (onCreate && (
        <Button icon={soon ? undefined : Plus} disabled={soon || !lab.enabled} onClick={() => onCreate(lab)} className="w-full">
          {soon ? 'Coming soon' : actionLabel}
        </Button>
      ))}
    </motion.article>
  );
}
