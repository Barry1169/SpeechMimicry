import demo from './demo-data.json';

export type Range = { start: number; end: number };
export type TimedWord = Range & { text: string };
export type Cue = Range & { id: string; text: string; words?: TimedWord[] };
export type Transcript = { cues: Cue[]; origin: 'manual' | 'sample' | 'recognition'; language?: string };
export type Mode = 'listen' | 'shadow' | 'repeat' | 'memory' | 'loop';

export interface Source {
  id: string;
  name: string;
  duration: number;
  peaks: number[];
  created: number;
  transcript?: Transcript;
  blob?: Blob;
  url?: string;
  speakerId?: string;
  collection?: string;
  favorite?: boolean;
}

export type MetricKey = 'pace' | 'rhythm' | 'intonation' | 'pitch' | 'volume' | 'pauses' | 'timing' | 'words';
export type Metric = { key: MetricKey; title: string; score: number | null; detail: string; method: string };
export type Measurements = { wpm?: number; span?: number; hz?: number; pitchSpan?: number; level?: number; pauses?: number; pauseSeconds?: number };
export type Summary = { metrics: Metric[]; referenceWords?: number; takeWords?: number; original?: Measurements; recorded?: Measurements; time: number };
export interface Take {
  id: string;
  name: string;
  sourceId: string;
  range: Range;
  mode: Mode;
  drillId?: string;
  referenceText?: string;
  duration: number;
  peaks: number[];
  created: number;
  blob: Blob;
  referenceDelay?: number;
  transcript?: Transcript;
  draft: boolean;
  report?: Summary;
  quality?: string;
}

export interface Speaker {
  id: string;
  name: string;
  description: string;
  language: string;
  accent: string;
  style: string;
  category: string;
  notes: string;
  favorite: boolean;
  avatar?: Blob;
}

export interface Clip extends Range {
  id: string;
  sourceId: string;
  text: string;
  category: 'sentence' | 'word' | 'clip';
  created: number;
  attempts: number;
  matched: number;
}

export const SPEEDS = [0.5, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5] as const;
export const REPETITIONS = [1, 3, 5, 10] as const;
export type Settings = {
  id: 'preferences';
  theme: 'light' | 'dark' | 'system';
  speed: number;
  repetitions: number;
  language: string;
  microphone: string;
  quality: 'standard' | 'high';
  noiseReduction: boolean;
};
export type Session = { id: 'session'; sourceId: string; range: Range; mode: Mode; clipId?: string };

export const DEFAULT_SETTINGS: Settings = { id: 'preferences', theme: 'light', speed: 1, repetitions: 3, language: '', microphone: '', quality: 'high', noiseReduction: true };
export const SAMPLE: Source = {
  id: 'studio-sample', name: 'The art of slowing down', duration: demo.duration, peaks: demo.peaks,
  url: '/studio-reference.mp3', created: 0, collection: 'Studio essentials',
  transcript: { origin: 'sample', language: 'en', cues: demo.cues },
};
export const DEFAULT_SESSION: Session = { id: 'session', sourceId: SAMPLE.id, range: { start: 5.85, end: 20.85 }, mode: 'repeat' };
export const MODE_NAMES: Record<Mode, string> = { listen: 'Listen', shadow: 'Shadowing', repeat: 'Listen & Repeat', memory: 'Independent', loop: 'Loop Practice' };

export function uid() { return globalThis.crypto.randomUUID(); }
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function boundedRange(range: Range, duration: number, minSize = 0.08): Range {
  const min = Math.min(minSize, duration);
  const start = clamp(Number.isFinite(range.start) ? range.start : 0, 0, duration - min);
  return { start, end: clamp(Number.isFinite(range.end) ? range.end : duration, start + min, duration) };
}
export function timeLabel(seconds: number, decimals = false) {
  const hundredths = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * 100 + .00001));
  const whole = Math.floor(hundredths / 100);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}${decimals ? `.${String(hundredths % 100).padStart(2, '0')}` : ''}`;
}
export function shortTime(seconds: number) { return timeLabel(seconds).replace(/^0/, ''); }
export function spanLabel(seconds: number) {
  if (seconds >= 60) return `${Math.floor(Math.round(seconds) / 60)}m ${Math.round(seconds) % 60}s`;
  return `${Math.round(seconds * 10) / 10}s`;
}
export function localDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function languageName(language?: string) {
  if (!language) return '';
  if (/^[a-z]{4,}$/i.test(language)) return language.charAt(0).toUpperCase() + language.slice(1);
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language; }
  catch { return language; }
}
