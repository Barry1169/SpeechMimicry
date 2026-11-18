import { PitchDetector } from 'pitchy';
import { clamp, type Measurements, type Metric, type Range, type Summary, type TimedWord } from './model';
import { splitWords } from './transcription';

export type PitchPoint = { time: number; hz: number };
export interface Signal {
  duration: number;
  speech: Range | null;
  voicedTime: number;
  pitch: PitchPoint[];
  medianPitch: number | null;
  pitchRange: number | null;
  loudness: number | null;
  loudnessRange: number | null;
  maxPeak: number;
  clipped: number;
  pauses: Range[];
  rhythm: number[];
}

const db = (x: number) => 20 * Math.log10(Math.max(1e-7, x));
const rounded = (x: number) => Math.round(x * 10) / 10;
function quantile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const x = (sorted.length - 1) * p;
  const lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] * (1 - (x - lo)) + sorted[hi] * (x - lo);
}

export function inspectSignal(data: Float32Array, rate: number): Signal {
  const step = Math.max(1, Math.round(rate * .025));
  const rms: number[] = [];
  let maxPeak = 0, clipped = 0;
  for (let i = 0; i < data.length; i += step) {
    let squares = 0;
    const end = Math.min(i + step, data.length);
    for (let j = i; j < end; j++) {
      const val = Math.abs(data[j]);
      if (val >= .995) clipped++;
      if (val > maxPeak) maxPeak = val;
      squares += val * val;
    }
    rms.push(Math.sqrt(squares / Math.max(1, end - i)));
  }
  const duration = data.length / rate, hop = step / rate;
  const high = quantile(rms, .9);
  const floor = quantile(rms, .15);
  const threshold = Math.max(.004, high * .14, Math.min(high * .45, floor * 2.5));
  const active = rms.map(x => x >= threshold);
  // Ignore isolated single-frame noises when finding speech boundaries.
  const voiced = active.map((x, i) => x && Boolean(active[i - 1] || active[i + 1]));
  const first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
  const speech = first !== -1 && last - first >= 3 ? { start: first * hop, end: Math.min(duration, (last + 1) * hop) } : null;
  const pauses: Range[] = [], pitch: PitchPoint[] = [], rhythm: number[] = [];
  if (speech) {
    let quiet = -1;
    for (let i = first; i <= last; i++) {
      if (!voiced[i]) { if (quiet < 0) quiet = i; }
      else if (quiet >= 0) {
        if ((i - quiet) * hop >= .18) pauses.push({ start: quiet * hop, end: i * hop });
        quiet = -1;
      }
    }
    const windowSize = Math.round(rate * .042);
    const detector = PitchDetector.forFloat32Array(windowSize);
    detector.minVolumeDecibels = -47;
    const input = new Float32Array(windowSize);
    for (let i = first; i <= last; i += 2) {
      const at = i * step;
      if (!voiced[i] || at + windowSize > data.length) continue;
      input.set(data.subarray(at, at + windowSize));
      const [hz, clarity] = detector.findPitch(input, rate);
      if (clarity >= .87 && hz >= 65 && hz <= 520) pitch.push({ time: (at + windowSize / 2) / rate, hz: rounded(hz) });
    }
    for (let i = 0; i < 32; i++) {
      const begin = Math.floor(first + (last - first + 1) * i / 32);
      const end = Math.max(begin + 1, Math.floor(first + (last - first + 1) * (i + 1) / 32));
      const chunk = rms.slice(begin, end);
      rhythm.push(clamp(chunk.reduce((a, x) => a + x, 0) / Math.max(1, chunk.length) / high, 0, 1));
    }
  }
  const voicedTime = voiced.filter(Boolean).length * hop;
  const hz = pitch.map(p => p.hz);
  const dynamics = rms.filter((_, i) => voiced[i]).map(db);
  return { duration, speech, voicedTime, pitch, medianPitch: hz.length >= 6 ? quantile(hz, .5) : null,
    pitchRange: hz.length >= 6 ? 12 * Math.log2(quantile(hz, .9) / quantile(hz, .1)) : null,
    maxPeak, clipped: clipped / Math.max(1, data.length), loudness: dynamics.length >= 4 ? quantile(dynamics, .5) : null,
    loudnessRange: dynamics.length >= 4 ? quantile(dynamics, .9) - quantile(dynamics, .1) : null, pauses, rhythm };
}

export type Token = { text: string; value: string; timing?: Range };
export type WordPair = { original?: Token; take?: Token; status: 'match' | 'missing' | 'substitution' | 'extra' };
export function tokens(text: string, times?: TimedWord[], locale?: string): Token[] {
  const words = splitWords(text, locale);
  const timed = times?.map(({ text, start, end }) => ({ value: splitWords(text, locale).join(' '), start, end }));
  // Reuse time codes only if every recognized token still matches the edited transcript.
  const haveTimes = timed?.length === words.length && words.every((word, index) => timed[index].value === word);
  return words.map((word, index) => ({ text: word, value: word, ...(haveTimes && timed ? { timing: { start: timed[index].start, end: timed[index].end } } : {}) }));
}

export function alignWords(a: Token[], b: Token[]): WordPair[] {
  const width = b.length + 1;
  const grid = new Uint16Array((a.length + 1) * width);
  for (let i = 1; i <= a.length; i++) grid[i * width] = i;
  for (let j = 1; j <= b.length; j++) grid[j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const index = i * width + j;
    grid[index] = Math.min(grid[index - width] + 1, grid[index - 1] + 1, grid[index - width - 1] + (a[i - 1].value === b[j - 1].value ? 0 : 1));
  }
  const pairs: WordPair[] = [];
  let i = a.length, j = b.length;
  while (i || j) {
    const cost = grid[i * width + j];
    if (i && j && cost === grid[(i - 1) * width + j - 1] + (a[i - 1].value === b[j - 1].value ? 0 : 1)) {
      const original = a[--i], take = b[--j];
      pairs.push({ original, take, status: original.value === take.value ? 'match' : 'substitution' });
    } else if (i && cost === grid[(i - 1) * width + j] + 1) pairs.push({ original: a[--i], status: 'missing' });
    else pairs.push({ take: b[--j], status: 'extra' });
  }
  return pairs.reverse();
}

const similarity = (a: number, b: number) => Math.max(a, b) > 0 ? Math.round(100 * Math.min(a, b) / Math.max(a, b)) : 100;
const scoreFromError = (error: number, tolerance: number) => Math.round(100 * clamp(1 - error / tolerance, 0, 1));
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const speechSpan = (a: Signal) => a.speech ? a.speech.end - a.speech.start : 0;
function relativePitch(signal: Signal) {
  const scale = signal.medianPitch, speech = signal.speech;
  if (!scale || !speech) return [];
  const bins: number[][] = Array.from({ length: 16 }, () => []);
  for (const { time, hz } of signal.pitch) {
    const i = clamp(Math.floor((time - speech.start) / (speech.end - speech.start) * bins.length), 0, bins.length - 1);
    bins[i].push(12 * Math.log2(hz / scale));
  }
  return bins.map(group => group.length ? quantile(group, .5) : null);
}

export function compareSignals(a: Signal, b: Signal, original?: Token[], take?: Token[], referenceDelay?: number) {
  const metrics: Metric[] = [];
  const add = (key: Metric['key'], title: string, score: number | null, detail: string, method: string) => metrics.push({ key, title, score, detail, method });
  const both = Boolean(a.speech && b.speech);
  const durationA = speechSpan(a), durationB = speechSpan(b);
  const wpmA = original?.length && durationA > .3 ? Math.round(original.length * 60 / durationA) : null;
  const wpmB = take?.length && durationB > .3 ? Math.round(take.length * 60 / durationB) : null;
  add('pace', 'Speaking pace', both ? similarity(wpmA && wpmB ? wpmA : durationA, wpmA && wpmB ? wpmB : durationB) : null,
    wpmA && wpmB ? `${wpmA} WPM reference · ${wpmB} WPM take` : both ? `${rounded(durationA)}s reference · ${rounded(durationB)}s take (speech span)` : 'Not enough audible activity in both recordings.',
    'Smaller divided by larger, using transcript words per minute when both transcripts are available; otherwise compares elapsed time from first to last audible activity. Estimates include pauses and can be affected by noise.');
  add('rhythm', 'Rhythm', both ? scoreFromError(average(a.rhythm.map((n, i) => Math.abs(n - b.rhythm[i]))), .55) : null,
    both ? 'Time-normalized patterns of louder and quieter speech' : 'Rhythm needs audible activity in both recordings.',
    'Compares 32 relative loudness bins across each speech span, normalized to each clip. A mean difference of 0.55 or more scores 0. This is an energy-pattern proxy, not syllable alignment.');
  const shapeA = relativePitch(a), shapeB = relativePitch(b);
  const pairs = shapeA.flatMap((val, i) => val !== null && typeof shapeB[i] === 'number' ? [Math.abs(val - shapeB[i]!)] : []);
  add('intonation', 'Intonation', pairs.length >= 5 ? scoreFromError(average(pairs), 7) : null,
    pairs.length >= 5 ? `${rounded(average(pairs))} semitones average contour difference` : 'Not enough reliable voiced pitch to compare contours.',
    'Compares relative pitch in 16 time-normalized bins, relative to each person’s own median. An average difference of 7 semitones or more scores 0. Background voices and music reduce reliability.');
  add('pitch', 'Pitch variation', a.pitchRange !== null && b.pitchRange !== null ? similarity(a.pitchRange, b.pitchRange) : null,
    a.pitchRange !== null && b.pitchRange !== null ? `${rounded(a.pitchRange)} st reference · ${rounded(b.pitchRange)} st take` : 'Not enough reliable pitch in both recordings.',
    'Smaller divided by larger between the 10th and 90th percentile pitch spans, measured in semitones. This is range similarity only. Median fundamental frequencies do not identify voices.');
  add('volume', 'Volume consistency', a.loudnessRange !== null && b.loudnessRange !== null ? scoreFromError(Math.abs(a.loudnessRange - b.loudnessRange), 24) : null,
    a.loudness !== null && b.loudness !== null ? `${Math.round(a.loudness)} dBFS reference · ${Math.round(b.loudness)} dBFS take` : 'Not enough audible activity to measure levels.',
    'Compares the 10th-to-90th percentile RMS spread of active frames. A spread difference of 24 dB or more scores 0. dBFS measures the file, not physical loudness or projection. Microphone gain matters.');
  const quietA = a.pauses.reduce((sum, p) => sum + p.end - p.start, 0);
  const quietB = b.pauses.reduce((sum, p) => sum + p.end - p.start, 0);
  let pauseError = 0;
  if (a.speech && b.speech) {
    const toShape = (signal: Signal, start: number, duration: number) => Array.from({ length: 32 }, (_, i) => {
      const cursor = start + (i + .5) * duration / 32;
      return signal.pauses.some(p => cursor >= p.start && cursor < p.end) ? 1 : 0;
    });
    const patternA = toShape(a, a.speech.start, durationA), patternB = toShape(b, b.speech.start, durationB);
    pauseError = average(patternA.map((n, i) => Math.abs(n - patternB[i])));
  }
  add('pauses', 'Pauses', both ? Math.round(.6 * scoreFromError(pauseError, .5) + .4 * similarity(quietA, quietB)) : null,
    both ? `${a.pauses.length} pauses (${rounded(quietA)}s) · ${b.pauses.length} pauses (${rounded(quietB)}s)` : 'Pause detection needs audible activity in both recordings.',
    'Quiet gaps of at least 180 ms between active frames. 60% normalized gap placement (full penalty at 50% bin disagreement) and 40% total gap-duration ratio. Background noise may conceal real pauses.');
  const lag = a.speech && b.speech && referenceDelay !== undefined ? b.speech.start - (referenceDelay + a.speech.start) : null;
  add('timing', 'Shadowing timing', lag === null ? null : scoreFromError(Math.abs(lag), 1.2),
    lag === null ? 'Available for a continuous shadowing take at 1.0×.' : `${Math.round(Math.abs(lag) * 1000)} ms ${lag >= 0 ? 'behind' : 'ahead'} at first detected activity`,
    'Compares first audible activity after the measured playback-start event. A 1.2-second difference scores 0. This is approximate and not corrected for device latency or speaker bleed; use headphones.');
  const words = original?.length && take?.length && original.length <= 650 && take.length <= 650 ? alignWords(original, take) : [];
  const errors = words.filter(word => word.status !== 'match').length;
  add('words', 'Transcript word match', words.length ? scoreFromError(errors, original!.length) : null,
    words.length ? `${errors} text edits · ${words.filter(word => word.status === 'match').length} matched tokens` : original && take && Math.max(original.length, take.length) > 650 ? 'Choose a smaller clip to compare up to 650 words.' : 'Add a reference and take transcript to compare words.',
    '100 × (1 − word edit distance / reference word count), clamped to 0–100. Recognition and manual edits can change this result. It does not measure consonants, vowels or pronunciation accuracy.');
  const measurements = (s: Signal, wpm: number | null, quiet: number): Measurements => ({
    wpm: wpm ?? undefined, span: s.speech ? rounded(speechSpan(s)) : undefined, hz: s.medianPitch ?? undefined, pitchSpan: s.pitchRange ?? undefined,
    level: s.loudness ?? undefined, pauses: s.speech ? s.pauses.length : undefined, pauseSeconds: s.speech ? rounded(quiet) : undefined,
  });
  const summary: Summary = { metrics, time: Date.now(), referenceWords: original?.length, takeWords: take?.length, original: measurements(a, wpmA, quietA), recorded: measurements(b, wpmB, quietB) };
  return { summary, words, wpmA, wpmB };
}

const DRILLS: Record<Metric['key'], { action: string; exercise: string }> = {
  pace: { action: 'Match the time it takes to say the line.', exercise: 'Listen once, then repeat the clip three times at the reference pace. Leave space for the last word.' },
  rhythm: { action: 'Put stress in the same places.', exercise: 'Tap the louder beats as you listen. Then echo the line while keeping the same beat.' },
  intonation: { action: 'Follow the rise and fall, not the reference’s pitch.', exercise: 'Hum the contour once, then speak it. Watch how your relative movement changes near the end.' },
  pitch: { action: 'Practise the size of the pitch movement.', exercise: 'Start in a comfortable range and exaggerate one lift or drop. Repeat it once more at a natural level.' },
  volume: { action: 'Keep your level steady through the phrase.', exercise: 'Stay the same distance from the mic. Compare how the quieter syllables change from start to finish.' },
  pauses: { action: 'Leave space where the reference does.', exercise: 'Mark each pause with a slash and breathe there. Echo three times without filling in the silence.' },
  timing: { action: 'Enter with the first audible beat.', exercise: 'Use headphones and shadow the first clause at normal speed. Reset and repeat, listening for the first sound.' },
  words: { action: 'Check the words that differ.', exercise: 'Listen to the matching section. Verify the transcripts first, then rehearse any genuinely missing or changed words.' },
};
export function coaching(summary: Summary) {
  return summary.metrics.filter(metric => metric.score !== null && metric.score < 90).sort((a, b) => a.score! - b.score!).slice(0, 3)
    .map(metric => ({ ...metric, ...DRILLS[metric.key] }));
}

export function recordingQuality(signal: Signal) {
  if (signal.maxPeak < .018 || !signal.speech) return 'Very little audible activity was detected. Check the input and try another take.';
  if (signal.clipped > .005) return 'Some samples reached the input limit. Move farther from the microphone or lower the input gain.';
  if ((signal.loudness ?? 0) < -37) return 'The take is quiet. Try bringing the microphone closer.';
  return undefined;
}
