import { clamp, type Cue, type Range, type TimedWord, type Transcript } from './model';

export function splitWords(text: string, locale?: string): string[] {
  try {
    return [...new Intl.Segmenter(locale || undefined, { granularity: 'word' }).segment(text.normalize('NFKC').toLocaleLowerCase())]
      .filter(t => t.isWordLike).map(t => t.segment.replace(/[’‘]/g, "'"));
  } catch { return (text.toLowerCase().match(/[\p{L}\p{N}\p{M}'’]+/gu) ?? []).map(t => t.replace(/’/g, "'")); }
}

export type ProviderSegment = { start?: unknown; end?: unknown; text?: unknown; word?: unknown };
export type ProviderTranscript = { language?: unknown; segments?: ProviderSegment[]; words?: ProviderSegment[] };

function providerItem(item: ProviderSegment, duration: number, field: 'text' | 'word'): (Range & { text: string }) | undefined {
  const value = item?.[field];
  if (typeof item?.start !== 'number' || typeof item?.end !== 'number' || typeof value !== 'string' || !value.trim()) return;
  if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) return;
  const start = clamp(item.start, 0, duration), end = clamp(item.end, 0, duration);
  if (end > start) return { start, end, text: value.trim() };
}

/** Extracts sentence cues from estimated STT times. No invented word times. */
export function normalizeTranscript(result: ProviderTranscript, duration: number): Transcript {
  const language = typeof result.language === 'string' ? result.language.slice(0, 64) : undefined;
  const words = (Array.isArray(result.words) ? result.words : []).map(item => providerItem(item, duration, 'word')).filter((v): v is TimedWord => !!v).sort((a, b) => a.start - b.start);
  const segments = (Array.isArray(result.segments) ? result.segments : []).map(item => providerItem(item, duration, 'text')).filter((v): v is TimedWord => !!v).sort((a, b) => a.start - b.start);
  const cues: Cue[] = [];
  const add = (range: Range, text: string, timed: TimedWord[] = []) => cues.push({ ...range, text, id: `cue-${cues.length + 1}`, ...(timed.length ? { words: timed } : {}) });
  const splitSentences = (text: string) => {
    // Whisper may use full language names rather than BCP-47; the default segmenter still handles punctuation.
    return [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)].map(s => s.segment.trim()).filter(Boolean);
  };
  const estimated = (segment: TimedWord, timed: TimedWord[]) => {
    const parts = splitSentences(segment.text);
    const wordText = splitWords(timed.map(word => word.text).join(' ')).join(' ');
    const accepted = timed.length && wordText === splitWords(segment.text).join(' ') ? timed : [];
    if (!accepted.length || parts.length < 2) { add({ start: segment.start, end: segment.end }, segment.text, accepted); return; }
    // Split only when a monotonic token grouping has an exact lexical match. Otherwise keep the whole timed segment.
    let cursor = 0;
    const groups: TimedWord[][] = [];
    for (const text of parts) {
      const target = splitWords(text).join(' ');
      const group: TimedWord[] = [];
      let observed = '';
      while (cursor < timed.length && (observed.length < target.length || !group.length)) {
        group.push(timed[cursor++]);
        observed = splitWords(group.map(w => w.text).join(' ')).join(' ');
      }
      if (!group.length || observed !== target) { add({ start: segment.start, end: segment.end }, segment.text, timed); return; }
      groups.push(group);
    }
    if (cursor !== timed.length) { add({ start: segment.start, end: segment.end }, segment.text, timed); return; }
    groups.forEach((group, i) => add({ start: group[0].start, end: group[group.length - 1].end }, parts[i], group));
  };
  if (segments.length) {
    let i = 0;
    for (const segment of segments) {
      const group: TimedWord[] = [];
      while (i < words.length && (words[i].start + words[i].end) / 2 <= segment.end + 0.06) {
        const word = words[i++];
        if (word.end >= segment.start - 0.06) group.push(word);
      }
      estimated(segment, group);
    }
  } else if (words.length) {
    let group: TimedWord[] = [];
    for (const word of words) {
      group.push(word);
      if (/[.!?।！？]$/.test(word.text)) {
        add({ start: group[0].start, end: word.end }, group.map(w => w.text).join(' '), group);
        group = [];
      }
    }
    if (group.length) add({ start: group[0].start, end: group[group.length - 1].end }, group.map(w => w.text).join(' '), group);
  }
  return { origin: 'recognition', language, cues };
}

export function transcriptInRange(transcript: Transcript | undefined, range: Range) {
  const cues = transcript?.cues ?? [];
  // For partially selected cues, use only recognized words that fit the window. Untimed text is not guessed.
  return cues.flatMap(cue => {
    if (cue.end <= range.start || cue.start >= range.end) return [];
    const full = cue.start >= range.start - .03 && cue.end <= range.end + .03;
    const words = cue.words?.filter(word => word.start >= range.start - .03 && word.end <= range.end + .03);
    if (full) return [{ ...cue, words }];
    if (words?.length) return [{ ...cue, start: words[0].start, end: words[words.length - 1].end, text: words.map(w => w.text).join(' '), words }];
    return [];
  });
}

export function coversTextRange(transcript: Transcript | undefined, range: Range) {
  const cues = transcript?.cues ?? [];
  return cues.some(c => c.end > range.start && c.start < range.end)
    && !cues.some(c => c.end > range.start + .03 && c.start < range.end - .03 && (c.start < range.start - .03 || c.end > range.end + .03) && !c.words?.length);
}

export const cueText = (cues: Cue[]) => cues.map(c => c.text).join(' ');

export async function requestTranscript(file: Blob, language: string): Promise<Transcript> {
  const data = new FormData();
  data.append('audio', file, 'recording.wav');
  if (language) data.append('language', language);
  const response = await fetch('/api/transcribe', { method: 'POST', body: data, credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'Could not transcribe this recording. You can add cues manually.');
  if (!result.transcript?.cues.length) throw new Error('No recognizable speech was returned. You can add cues manually.');
  return result.transcript;
}
