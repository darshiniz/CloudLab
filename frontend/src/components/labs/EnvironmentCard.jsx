import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, Cpu, ExternalLink, MemoryStick, Play, RotateCcw, Square, Trash2, Hourglass } from 'lucide-react';
import { ENV_STATUS } from '../../constants/enums';
import { Button, ResourceBar, StatusBadge, staggerItem } from '../ui';
import LabIcon from './LabIcon';
import ProvisioningStepper from './ProvisioningStepper';
import InactivityWarning from './InactivityWarning';
import { labLabel, timeAgo } from '../../utils/format';

/** One environment in My Labs, with the actions allowed for its status (contract 7.3). */
export default function EnvironmentCard({ env, busy, onAction, onStillHere }) {
  const navigate = useNavigate();
  const s = env.status;
  const live = s === ENV_STATUS.RUNNING || s === ENV_STATUS.INACTIVE;
  const isBusy = (a) => busy === `${env.id}:${a}`;
  const act = (a) => onAction(env, a);

  return (
    <motion.article variants={staggerItem} layout className="flex flex-col gap-4 rounded-2xl border border-line bg-card/80 p-5 backdrop-blur-sm transition-shadow duration-300 hover:shadow-glow-accent">
      <div className="flex items-start gap-3">
        <LabIcon type={env.labType} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-white">{env.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {labLabel(env.labType)} · <span className="capitalize">{env.size}</span> · created {timeAgo(env.createdAt)}
          </p>
        </div>
        <StatusBadge status={s} />
      </div>

      {s === ENV_STATUS.INACTIVE && <InactivityWarning env={env} onStillHere={() => onStillHere(env)} compact />}

      {s === ENV_STATUS.PROVISIONING && <ProvisioningStepper steps={env.provisioning.steps} compact />}

      {s === ENV_STATUS.QUEUED && (
        <div className="flex items-center gap-2 rounded-xl border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
          <Hourglass className="h-4 w-4" />All servers are at capacity. You are #{env.queuePosition} in the queue.
        </div>
      )}

      {s === ENV_STATUS.FAILED && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{env.failureReason}</p>
      )}

      {(live || s === ENV_STATUS.STOPPED) && (
        <div className="grid grid-cols-2 gap-4">
          <ResourceBar label="CPU" icon={Cpu} value={env.usage.cpuPercent} />
          <ResourceBar label="RAM" icon={MemoryStick} value={env.usage.memoryPercent} />
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-gray-500"><Clock className="h-3.5 w-3.5" />{s === ENV_STATUS.TERMINATED ? `Deleted ${timeAgo(env.stoppedAt)} · container removed, project files kept` : `Last activity ${timeAgo(env.lastActivityAt)}`}</p>

      {s !== ENV_STATUS.TERMINATED && <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {live && <Button size="sm" icon={ExternalLink} onClick={() => navigate(`/student/workspace/${env.id}`)}>Open</Button>}
        {live && <Button size="sm" variant="secondary" icon={Square} loading={isBusy('stop')} onClick={() => act('stop')}>Stop</Button>}
        {s === ENV_STATUS.STOPPED && <Button size="sm" variant="success" icon={Play} loading={isBusy('start')} onClick={() => act('start')}>Start</Button>}
        {(live || s === ENV_STATUS.STOPPED) && <Button size="sm" variant="secondary" icon={RotateCcw} loading={isBusy('restart')} onClick={() => act('restart')}>Restart</Button>}
        {s === ENV_STATUS.FAILED && <Button size="sm" icon={RotateCcw} loading={isBusy('restart')} onClick={() => act('restart')}>Retry</Button>}
        {s !== ENV_STATUS.PROVISIONING && (
          <Button size="sm" variant="danger" icon={Trash2} loading={isBusy('delete')} onClick={() => act('delete')} className="ml-auto">
            {s === ENV_STATUS.QUEUED ? 'Cancel' : 'Delete'}
          </Button>
        )}
      </div>}
    </motion.article>
  );
}
