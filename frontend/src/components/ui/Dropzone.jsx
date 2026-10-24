import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cx } from '../../utils/format';

export default function Dropzone({ onFile, accept, label = 'Drop a file here or click to browse', hint, disabled }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (files) => files?.[0] && onFile(files[0]);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      className={cx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors',
        over ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50 hover:bg-white/[0.02]', disabled && 'pointer-events-none opacity-50')}
    >
      <UploadCloud className="mb-2 h-8 w-8 text-accent" />
      <p className="text-sm font-medium text-gray-200">{label}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
