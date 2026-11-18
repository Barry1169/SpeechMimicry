'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Activity, ArrowRight, AudioLines, Bookmark, Check, ChevronDown, CircleHelp, ClipboardList, Clock3, Crosshair, Download, Ellipsis, FileAudio,
  Headphones, Lightbulb, ListChecks, Mic, Pause, PencilLine, Play, Radio, Repeat, Repeat2, RotateCcw, RotateCw, Scissors, SlidersHorizontal,
  SplitSquareHorizontal, Square, Upload, Volume2, VolumeX,
} from 'lucide-react';
import { boundedRange, clamp, languageName, MODE_NAMES, REPETITIONS, SAMPLE, SPEEDS, spanLabel, timeLabel, uid, type Clip, type Cue, type Mode, type Range, type Session, type Settings, type Source, type Take } from '@/lib/model';
import { decodeMedia, envelope, MAX_TAKE_SECONDS, monoSamples, wavFromBuffer } from '@/lib/media';
import { inspectSignal, recordingQuality } from '@/lib/analysis';
import { useMediaURL, usePlayer } from '@/lib/use-player';
import { useRecorder } from '@/lib/use-recorder';
import { requestTranscript } from '@/lib/transcription';
import { Confirm, Empty, LinkButton, Modal, PageHeading, submitWith } from './ui';
import { Waveform } from './waveform';
import { TranscriptEditor } from './transcript-editor';

export const MODES = [
  { id: 'listen', Icon: Headphones, detail: 'Study the delivery' },
  { id: 'shadow', Icon: AudioLines, detail: 'Speak in sync' },
  { id: 'repeat', Icon: Repeat2, detail: 'Listen, then echo' },
  { id: 'memory', Icon: Mic, detail: 'Speak from memory' },
  { id: 'loop', Icon: Repeat, detail: 'Drill a section' },
] as const;
const modeHints: Record<Mode, { title: string; text: string }> = {
  listen: { title: 'Listen for the emphasis.', text: 'Play the reference and notice which words stand out. Slow it down and listen again before you try it.' },
  shadow: { title: 'Follow the first sound.', text: 'Put on headphones and start speaking with the reference. Try to match where each phrase begins and ends.' },
  repeat: { title: 'Listen for the pauses.', text: 'A good imitation isn’t just about the words. Listen for where the speaker slows down, takes a breath, or leaves a little space.' },
  memory: { title: 'Keep the shape of the line.', text: 'Listen once, then deliver it without reading. Try to remember the phrase’s rise and fall, not just the words.' },
  loop: { title: 'Work in small sections.', text: 'Pick a word, sentence, or clip and repeat it. The studio can advance to the next sentence after your set.' },
};

type Props = {
  visible: boolean; source: Source; take?: Take; session: Session; settings: Settings; clips: Clip[]; transcription: boolean;
  onSession: (session: Session) => void; updateSource: (source: Source) => Promise<void>; storeTake: (take: Take, captured?: boolean) => Promise<void>;
  onSaveClip: (range: Range, text: string, type: Clip['category']) => void;
  onImport: () => void; onChoose: () => void; onEditSource: () => void; onStyle: () => void; onCompare: (id: string) => void;
  onDeleteTake: (take: Take) => void; onSettings: () => void; onGuide: () => void; onBusy: (busy: boolean) => void;
  toast: (text: string, isError?: boolean) => void;
};

export function Studio({ visible, source, take, session, settings, clips, transcription, onSession, updateSource, storeTake, onSaveClip, onImport, onChoose, onEditSource, onStyle, onCompare, onDeleteTake, onSettings, onGuide, onBusy, toast }: Props) {
  const range = boundedRange(session.range, source.duration);
  const isDemo = source.id === SAMPLE.id;
  const url = useMediaURL(source.blob, source.url);
  const [speedOverride, setSpeed] = useState<number>();
  const [volume, setVolume] = useState(.9);
  const [repeat, setRepeat] = useState<'off' | 'clip' | 'all'>('off');
  const [repOverride, setReps] = useState<{ count: number; clipId?: string }>();
  const [modal, setModal] = useState<'range' | 'edit' | 'transcribe' | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retained, setRetained] = useState<Take>();
  const [discardRetained, setDiscardRetained] = useState(false);
  const [memoryHidden, hideMemory] = useState(false);
  const [multi, setMulti] = useState(false);
  const [step, setStep] = useState(0);
  const [focusCue, setFocusCue] = useState<string>();
  const drill = clips.find(c => c.id === session.clipId && c.category === 'word');
  const speed = speedOverride ?? settings.speed, reps = (repOverride?.clipId === session.clipId ? repOverride?.count : undefined) ?? (drill ? 5 : settings.repetitions);
  const anchor = useRef<Cue | null>(null);
  const delay = useRef<number | undefined>(undefined);
  const busyRequest = useRef(false);
  const currentSourceId = useRef(source.id);
  const cues = source.transcript?.cues ?? [];
  const player = usePlayer(url, speed, volume, range.start);
  const { pause: pauseRef, reset: resetRef, seek: seekRef } = player;
  const takeUrl = useMediaURL(retained?.blob ?? take?.blob);
  const takePlayer = usePlayer(takeUrl);
  const pauseTake = takePlayer.pause;
  const resetTake = takePlayer.reset;
  const recorder = useRecorder(settings, setError);
  const isCapturing = recorder.phase === 'recording' || recorder.phase === 'paused';
  const busy = recorder.phase !== 'idle';
  const availableTake = retained ?? take;
  const visibleCue = cues.find(c => player.position >= c.start - .025 && player.position < c.end + .025)?.id ?? focusCue ?? (player.position >= range.start - .03 && player.position < range.start + .25 ? cues.find(c => c.start >= range.start && c.start < range.end)?.id : undefined);
  const hiding = session.mode === 'memory' && memoryHidden;
  const isGuidedListening = recorder.phase === 'armed';

  useEffect(() => { onBusy(busy || Boolean(retained)); }, [onBusy, busy, retained]);
  useEffect(() => {
    if (!busy && !retained) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, retained]);
  useEffect(() => {
    if (!visible) { pauseRef(); pauseTake(); }
  }, [visible, pauseRef, pauseTake]);
  useEffect(() => { resetTake(0); }, [takeUrl, resetTake]);
  const initializeSource = useEffectEvent(() => {
    if (source.id !== currentSourceId.current) {
      currentSourceId.current = source.id; hideMemory(false); setNotice(''); setFocusCue(undefined); setError(''); setStep(0); anchor.current = null;
    }
    resetRef(range.start);
  });
  useEffect(() => { if (visible) initializeSource(); }, [source.id, url, visible]);

  function setSelection(next: Range, cue?: Cue, seek = true, clipId?: string) {
    const selected = boundedRange(next, source.duration);
    if (seek) { player.reset(selected.start); hideMemory(false); }
    setFocusCue(cue?.id);
    if (seek) { setStep(0); setNotice(''); }
    onSession({ ...session, range: selected, clipId });
  }
  function selectCue(cue: Cue, multiple: boolean) {
    if (busy) return;
    const previous = anchor.current;
    if (multiple && previous) setSelection({ start: Math.min(previous.start, cue.start), end: Math.max(previous.end, cue.end) }, cue);
    else { anchor.current = cue; setSelection(cue, cue); }
  }
  function nextCue(from: Range, wrap = false) {
    return cues.find(c => c.start >= from.end - .055) ?? (wrap ? cues[0] : undefined);
  }
  function onMode(mode: Mode) {
    if (busy) return;
    player.pause(); pauseTake();
    setNotice(''); setError(''); hideMemory(false); setStep(0);
    onSession({ ...session, mode });
  }
  function playLoops(selection: Range) {
    setNotice(`Loop 1 of ${reps}`);
    return player.play(selection, {
      restart: true, repetitions: reps,
      onRepeat: n => { setNotice(`Loop ${n} of ${reps}`); },
      onEnd: () => {
        const next = nextCue(selection);
        if (next && !drill) { setSelection(next, next); setNotice(`${reps} ${reps === 1 ? 'loop' : 'loops'} complete. The next sentence is ready.`); }
        else setNotice(`${reps} ${reps === 1 ? 'loop' : 'loops'} complete.`);
      },
    });
  }
  async function toggleReference() {
    if (busy) return;
    if (player.playing) { player.pause(); return; }
    pauseTake(); setError('');
    try {
      if (session.mode === 'loop') await playLoops(range);
      else await player.play(repeat === 'all' ? { start: 0, end: source.duration } : range, {
        repetitions: repeat === 'off' ? 1 : Infinity,
        onEnd: () => {
          if (session.mode === 'memory') hideMemory(true);
          if (session.mode === 'repeat' || session.mode === 'memory') setNotice('Your turn. Record your take when you’re ready.');
        },
      });
    } catch (err) { setError(err instanceof Error ? err.message : 'Playback could not start.'); }
  }
  function seek(time: number) { if (!busy) { setFocusCue(undefined); seekRef(time); } }
  function skip(delta: number) { seek(clamp(player.position + delta, 0, source.duration)); }
  function editPoint(which: 'start' | 'end') {
    if (which === 'start' && player.position >= range.end - .15) { toast('Set A before point B.', true); return; }
    if (which === 'end' && player.position <= range.start + .15) { toast('Set B after point A.', true); return; }
    setSelection({ ...range, [which]: clamp(player.position, 0, source.duration) }, undefined, false);
  }
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!visible || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [role=slider], [contenteditable]'))) return;
    if (event.code === 'Space' && !busy) { event.preventDefault(); void toggleReference(); }
    if (event.key === 'ArrowLeft' && !busy) { event.preventDefault(); skip(-5); }
    if (event.key === 'ArrowRight' && !busy) { event.preventDefault(); skip(5); }
    if (event.key.toLowerCase() === 'r' && !busy) { event.preventDefault(); void startRecording(false); }
    if (event.key.toLowerCase() === 'l' && !busy) setRepeat(old => old === 'clip' ? 'off' : 'clip');
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  async function startRecording(guided: boolean) {
    if (busy || busyRequest.current) return;
    if (retained) { toast('Save, download, or discard the in-memory take before making another one.', true); return; }
    if (range.end - range.start > MAX_TAKE_SECONDS) { setError('Choose a clip of 90 seconds or less for recording and comparison.'); return; }
    if ((guided || session.mode === 'shadow') && (range.end - range.start) / speed > MAX_TAKE_SECONDS) { setError('This clip would take over 90 seconds at the selected speed. Shorten the clip or choose a faster speed.'); return; }
    busyRequest.current = true; setError(''); setNotice(''); pauseTake(); player.reset(range.start); delay.current = undefined;
    try {
      const input = await recorder.acquire();
      const iteration = step >= reps ? 1 : step + 1;
      const launch = () => {
        if (session.mode === 'memory') hideMemory(true);
        setNotice(guided ? `Recording repetition ${iteration} of ${reps}.` : '');
        const limit = guided ? clamp((range.end - range.start) / speed + 2, 2.5, MAX_TAKE_SECONDS) : MAX_TAKE_SECONDS;
        try {
          recorder.start(input, async ({ blob, wallDuration }) => {
            const referenceDelay = delay.current;
            player.pause();
            let quality: string | undefined, duration = Math.max(.1, wallDuration), peaks: number[] = [];
            try {
              const audio = await decodeMedia(blob);
              duration = audio.duration;
              const samples = monoSamples(audio);
              peaks = envelope(samples, 268);
              quality = recordingQuality(inspectSignal(samples, audio.sampleRate));
            } catch { quality = 'The captured format couldn’t be decoded for analysis. The raw take is still available to download.'; }
            const now = Date.now();
            const take: Take = { id: uid(), name: `Take · ${new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, sourceId: source.id, range, mode: session.mode,
              duration, peaks, created: now, blob, draft: true, quality, referenceDelay, drillId: drill?.id, referenceText: drill?.text };
            try { await storeTake(take, true); }
            catch { setRetained(take); setError('Local storage could not keep this take. Download it, retry saving, or explicitly discard it.'); }
            if (guided) setStep(iteration);
            setNotice(guided ? `Repetition ${iteration} of ${reps} saved for review.` : 'Your take is ready to review.');
          }, start => {
            if (session.mode !== 'shadow') return;
            void player.play(range, { restart: true, onEnd: recorder.stop, onAudible: () => { if (speed === 1) delay.current = Math.max(0, (performance.now() - start) / 1000); } })
              .catch(err => { setError(err.message); recorder.stop(); });
          }, limit);
        } catch (err) { recorder.cancel(); setError(err instanceof Error ? err.message : 'The microphone cannot record this input.'); }
      };
      if (guided) {
        hideMemory(false); setNotice(`Listening to the reference · repetition ${iteration} of ${reps}`);
        await player.play(range, { restart: true, onEnd: launch });
      } else launch();
    } catch (err) { recorder.cancel(); setError(err instanceof Error ? err.message : 'The microphone could not be opened.'); setNotice(''); }
    finally { busyRequest.current = false; }
  }

  function holdRecording() {
    if (recorder.phase === 'recording') {
      if (session.mode === 'shadow') { player.pause(); delay.current = undefined; }
      recorder.pause();
    } else {
      recorder.resume();
      if (session.mode === 'shadow') void player.play(range, { onEnd: recorder.stop }).catch(err => setError(err.message));
    }
  }
  function cancelListening() { player.pause(); recorder.cancel(); setNotice(''); }
  async function keepTake() {
    if (!availableTake) return;
    try { await storeTake({ ...availableTake, draft: false }); if (retained) setRetained(undefined); toast('Recording kept in My Recordings.'); }
    catch { toast('Storage is full or unavailable. Try downloading the take.', true); }
  }
  async function transcribe() {
    setWorking(true); setError('');
    try {
      if (!source.blob && !source.url) throw new Error('This recording does not have any audio.');
      if (source.duration > 720) throw new Error('Automatic transcription supports references up to 12 minutes. Add cues manually for longer recordings.');
      const audio = await decodeMedia(source.blob ?? source.url!);
      const transcript = await requestTranscript(wavFromBuffer(audio, undefined, true), settings.language);
      await updateSource({ ...source, transcript });
      setModal(null); toast('Transcript added. Recognition timings are estimates.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Transcription failed.'); }
    finally { setWorking(false); }
  }
  function bookmarkCue(cue: Cue) { onSaveClip({ start: cue.start, end: cue.end }, cue.text, 'sentence'); }
  function bookmarkRange() {
    const word = cues.flatMap(c => c.words ?? []).find(w => Math.abs(w.start - range.start) < .04 && Math.abs(w.end - range.end) < .04);
    const exact = cues.find(c => Math.abs(c.start - range.start) < .04 && Math.abs(c.end - range.end) < .04);
    const text = word?.text ?? exact?.text ?? (cues.filter(c => c.end <= range.end + .03 && c.start >= range.start - .03).map(c => c.text).join(' ') || `Clip from ${source.name}`);
    onSaveClip(range, text, word ? 'word' : exact ? 'sentence' : 'clip');
  }

  return <div className="studio-view" hidden={!visible}>
    <PageHeading tag="YOUR VOICE MIMICRY WORKSPACE" title="Practice Studio" description="Listen closely, echo the delivery, and find the rhythm in every line." action={<button className="button primary import-main" disabled={busy || !!retained} onClick={onImport}><Upload size={17}/> Import audio</button>}/>
    <section className="mode-section" aria-label="Practice mode">
      <div className="section-label"><span>PRACTICE MODE</span><button className="bare small-help" onClick={onGuide}><CircleHelp size={14}/> Mode guide</button></div>
      <div className="modes">{MODES.map(({ id, Icon, detail }) => <button key={id} className={`mode ${session.mode === id ? 'active' : ''}`} aria-pressed={session.mode === id} disabled={busy} onClick={() => onMode(id)}>
        <span className="mode-icon"><Icon size={19} strokeWidth={1.75}/></span><span className="mode-copy"><strong>{MODE_NAMES[id]}</strong><small>{detail}</small></span>
      </button>)}</div>
    </section>

    <div className="studio-grid">
      <section className="panel reference-panel" aria-label="Original audio">
        <audio ref={player.media} src={url} preload="auto"/>
        <div className="reference-head">
          <div className="reference-cover">{isDemo ? <Image src="/studio-reference.jpg" alt="" width={50} height={50} priority/> : <FileAudio size={23}/>}</div>
          <div className="reference-heading"><div className="micro-label">ORIGINAL AUDIO</div><h2>{source.name}</h2></div>
          <div className="reference-actions">
            {isDemo && <span className="badge sample-badge" title="Synthetic narration for the built-in practice exercise">STUDIO SAMPLE</span>}
            <details className="popover details-menu">
              <summary className="icon-btn" aria-label="Reference options" title="Reference options"><Ellipsis size={20}/></summary>
              <div className="popover-content menu-content" onClick={e => { if ((e.target as Element).closest('button,a')) e.currentTarget.closest('details')?.removeAttribute('open'); }}>
                <button disabled={busy} onClick={onChoose}><FileAudio size={15}/> Choose reference</button>
                {!isDemo && <button disabled={busy} onClick={onEditSource}><PencilLine size={15}/> Rename & organize</button>}
                <button disabled={busy} onClick={onStyle}><Activity size={15}/> Speaking style profile</button>
                <button disabled={busy} onClick={bookmarkRange}><Bookmark size={15}/> Save selected clip</button>
                {url && <a href={url} download={source.blob instanceof File ? source.blob.name : `${source.name}.${isDemo ? 'mp3' : 'wav'}`}><Download size={15}/> Download audio</a>}
              </div>
            </details>
          </div>
        </div>
        <div className="wave-toolbar">
          <span className="clip-readout"><Scissors size={14}/><span>CLIP</span><strong>{timeLabel(range.start, true)} – {timeLabel(range.end, true)}</strong></span>
          <div className="wave-tools"><button className="mini-button" disabled={busy} title="Set clip start at playhead" aria-label="Set A at playhead" onClick={() => editPoint('start')}>Set A</button><button className="mini-button" disabled={busy} title="Set clip end at playhead" aria-label="Set B at playhead" onClick={() => editPoint('end')}>Set B</button><button className="icon-btn edit-range" disabled={busy} title="Edit clip range" aria-label="Edit clip range" onClick={() => setModal('range')}><SlidersHorizontal size={16}/></button></div>
        </div>
        <Waveform peaks={source.peaks} duration={source.duration} position={player.position} range={range} onSeek={busy ? undefined : seek}
          onRange={busy ? undefined : next => { player.pause(); setSelection(next, undefined, false); }} label="Original waveform timeline"/>
        <div className="player-controls">
          <span className="player-clock"><strong>{timeLabel(player.position)}</strong><span>/</span>{timeLabel(source.duration)}</span>
          <div className="transport">
            <button className="icon-btn skip-btn" disabled={busy} aria-label="Back 5 seconds" onClick={() => skip(-5)}><RotateCcw size={20}/><small>5</small></button>
            <button className="round-play" disabled={busy || !url} onClick={() => void toggleReference()} aria-label={player.playing ? 'Pause original' : 'Play original'}>{player.playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button>
            <button className="icon-btn skip-btn" disabled={busy} aria-label="Forward 5 seconds" onClick={() => skip(5)}><RotateCw size={20}/><small>5</small></button>
          </div>
          <div className="audio-options">
            <label className="select-wrap" title="Playback speed"><select aria-label="Playback speed" value={speed} disabled={busy} onChange={e => setSpeed(Number(e.target.value))}>{SPEEDS.map(value => <option key={value} value={value}>{value === 1 ? '1.0' : value}×</option>)}</select><ChevronDown size={11}/></label>
            <button className={`icon-btn loop-toggle ${repeat !== 'off' || session.mode === 'loop' ? 'is-on' : ''}`} aria-label={`Repeat mode: ${repeat}`} title={`Repeat: ${repeat === 'off' ? 'off' : repeat === 'clip' ? 'clip' : 'entire recording'}. Click to cycle.`} disabled={busy} onClick={() => { player.pause(); setRepeat(old => old === 'off' ? 'clip' : old === 'clip' ? 'all' : 'off'); }}><Repeat size={17}/>{repeat === 'all' && <i/>}</button>
            <details className="popover volume-menu"><summary className="icon-btn" title="Volume" aria-label="Volume">{volume ? <Volume2 size={18}/> : <VolumeX size={18}/>}</summary><div className="popover-content volume-content"><label>Volume <span>{Math.round(volume * 100)}%</span><input type="range" aria-label="Original volume" min={0} max={1} step={.01} value={volume} onChange={e => setVolume(Number(e.target.value))}/></label></div></details>
          </div>
        </div>
        <div className="reference-footer"><span><span className="clip-dot"/> {spanLabel(range.end - range.start)} selected</span><span className="drag-hint">Drag handles to adjust your clip</span><button className="bare save-clip-btn" disabled={busy} onClick={bookmarkRange}><Bookmark size={15}/> Save clip</button></div>
        {player.failed && <p className="notice error player-error">The browser couldn’t play this source. Try a WAV or MP3 copy.</p>}
      </section>

      <section className="panel transcript-panel" aria-label="Transcript">
        <div className="transcript-head"><div><h2>Transcript</h2><p>{cues.length ? `${cues.length} ${cues.length === 1 ? 'sentence' : 'sentences'}${languageName(source.transcript?.language) ? ` · ${languageName(source.transcript?.language)}` : ''}` : 'Add text to practise line by line'}</p></div>
          <div className="transcript-tools">{cues.length > 1 && !hiding && <button className={`icon-btn ${multi ? 'is-on' : ''}`} disabled={busy} aria-label="Select multiple sentences" aria-pressed={multi} title="Select multiple sentences (or Shift-click)" onClick={() => { setMulti(!multi); anchor.current = null; }}><ListChecks size={16}/></button>}
          <button className="button secondary small transcript-edit" disabled={busy} onClick={() => setModal('edit')}><PencilLine size={14}/> Edit</button></div>
        </div>
        {hiding ? <div className="transcript-scroll"><Empty icon={Headphones} title="Your turn, from memory" message="The transcript is hidden in Independent mode." action={<button className="button secondary small" onClick={() => hideMemory(false)}>Reveal transcript</button>}/></div>
          : !cues.length ? <div className="transcript-scroll"><Empty icon={ClipboardList} title="No transcript yet" message={transcription ? 'Generate a transcript, or write your own timed lines.' : 'Add timed lines manually. Automatic transcription is not configured.'} action={<button className="button secondary small" disabled={busy} onClick={() => { setError(''); setModal(transcription ? 'transcribe' : 'edit'); }}>{transcription ? 'Generate transcript' : 'Add transcript'}</button>}/></div>
          : <div className="transcript-scroll cue-list" tabIndex={0} aria-label="Timed sentences">
            {cues.map((cue, index) => {
              const active = visibleCue === cue.id;
              const inMulti = multi && cue.start >= range.start - .03 && cue.end <= range.end + .03;
              const saved = clips.some(c => c.sourceId === source.id && c.start === cue.start && c.end === cue.end && c.category === 'sentence');
              return <div className={`cue-row ${active ? 'current-cue' : inMulti ? 'marked-cue' : ''}`} key={cue.id}>
                <button className="cue-select" disabled={busy} aria-label={`Select sentence ${index + 1}: ${cue.text}`} aria-pressed={active || inMulti} onClick={e => selectCue(cue, e.shiftKey || multi)}>
                  <span className="cue-meta"><span className="cue-number">{active ? <AudioLines size={13}/> : String(index + 1).padStart(2, '0')}</span><time>{timeLabel(cue.start)}</time></span>{!cue.words?.length && <span className="cue-text">{cue.text}</span>}
                </button>
                {cue.words?.length ? <div className="cue-words">{cue.words.map((word, i) => <button key={i} className={player.position >= word.start && player.position < word.end ? 'word-current' : undefined} title="Estimated recognition timing" disabled={busy} onClick={() => setSelection(word, cue)}>{word.text}</button>)}</div> : null}
                <button className={`icon-btn cue-bookmark ${saved ? 'saved' : ''}`} disabled={busy} aria-label={`Bookmark sentence ${index + 1}`} title={saved ? 'Already saved' : 'Bookmark sentence'} onClick={() => bookmarkCue(cue)}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'}/></button>
              </div>;
            })}
          </div>}
        <div className="transcript-footer"><span><Radio size={14}/> {cues.length ? (source.transcript?.origin === 'recognition' ? 'Estimated recognition timing' : 'Synced with playback') : 'No timed cues'}</span>
          {transcription && cues.length > 0 && !isDemo && <button className="bare" disabled={busy} onClick={() => { setError(''); setModal('transcribe'); }}>Regenerate</button>}
        </div>
      </section>

      <section className="panel recording-panel" aria-label="Your take">
        <audio ref={takePlayer.media} src={takeUrl} preload="metadata"/>
        <div className="recording-head"><div><h2>Your take</h2><p>{session.mode === 'shadow' ? 'Use headphones and speak along with the reference.' : 'Record your imitation of the selected clip.'}</p></div>
          <button className="button secondary small mic-button" disabled={busy || !!retained} onClick={onSettings}><Mic size={15}/> <span>Microphone</span><ChevronDown size={12}/></button>
        </div>
        <div className={`take-wave-shell ${isCapturing ? 'is-recording' : ''}`}>
          <Waveform variant="live" tone="take" hideGrid peaks={isCapturing ? recorder.peaks : availableTake?.peaks ?? []} duration={availableTake?.duration ?? 1}
            position={!isCapturing && availableTake ? takePlayer.position : undefined} onSeek={!busy && availableTake ? takePlayer.seek : undefined} label="Take waveform timeline"/>
          {!availableTake && !busy && <span className="take-wave-label"><AudioLines size={14}/> Your waveform will appear here</span>}
          {isCapturing && <div className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(recorder.level * 100)}>{Array.from({ length: 8 }, (_, i) => <i key={i} className={recorder.level >= (i + 1) / 9 ? 'lit' : ''}/>)}</div>}
        </div>
        <div className="recording-controls">
          <div className="recording-main">
            {isCapturing ? <><button className="button danger" onClick={() => { player.pause(); recorder.stop(); }}><Square size={14} fill="currentColor"/> Stop</button><button className="icon-btn transport-secondary" aria-label={recorder.phase === 'paused' ? 'Resume recording' : 'Pause recording'} onClick={holdRecording}>{recorder.phase === 'paused' ? <Play size={17}/> : <Pause size={17}/>}</button></>
              : isGuidedListening ? <button className="button secondary" onClick={cancelListening}><Square size={14}/> Cancel guided repeat</button>
              : <button className="button primary record-btn" disabled={busy || !!retained} onClick={() => void startRecording(false)}><span className="record-dot"/> {recorder.phase === 'requesting' ? 'Allow microphone…' : recorder.phase === 'processing' ? 'Preparing take…' : availableTake ? 'Record again' : 'Start recording'}</button>}
            {!busy && availableTake && <button className="icon-btn transport-secondary" aria-label={takePlayer.playing ? 'Pause take' : 'Play take'} onClick={() => {
              if (takePlayer.playing) takePlayer.pause();
              else { player.pause(); void takePlayer.play({ start: 0, end: availableTake.duration }).catch(err => setError(err.message)); }
            }}>{takePlayer.playing ? <Pause size={16}/> : <Play size={16}/>}</button>}
            <span className={`record-clock ${isCapturing ? 'hot' : ''}`}><Clock3 size={14}/>{timeLabel(isCapturing ? recorder.elapsed : availableTake?.duration ?? 0)}</span>
          </div>
          <button className="button secondary compare-btn" disabled={busy || !take || !!retained} onClick={() => take && onCompare(take.id)}><SplitSquareHorizontal size={16}/> Compare takes</button>
        </div>
        {(notice || error || availableTake?.quality || (availableTake && !busy)) && <div className="recording-review">
          {notice && <p className="muted" role="status">{notice}</p>}
          {error && !modal && <p className="notice error" role="alert">{error}</p>}
          {availableTake?.quality && !busy && <p className="notice">{availableTake.quality}</p>}
          {!busy && availableTake && <div className="review-actions">
            {availableTake.draft && <button className="button secondary small" onClick={() => void keepTake()}><Check size={15}/> Save recording</button>}
            {takeUrl && <a className="button ghost small" href={takeUrl} download={`${availableTake.name}.${availableTake.blob.type.includes('mp4') ? 'm4a' : availableTake.blob.type.includes('ogg') ? 'ogg' : 'webm'}`} title="Download take"><Download size={15}/> Download</a>}
            <button className="button ghost small" onClick={() => retained ? setDiscardRetained(true) : onDeleteTake(availableTake)}>{availableTake.draft ? 'Discard' : 'Delete'}</button>
            {step >= reps && nextCue(range) && <button className="button secondary small" onClick={() => { const next = nextCue(range)!; setSelection(next, next); }}><ArrowRight size={15}/> Next sentence</button>}
          </div>}
        </div>}
      </section>

      <aside className="practice-note" aria-label="Studio note">
        <div className="note-top"><span className="note-icon"><Lightbulb size={18} strokeWidth={1.8}/></span><span className="micro-label">STUDIO NOTE</span></div>
        <h2>{drill ? `Drill: ${drill.text}` : modeHints[session.mode].title}</h2><p>{drill ? `${drill.attempts} recorded ${drill.attempts === 1 ? 'attempt' : 'attempts'} · ${Math.min(drill.matched, 5)} of 5 target word matches. Listen, then record each repetition.` : modeHints[session.mode].text}</p>
        {(session.mode === 'repeat' || session.mode === 'memory' || drill) ? <div className="note-actions">
          <button className="text-link" disabled={busy || !!retained} onClick={() => void startRecording(true)}>{step && step < reps ? 'Next guided repetition' : drill ? 'Start guided drill' : 'Start guided repeat'}<ArrowRight size={15}/></button>
          <label className="select-wrap practice-reps" title="Repetitions"><select aria-label="Repetitions" value={reps} disabled={busy} onChange={e => { setReps({ count: Number(e.target.value), clipId: session.clipId }); setStep(0); }}>{REPETITIONS.map(n => <option key={n} value={n}>{n} {n === 1 ? 'rep' : 'reps'}</option>)}</select><ChevronDown size={11}/></label>
        </div> : session.mode === 'loop' ? <div className="note-actions"><button className="text-link" disabled={busy} onClick={() => void toggleReference()}>{player.playing ? 'Pause loop' : 'Play loop'}<ArrowRight size={15}/></button><label className="select-wrap practice-reps"><select aria-label="Repetitions" value={reps} disabled={busy} onChange={e => setReps({ count: Number(e.target.value), clipId: session.clipId })}>{REPETITIONS.map(n => <option key={n} value={n}>{n} {n === 1 ? 'rep' : 'reps'}</option>)}</select><ChevronDown size={11}/></label></div> : <LinkButton onClick={onGuide}>View practice guide</LinkButton>}
        {drill && session.mode === 'loop' && <button className="bare drill-listen" disabled={busy} onClick={() => void toggleReference()}>{player.playing ? <Pause size={14}/> : <Headphones size={14}/>} {player.playing ? 'Pause playback' : 'Listen to the word'}</button>}
        <svg className="note-art" aria-hidden="true" viewBox="0 0 160 104" fill="none"><path d="M2 82c45 4 40-47 60-47s15 53 37 53c23 0 17-78 58-80M2 89c45 4 40-47 60-47s15 53 37 53c23 0 17-78 58-80M2 96c45 4 40-47 60-47s15 53 37 53c23 0 17-78 58-80" stroke="currentColor"/></svg>
      </aside>
    </div>
    <footer className="studio-footer"><span><Headphones size={15}/> Headphones recommended for recording.</span><span><kbd>Space</kbd> Play / pause <i/> <kbd>←</kbd><kbd>→</kbd> Skip <i/> <kbd>R</kbd> Record</span></footer>
    {modal === 'range' && <RangeDialog range={range} duration={source.duration} position={player.position} close={() => setModal(null)} apply={next => { setSelection(next); setModal(null); }}/>}
    {modal === 'edit' && <TranscriptEditor transcript={source.transcript} range={range} duration={source.duration} close={() => setModal(null)} save={async transcript => { await updateSource({ ...source, transcript }); toast('Transcript saved.'); }}/>}
    {modal === 'transcribe' && <Modal title="Generate transcript" description="EchoSpeak will send a mono copy of this reference to OpenAI for speech recognition. Word timings are estimates, not forced alignment. Only continue if you have permission." close={() => setModal(null)} busy={working}>
      {error && <p className="notice error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button secondary" disabled={working} onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={working} onClick={() => void transcribe()}>{working ? 'Transcribing…' : 'Send & transcribe'}</button></div>
    </Modal>}
    {discardRetained && <Confirm title="Discard this take?" message="This take could not be saved locally. Download it first if you want to keep it." action="Discard recording" close={() => setDiscardRetained(false)} confirm={() => { setRetained(undefined); setDiscardRetained(false); setError(''); }}/>}
  </div>;
}

function RangeDialog({ range, duration, position, close, apply }: { range: Range; duration: number; position: number; close: () => void; apply: (range: Range) => void }) {
  const [start, setStart] = useState(range.start.toFixed(2)), [end, setEnd] = useState(range.end.toFixed(2));
  const [error, setError] = useState('');
  function submit() {
    const a = Number(start), b = Number(end);
    if (!start || !end || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > duration + .011 || b - a < .079) { setError(`Choose a valid range within ${duration.toFixed(2)} seconds.`); return; }
    apply(boundedRange({ start: a, end: b }, duration));
  }
  return <Modal title="Edit clip range" description="Choose exactly which part of the original to practise. You can also drag the handles on the waveform." close={close}>
    <form onSubmit={submitWith(submit)}><div className="form-row"><label>Clip start (seconds)<input type="number" step="any" value={start} onChange={e => setStart(e.target.value)} required/></label><label>Clip end (seconds)<input type="number" step="any" value={end} onChange={e => setEnd(e.target.value)} required/></label></div>
      <button type="button" className="button secondary small" onClick={() => { const a = Math.min(position, Math.max(0, duration - 15)); setStart(a.toFixed(2)); setEnd(Math.min(duration, a + 15).toFixed(2)); }}><Crosshair size={15}/> Select 15 seconds</button>
      {error && <p className="notice error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary">Apply clip range</button></div>
    </form>
  </Modal>;
}
