import { spanLabel } from '@/lib/model';
import type { Signal } from '@/lib/analysis';

export function PitchChart({ original, take }: { original: Signal; take?: Signal }) {
  const duration = Math.max(original.duration, take?.duration ?? 0, 0.1);
  const voiced = [...original.pitch, ...(take?.pitch ?? [])];
  if (!voiced.length) return <p className="notice">No clear pitched speech was detected. Background noise or very quiet recordings can make pitch unavailable.</p>;
  const minimum = Math.max(40, Math.floor(Math.min(...voiced.map(point => point.hz)) / 50) * 50);
  const maximum = Math.max(minimum + 100, Math.ceil(Math.max(...voiced.map(point => point.hz)) / 50) * 50);
  const W = 460, H = 135, X = 46, Y = 10;
  const y = (hz: number) => Y + (maximum - hz) / (maximum - minimum) * (H - Y - 27);
  const x = (sec: number) => X + sec / duration * (W - X - 13);
  const shape = (data: Signal) => data.pitch.map((point, i) => `${!i || point.time - data.pitch[i - 1].time > .14 ? 'M' : 'L'}${x(point.time).toFixed(2)},${y(point.hz).toFixed(2)}`).join(' ');
  return <div className="pitch-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Estimated fundamental frequency over time in hertz">
      {[0, .25, .5, .75, 1].map(n => {
        const hz = Math.round(minimum + (maximum - minimum) * n);
        return <g key={n}><line x1={X} x2={W - 12} y1={y(hz)} y2={y(hz)} className="pitch-grid"/><text x={X - 6} y={y(hz) + 3} textAnchor="end">{hz} Hz</text></g>;
      })}
      {[0, .25, .5, .75, 1].map(n => <text key={n} x={x(duration * n)} y={H - 7} textAnchor={n === 0 ? 'start' : n === 1 ? 'end' : 'middle'}>{spanLabel(duration * n)}</text>)}
      <path d={shape(original)} className="original-pitch"/>{take && <path d={shape(take)} className="take-pitch"/>}
    </svg>
    {take && <div className="chart-legend"><span>Reference</span><span>Your take</span></div>}
  </div>;
}
