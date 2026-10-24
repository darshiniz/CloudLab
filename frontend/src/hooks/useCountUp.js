import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Animates a number from 0 to `target`. Respects prefers-reduced-motion. */
export default function useCountUp(target, duration = 900) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (typeof target !== 'number' || Number.isNaN(target)) return undefined;
    if (reduce) { setValue(target); return undefined; }
    let raf;
    const start = performance.now();
    const from = 0;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return value;
}
