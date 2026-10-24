import { useCallback, useState } from 'react';
import { useToast } from '../context/ToastContext';

/**
 * Wraps a button action: tracks which item is busy and shows the central error toast.
 *   const { run, busy } = useAction();
 *   run('env_1:stop', () => api.stopEnvironment('env_1'), { success: 'Lab stopped', after: refresh })
 */
export default function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, { success, after } = {}) => {
    setBusy(key);
    try {
      const result = await fn();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      await after?.(result);
      return result;
    } catch (err) {
      toast.apiError(err);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);
  return { run, busy };
}
