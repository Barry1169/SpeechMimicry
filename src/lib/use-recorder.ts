'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_TAKE_SECONDS } from './media';
import type { Settings } from './model';

export type Recording = { blob: Blob; wallDuration: number };
type Phase = 'idle' | 'requesting' | 'armed' | 'recording' | 'paused' | 'processing';
const mimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export function useRecorder(settings: Settings, onError: (message: string) => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const monitor = useRef<ReturnType<typeof setInterval> | null>(null);
  const context = useRef<AudioContext | null>(null);
  const timing = useRef({ start: 0, accrued: 0 });
  const generation = useRef(0);
  const clean = useCallback(() => {
    if (monitor.current) clearInterval(monitor.current);
    if (context.current) void context.current.close().catch(() => undefined);
    context.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    setLevel(0);
  }, []);
  const cancel = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') return;
    generation.current++;
    clean();
    setPhase('idle');
  }, [clean]);
  const acquire = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording needs a supported browser on HTTPS or localhost. Open EchoSpeak in its own tab if the preview blocks the microphone.');
    if (stream.current?.active) { setPhase('armed'); return stream.current; }
    const token = ++generation.current;
    setPhase('requesting');
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: { ...(settings.microphone ? { deviceId: { exact: settings.microphone } } : {}), echoCancellation: true, noiseSuppression: settings.noiseReduction, channelCount: { ideal: 1 } } });
      if (generation.current !== token) {
        input.getTracks().forEach(track => track.stop());
        throw new Error('Microphone request cancelled.');
      }
      stream.current = input;
      setPhase('armed');
      return input;
    } catch (error) {
      if (generation.current === token) setPhase('idle');
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) throw new Error('Microphone access was denied. Allow access in your browser. If the embedded preview blocks it, open the studio in its own tab.');
      if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) throw new Error('The microphone is unavailable. Connect one or choose System default in Settings.');
      throw error instanceof Error ? error : new Error('The microphone could not be opened.');
    }
  }, [settings.microphone, settings.noiseReduction]);
  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      if (recorder.current.state === 'recording') timing.current.accrued += performance.now() - timing.current.start;
      timing.current.start = 0;
      setPhase('processing');
      recorder.current.stop();
    }
  }, []);
  const pause = useCallback(() => {
    if (recorder.current?.state !== 'recording') return;
    timing.current.accrued += performance.now() - timing.current.start;
    timing.current.start = 0;
    recorder.current.pause();
    setLevel(0);
    setPhase('paused');
  }, []);
  const resume = useCallback(() => {
    if (recorder.current?.state !== 'paused') return;
    timing.current.start = performance.now();
    recorder.current.resume();
    setPhase('recording');
  }, []);
  const start = useCallback((input: MediaStream, finish: (recording: Recording) => Promise<void>, onStart?: (now: number) => void, limit = MAX_TAKE_SECONDS) => {
    if (recorder.current && recorder.current.state !== 'inactive') throw new Error('Finish the current recording first.');
    if (!input.active) throw new Error('The microphone was disconnected.');
    const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
    const instance = new MediaRecorder(input, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: settings.quality === 'high' ? 128000 : 64000 });
    recorder.current = instance;
    const chunks: Blob[] = [];
    let meter: AnalyserNode | undefined;
    let values: Float32Array<ArrayBuffer> | undefined;
    try {
      const ctx = new AudioContext();
      context.current = ctx;
      void ctx.resume().catch(() => undefined);
      meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      ctx.createMediaStreamSource(input).connect(meter);
      values = new Float32Array(meter.fftSize);
    } catch { /* Meter is optional; MediaRecorder does not depend on it. */ }
    setElapsed(0);
    setPeaks([]);
    timing.current = { start: 0, accrued: 0 };
    instance.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    instance.onstart = () => {
      if (instance.state === 'inactive') return;
      timing.current.start = performance.now();
      setPhase('recording');
      onStart?.(timing.current.start);
    };
    instance.onstop = () => {
      const wallDuration = (timing.current.accrued + (timing.current.start ? performance.now() - timing.current.start : 0)) / 1000;
      clean();
      recorder.current = null;
      setPhase('processing');
      const type = instance.mimeType || chunks[0]?.type || 'audio/webm';
      if (!chunks.length) { onError('No audio was recorded. Try again and make sure the microphone is connected.'); setPhase('idle'); return; }
      void finish({ blob: new Blob(chunks, { type }), wallDuration })
        .catch(error => onError(error instanceof Error ? error.message : 'Could not prepare the recording.'))
        .finally(() => setPhase('idle'));
    };
    instance.onerror = () => {
      onError('The microphone reported an error. Any captured audio will be kept if available.');
      if (instance.state !== 'inactive') stop();
    };
    input.getAudioTracks().forEach(track => track.addEventListener('ended', stop, { once: true }));
    instance.start(250);
    setPhase('recording');
    monitor.current = setInterval(() => {
      if (instance.state !== 'recording' || !timing.current.start) return;
      const seconds = (timing.current.accrued + performance.now() - timing.current.start) / 1000;
      setElapsed(seconds);
      if (seconds >= limit) { stop(); return; }
      let next = 0;
      if (meter && values) {
        meter.getFloatTimeDomainData(values);
        for (const val of values) next = Math.max(next, Math.abs(val));
      }
      setLevel(Math.min(1, next * 2));
      setPeaks(old => [...old.slice(-159), Math.min(1, next * 2.8)]);
    }, 85);
  }, [settings.quality, onError, clean, stop]);

  useEffect(() => () => {
    generation.current++;
    if (recorder.current?.state && recorder.current.state !== 'inactive') {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    clean();
  }, [clean]);
  return { phase, elapsed, peaks, level, acquire, start, stop, pause, resume, cancel };
}
