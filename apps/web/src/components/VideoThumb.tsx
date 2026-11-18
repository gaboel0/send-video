import { Film } from 'lucide-react';
import { useState } from 'react';
import { formatDuration } from '../lib/time';

/** Miniatura vertical (9:16 por padrão) com duração */
export function VideoThumb({
  src,
  duration,
  className = '',
  ratio = '9 / 16',
  showDuration = true,
}: {
  src: string | null;
  duration?: number | null;
  className?: string;
  ratio?: string;
  showDuration?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`relative overflow-hidden rounded-[var(--radius-input)] bg-paper-3 ${className}`} style={{ aspectRatio: ratio }}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-faint">
          <Film className="size-5" aria-hidden />
        </div>
      )}
      {showDuration && duration ? (
        <span className="fig absolute right-1 bottom-1 rounded-[4px] bg-[color-mix(in_oklch,var(--color-board)_78%,transparent)] px-1 py-px text-[0.6875rem] text-board-type">
          {formatDuration(duration)}
        </span>
      ) : null}
    </div>
  );
}
