'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Range } from './model';

export function useMediaURL(blob?: Blob, fixed?: string) {
  const [entry, setEntry] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // Object URLs must be allocated/released with the effect lifecycle, not during rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return fixed || (entry?.blob === blob ? entry?.url : undefined);
}

type PlayOptions = { restart?: boolean; repetitions?: number; onEnd?: () => void; onRepeat?: (iteration: number) => void; onAudible?: () => void };
type Scope = PlayOptions & { range: Range; iteration: number; audible: boolean };

export function usePlayer(url?: string, speed = 1, volume = 0.9, initialTime = 0) {
  const media = useRef<HTMLAudioElement>(null);
  const scope = useRef<Scope | null>(null);
  const pendingTime = useRef<number>(initialTime);
  const [position, setPosition] = useState(initialTime);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const initial = useRef(initialTime);

  const seek = useCallback((time: number) => {
    if (!Number.isFinite(time)) return;
    pendingTime.current = Math.max(0, time);
    if (media.current && media.current.readyState > 0) {
      media.current.currentTime = Math.min(Number.isFinite(media.current.duration) ? media.current.duration : pendingTime.current, pendingTime.current);
    }
    setPosition(pendingTime.current);
  }, []);

  // Keep a pending seek when the media element is still loading its new source.
  useEffect(() => {
    const audio = media.current;
    if (!audio) return;
    let animation = 0, lastFrame = 0;
    const meta = () => {
      if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(pendingTime.current, audio.duration);
      setFailed(false);
    };
    const sync = () => {
      const current = scope.current;
      const at = audio.currentTime;
      if (current && (at >= current.range.end - .009 || audio.ended)) {
        if (current.iteration < (current.repetitions ?? 1)) {
          current.iteration += 1;
          current.onRepeat?.(current.iteration);
          seek(current.range.start);
          if (audio.paused) void audio.play().catch(() => { scope.current = null; setPlaying(false); });
        } else {
          scope.current = null;
          audio.pause();
          seek(current.range.end);
          current.onEnd?.();
        }
      } else if (audio.readyState > 0) setPosition(old => Math.abs(old - at) >= .025 ? at : old);
    };
    const tick = (now: number) => {
      if (now - lastFrame >= 25) { sync(); lastFrame = now; }
      if (!audio.paused) animation = requestAnimationFrame(tick);
    };
    const play = () => {
      setPlaying(true);
      const current = scope.current;
      if (current && !current.audible) { current.audible = true; current.onAudible?.(); }
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(tick);
    };
    const pause = () => { cancelAnimationFrame(animation); setPlaying(false); };
    const ended = () => { pause(); sync(); };
    const error = () => { pause(); setFailed(true); scope.current = null; };
    audio.addEventListener('loadedmetadata', meta);
    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('playing', play);
    audio.addEventListener('pause', pause);
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', error);
    return () => {
      cancelAnimationFrame(animation);
      scope.current = null;
      audio.pause();
      audio.removeEventListener('loadedmetadata', meta);
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('playing', play);
      audio.removeEventListener('pause', pause);
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', error);
    };
  }, [url, seek]);

  useEffect(() => {
    const audio = media.current;
    if (!audio) return;
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
    audio.preservesPitch = true;
    audio.volume = volume;
  }, [speed, volume, url]);

  const reset = useCallback((time = initial.current) => { scope.current = null; media.current?.pause(); setPlaying(false); seek(time); }, [seek]);
  const pause = useCallback(() => { scope.current = null; media.current?.pause(); setPlaying(false); }, []);
  const play = useCallback(async (range: Range, options: PlayOptions = {}) => {
    const audio = media.current;
    if (!audio || !audio.getAttribute('src')) throw new Error('The audio is still loading. Try again in a moment.');
    const oldTime = audio.readyState > 0 ? audio.currentTime : pendingTime.current;
    scope.current = { ...options, range, iteration: 1, audible: false };
    if (options.restart || oldTime < range.start || oldTime >= range.end - .05) seek(range.start);
    try {
      const wasPlaying = !audio.paused;
      await audio.play();
      if (wasPlaying && scope.current && !scope.current.audible) { scope.current.audible = true; options.onAudible?.(); }
    } catch {
      scope.current = null;
      throw new Error('Playback could not start. Check that the recording is playable and try again.');
    }
  }, [seek]);
  return { media, position, playing, failed, seek, pause, play, reset };
}
