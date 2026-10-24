import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);
const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const COLORS = { success: 'text-status-running', error: 'text-status-failed', warning: 'text-status-inactive', info: 'text-brand-from' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((type, title, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, type, title, ...opts }]);
    setTimeout(() => dismiss(id), opts.duration ?? (type === 'error' ? 7000 : 4000));
  }, [dismiss]);

  const toast = useMemo(() => ({
    success: (title, o) => push('success', title, o),
    info: (title, o) => push('info', title, o),
    warning: (title, o) => push('warning', title, o),
    error: (title, o) => push('error', title, o),
    // Central error handler (API Contract section 10): message + X-Request-Id
    apiError: (err, fallback = 'Something went wrong') => {
      const details = err?.details && Object.keys(err.details).length
        ? Object.entries(err.details).map(([k, v]) => `${k} ${v}`).join(' · ')
        : undefined;
      push('error', err?.message || fallback, { description: details, requestId: err?.requestId, code: err?.code });
    },
  }), [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICONS[t.type];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.25 }}
                className="pointer-events-auto flex gap-3 rounded-xl border border-line bg-card/95 p-4 shadow-2xl backdrop-blur"
                role={t.type === 'error' ? 'alert' : 'status'}
              >
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${COLORS[t.type]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-gray-400">{t.description}</p>}
                  {t.requestId && (
                    <p className="mt-1 font-mono text-[11px] text-gray-500">
                      {t.code && `${t.code} · `}Request ID: {t.requestId}
                    </p>
                  )}
                </div>
                <button onClick={() => dismiss(t.id)} className="text-gray-500 hover:text-white" aria-label="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
