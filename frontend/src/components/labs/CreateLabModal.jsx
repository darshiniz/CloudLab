import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Cpu, ExternalLink, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '../../services/api';
import { ENV_STATUS, LIMITS, PROVISIONING_STEPS, SIZE, SIZE_RESOURCES } from '../../constants/enums';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input, Modal, Select, StatusBadge } from '../ui';
import ProvisioningStepper from './ProvisioningStepper';
import LabIcon from './LabIcon';
import { cx } from '../../utils/format';

const DURATIONS = [30, 60, 90, 120, 180, 240];

/**
 * Create Lab flow (contract section 9):
 *  form → POST /environments (202) → poll GET /environments/:id every 2 s → running | failed | queued
 */
export default function CreateLabModal({ open, onClose, labs = [], initialLab, onCreated }) {
  const toast = useToast();
  const navigate = useNavigate();
  const available = useMemo(() => labs.filter((l) => l.enabled && !l.comingSoon), [labs]);
  const [labId, setLabId] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState(SIZE.SMALL);
  const [duration, setDuration] = useState(120);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [env, setEnv] = useState(null);

  // Reset each time the modal opens
  useEffect(() => {
    if (!open) return;
    setLabId(initialLab?.id ?? available[0]?.id ?? '');
    setName(''); setSize(SIZE.SMALL); setDuration(120); setErrors({}); setEnv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Poll every 2 s until the status settles
  useEffect(() => {
    if (!env?.id || ![ENV_STATUS.PROVISIONING, ENV_STATUS.QUEUED, ENV_STATUS.REQUESTED].includes(env.status)) return undefined;
    const id = setTimeout(async () => {
      try { setEnv(await api.getEnvironment(env.id)); } catch (err) { toast.apiError(err); }
    }, LIMITS.pollMs);
    return () => clearTimeout(id);
  }, [env, toast]);

  useEffect(() => {
    if (env?.status === ENV_STATUS.RUNNING) onCreated?.(env);
  }, [env?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = () => {
    const e = {};
    const n = name.trim();
    if (!labId) e.labId = 'Choose a lab';
    if (n.length < LIMITS.envNameMin || n.length > LIMITS.envNameMax) e.name = `Name must be ${LIMITS.envNameMin}–${LIMITS.envNameMax} characters`;
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    // Show the "Requested" state until the backend answers with provisioning or queued (contract §9 step 1)
    setEnv({ id: null, name: name.trim(), labId, size, status: ENV_STATUS.REQUESTED, provisioning: { currentStep: 0, steps: PROVISIONING_STEPS.map((s) => ({ ...s, state: 'pending' })) } });
    try {
      const created = await api.createEnvironment({ labId, name: name.trim(), size, durationMinutes: duration });
      setEnv(created);
      onCreated?.(created);
    } catch (err) {
      setEnv(null);
      if (err.code === 'VALIDATION_ERROR') setErrors(err.details);
      toast.apiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    try { setEnv(await api.restartEnvironment(env.id)); } catch (err) { toast.apiError(err); }
  };

  const lab = labs.find((l) => l.id === (env?.labId ?? labId));
  const status = env?.status;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={env ? env.name : 'Create a new lab'}
      description={env ? `${lab?.name ?? ''} · ${env.size === 'small' ? '1 vCPU / 1 GB' : '2 vCPU / 2 GB'}` : 'Pick a size and we will provision an isolated container for you.'}
      footer={!env ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="create-lab" loading={submitting}>Create lab</Button>
        </>
      ) : status === ENV_STATUS.RUNNING ? (
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button icon={ExternalLink} onClick={() => { onClose(); navigate(`/student/workspace/${env.id}`); }}>Open workspace</Button>
        </>
      ) : status === ENV_STATUS.FAILED ? (
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button icon={RotateCcw} onClick={retry}>Retry</Button>
        </>
      ) : (
        <Button variant="secondary" onClick={onClose}>Run in background</Button>
      )}
    >
      {!env ? (
        <form id="create-lab" onSubmit={submit} className="space-y-5" noValidate>
          {!initialLab ? (
            <Field label="Lab template" htmlFor="labId" error={errors.labId}>
              <Select id="labId" value={labId} onChange={(e) => setLabId(e.target.value)} invalid={!!errors.labId}>
                {available.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3">
              <LabIcon type={initialLab.type} />
              <div><p className="text-sm font-medium text-white">{initialLab.name}</p><p className="text-xs text-gray-500">{initialLab.tools.join(' · ')}</p></div>
            </div>
          )}

          <Field label="Lab name" htmlFor="labName" error={errors.name} hint="3 to 40 characters, e.g. Pandas Practical 4">
            <Input id="labName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pandas Practical 4" invalid={!!errors.name} maxLength={40} autoFocus />
          </Field>

          <Field label="Resource size" error={errors.size}>
            <div className="grid grid-cols-2 gap-3" role="radiogroup">
              {Object.values(SIZE).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={size === s} onClick={() => setSize(s)}
                  className={cx('rounded-xl border p-4 text-left transition', size === s ? 'border-accent bg-accent/10 shadow-glow-accent' : 'border-line hover:border-white/20')}>
                  <div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-accent" /><span className="text-sm font-semibold capitalize text-white">{s}</span></div>
                  <p className="mt-1 font-mono text-xs text-gray-400">{SIZE_RESOURCES[s].cpu} vCPU / {SIZE_RESOURCES[s].memoryGb} GB RAM</p>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Requested duration" htmlFor="duration" error={errors.durationMinutes} hint="Labs also auto-stop after 30 minutes of inactivity.">
            <Select id="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} minutes` : `${d / 60} hour${d > 60 ? 's' : ''}`}</option>)}
            </Select>
          </Field>
          <p className="text-xs text-gray-500">Tip for the demo: put the word “fail” in the name to see the failed state.</p>
        </form>
      ) : (
        <div className="space-y-5">
          {status === ENV_STATUS.QUEUED && (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
                <div>
                  <p className="font-medium text-yellow-100">All servers are at capacity. You are #{env.queuePosition} in the queue.</p>
                  <p className="mt-1 text-sm text-yellow-200/70">Your lab starts automatically when a slot frees up. You can close this window.</p>
                </div>
              </div>
            </motion.div>
          )}
          {status === ENV_STATUS.FAILED && (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
                <div><p className="font-medium text-red-100">Provisioning failed</p><p className="mt-1 text-sm text-red-200/70">{env.failureReason}</p></div>
              </div>
            </motion.div>
          )}
          {status === ENV_STATUS.RUNNING && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-4">
              <CheckCircle2 className="h-6 w-6 text-green-300" />
              <div className="flex-1"><p className="font-medium text-green-100">Your lab is ready</p><p className="text-sm text-green-200/70">Container {env.containerId} on {env.workerId}</p></div>
              <StatusBadge status="running" />
            </motion.div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-300">Provisioning</p>
            <div className="flex items-center gap-2">
              {status === ENV_STATUS.REQUESTED && <span className="text-xs text-gray-500">Sending request…</span>}
              {status === ENV_STATUS.PROVISIONING && <span className="flex items-center gap-1 text-xs text-gray-500"><Clock className="h-3.5 w-3.5" />usually under 10 s</span>}
              <StatusBadge status={status} />
            </div>
          </div>
          <ProvisioningStepper steps={env.provisioning.steps} />
        </div>
      )}
    </Modal>
  );
}
