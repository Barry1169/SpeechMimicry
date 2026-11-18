'use client';
import { useMemo, useRef, type PointerEvent } from 'react';
import { clamp, shortTime, timeLabel, type Range } from '@/lib/model';

const W = 720, H = 116;
type Props = {
  peaks: number[]; duration: number; position?: number; range?: Range; onRange?: (range: Range) => void;
  onSeek?: (time: number) => void; label?: string; variant?: 'main' | 'compact' | 'live'; tone?: 'reference' | 'take';
  pauses?: Range[]; hideGrid?: boolean;
};
type Drag = { pointer: number; style: 'seek' | 'start' | 'end' | 'new'; origin: number };

export function Waveform({ peaks, duration, position, range, onRange, onSeek, label = 'Audio waveform', variant = 'main', tone = 'reference', pauses, hideGrid }: Props) {
  const drag = useRef<Drag | null>(null);
  const bars = useMemo(() => {
    const count = variant === 'main' ? 164 : 135;
    return Array.from({ length: count }, (_, i) => {
      const left = Math.floor(i / count * peaks.length), right = Math.floor((i + 1) / count * peaks.length);
      let amp = 0;
      for (let k = left; k < Math.max(left + 1, right); k++) amp = Math.max(amp, peaks[k] || 0);
      return { x: (i + .55) * W / count, height: Math.round(Math.max(1.1, Math.min(48, Math.pow(amp, .8) * 55)) * 100) / 100 };
    });
  }, [peaks, variant]);
  const size = duration || 1;
  const x = (time: number) => clamp(time / size, 0, 1) * W;
  const start = range ? x(range.start) : 0, end = range ? x(range.end) : W;
  const count = variant === 'main' ? 6 : 4;
  const marks = Array.from({ length: count + 1 }, (_, i) => i / count);
  const timeAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width, 0, 1) * size;
  };
  const act = (t: number, d: Drag) => {
    const min = Math.min(.15, duration);
    if (!range || !onRange || d.style === 'seek') { onSeek?.(t); return; }
    if (d.style === 'start') onRange({ start: clamp(t, 0, range.end - min), end: range.end });
    if (d.style === 'end') onRange({ start: range.start, end: clamp(t, range.start + min, duration) });
    if (d.style === 'new' && Math.abs(t - d.origin) >= min) onRange({ start: Math.min(t, d.origin), end: Math.max(t, d.origin) });
  };
  return <div className={`waveform waveform-${variant} wave-${tone}`}>
    <div className={`wave-body ${onSeek ? 'wave-interactive' : ''}`}
      {...(onSeek ? { role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': Number(duration.toFixed(2)), 'aria-valuenow': Number((position ?? 0).toFixed(2)), 'aria-valuetext': timeLabel(position ?? 0, true) } : { 'aria-hidden': true })}
      onPointerDown={onSeek ? event => {
        if (event.button !== 0) return;
        const t = timeAt(event);
        const handle = (event.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
        const style = onRange && event.shiftKey ? 'new' : onRange && (handle === 'start' || handle === 'end') ? handle : 'seek';
        drag.current = { pointer: event.pointerId, style, origin: t };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (style === 'seek') act(t, drag.current);
      } : undefined}
      onPointerMove={onSeek ? event => { if (drag.current?.pointer === event.pointerId) act(timeAt(event), drag.current); } : undefined}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={onSeek ? event => {
        const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!move && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault(); event.stopPropagation();
        onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : clamp((position ?? 0) + move * (event.shiftKey ? 5 : 1), 0, duration));
      } : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {range && <rect x={start} width={Math.max(0, end - start)} y="0" height={H} className="wave-selection"/>}
        {!hideGrid && marks.map(n => <line className="wave-grid" key={n} x1={n * W} x2={n * W} y1={0} y2={H}/>)}
        {pauses?.map(p => <rect key={p.start} x={x(p.start)} width={x(p.end) - x(p.start)} y="0" height={H} className="wave-pause"/>)}
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="wave-mid"/>
        {bars.map(({ x: px, height }) => <line key={px} className={peaks.length === 0 ? 'wave-idle' : px >= start && px <= end ? 'wave-line selected' : 'wave-line'} x1={px} x2={px} y1={H / 2 - height} y2={H / 2 + height}/>) }
      </svg>
      {range && onRange && <><span title="Drag clip start" data-handle="start" className="wave-handle" style={{ left: `${start / W * 100}%` }}/><span title="Drag clip end" data-handle="end" className="wave-handle" style={{ left: `${end / W * 100}%` }}/></>}
      {position !== undefined && <span className="wave-playhead" style={{ left: `${x(position) / W * 100}%` }}><span/></span>}
    </div>
    {variant !== 'live' && <div className="wave-ticks" aria-hidden="true">{marks.map(n => <span key={n} style={{ left: `${n * 100}%` }}>{shortTime(n * duration)}</span>)}</div>}
  </div>;
}
