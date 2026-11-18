'use client';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, AudioLines, BookmarkPlus, Check, Clock3, Gauge, Headphones, Info, LoaderCircle, Mic, MoveHorizontal,
  Pause, PencilLine, Play, Sparkles, Volume2, Waves,
} from 'lucide-react';
import { boundedRange, clamp, localDate, spanLabel, timeLabel, type Cue, type Metric, type Range, type Settings, type Source, type Take, type Transcript } from '@/lib/model';
import { compareSignals, inspectSignal, tokens, type Signal, type Token, type WordPair } from '@/lib/analysis';
import { decodeMedia, envelope, monoSamples, wavFromBuffer } from '@/lib/media';
import { coversTextRange, requestTranscript, transcriptInRange } from '@/lib/transcription';
import { useMediaURL, usePlayer } from '@/lib/use-player';
import { Modal, PageHeading, PanelHeading } from './ui';
import { PitchChart } from './pitch-chart';
import { TranscriptEditor } from './transcript-editor';
import { Waveform } from './waveform';

export { CoachView, SpeakingStyle } from './coach';

type Props = { take: Take; source: Source; takes: Take[]; onSelect: (id: string) => void; save: (take: Take) => Promise<void>; openStudio: () => void; onCoach: () => void; settings: Settings; transcription: boolean; onWord: (range: Range, text: string) => Promise<void>; toast: (text: string, error?: boolean) => void; };
type Signals = { a: Signal; b: Signal; peaks: number[]; takeBlob: Blob; sourceId: string };
const scoreIcons = { pace: Gauge, rhythm: Waves, intonation: Activity, pitch: AudioLines, volume: Volume2, pauses: Pause, timing: MoveHorizontal, words: Check };

function wordTokens(cues: Cue[], language?: string): Token[] { return cues.flatMap(c => tokens(c.text, c.words, language)); }
function pauseTime(signal: Signal) { return signal.pauses.reduce((n, p) => n + p.end - p.start, 0); }

export function ComparisonView({ take, source, takes, onSelect, save, openStudio, onCoach, settings, transcription, onWord, toast }: Props) {
  const { blob: refBlob, url: refUrl, id: sourceId } = source;
  const { start, end } = take.range;
  const { blob: takeBlob } = take;
  const [clipSignals, setSignals] = useState<Signals>();
  const [problem, setProblem] = useState('');
  const [modal, setModal] = useState<'edit' | 'transcribe'>();
  const [waiting, setWaiting] = useState(false);
  const [problemSTT, setProblemSTT] = useState('');
  const signals = clipSignals?.sourceId === sourceId && clipSignals?.takeBlob === takeBlob ? clipSignals : undefined;
  const referenceCues = useMemo(() => take.referenceText ? [{ id: 'word-drill', start, end, text: take.referenceText, words: [{ start, end, text: take.referenceText }] }] : transcriptInRange(source.transcript, { start, end }), [source.transcript, start, end, take.referenceText]);
  const takeCues = take.transcript?.cues;
  const referenceTokens = useMemo(() => {
    if (!take.referenceText && !coversTextRange(source.transcript, { start, end })) return undefined;
    return wordTokens(referenceCues, source.transcript?.language);
  }, [referenceCues, start, end, take.referenceText, source.transcript]);
  const takeTokens = useMemo(() => takeCues?.length ? wordTokens(takeCues, take.transcript?.language) : undefined, [takeCues, take.transcript?.language]);
  const report = useMemo(() => signals ? compareSignals(signals.a, signals.b, referenceTokens, takeTokens, take.referenceDelay) : undefined, [signals, referenceTokens, takeTokens, take.referenceDelay]);

  useEffect(() => {
    let active = true;
    if (!refBlob && !refUrl) return;
    void Promise.all([decodeMedia(refBlob ?? refUrl!), decodeMedia(takeBlob)]).then(([reference, mine]) => {
      if (!active) return;
      const original = monoSamples(reference, { start, end }), captured = monoSamples(mine);
      setSignals({ a: inspectSignal(original, reference.sampleRate), b: inspectSignal(captured, mine.sampleRate), peaks: envelope(original), takeBlob, sourceId });
    }).catch(err => { if (active) setProblem(err instanceof Error ? err.message : 'Audio analysis could not finish.'); });
    return () => { active = false; };
  }, [refBlob, refUrl, start, end, takeBlob, sourceId]);

  const persistReport = useEffectEvent(() => {
    if (!report) return;
    const { metrics, original, recorded, referenceWords, takeWords } = report.summary;
    const previous = take.report;
    if (previous && JSON.stringify([previous.metrics, previous.original, previous.recorded, previous.referenceWords, previous.takeWords]) === JSON.stringify([metrics, original, recorded, referenceWords, takeWords])) return;
    void save({ ...take, report: report.summary }).catch(() => toast('The analysis is available, but could not be saved to progress.', true));
  });
  useEffect(() => { persistReport(); }, [report]);

  const preview = useMemo(() => {
    return source.peaks.slice(Math.floor(start / source.duration * source.peaks.length), Math.ceil(end / source.duration * source.peaks.length));
  }, [source.peaks, source.duration, start, end]);

  async function saveTranscript(value: Transcript) {
    await save({ ...take, transcript: value, report: undefined });
    toast('Take transcript saved.');
  }
  async function transcribe() {
    setWaiting(true); setProblemSTT('');
    try {
      const audio = await decodeMedia(take.blob);
      await saveTranscript(await requestTranscript(wavFromBuffer(audio, undefined, true), settings.language));
      setModal(undefined);
    } catch (err) { setProblemSTT(err instanceof Error ? err.message : 'Could not recognize the take.'); }
    finally { setWaiting(false); }
  }
  return <>
    <PageHeading tag="DELIVERY ANALYSIS" title="Voice Comparison" description="Listen side by side, then see how your pace, pitch, and pauses differ from the reference." action={<button className="button secondary" onClick={openStudio}><ArrowLeft size={16}/> Back to studio</button>}/>
    <div className="view-toolbar comparison-toolbar">
      <label className="take-select-label">Practice recording<select aria-label="Select a take" value={take.id} onChange={e => onSelect(e.target.value)}>{takes.map(t => <option value={t.id} key={t.id}>{t.name} · {localDate(t.created)}{t.draft ? ' · Draft' : ''}</option>)}</select></label>
      <div className="comparison-actions">{take.draft && <button className="button secondary small" onClick={() => { void save({ ...take, report: report?.summary ?? take.report, draft: false }).then(() => toast('Recording kept in My Recordings.')).catch(() => toast('Could not keep this take.', true)); }}><Check size={15}/> Keep take</button>}
        <button className="button primary" disabled={!take.report} onClick={onCoach}><Sparkles size={16}/> Open Mimicry Coach</button></div>
    </div>
    {take.quality && <p className="notice comparison-notice"><Info size={15}/> {take.quality}</p>}
    <div className="comparison-grid">
      <ComparisonMedia source={source} take={take} peaks={signals?.peaks ?? preview} a={signals?.a} b={signals?.b}
        referenceCues={referenceCues} takeCues={takeCues ?? []} words={report?.words ?? []}
        edit={() => setModal('edit')} transcribe={transcription ? () => { setProblemSTT(''); setModal('transcribe'); } : undefined} onWord={onWord} toast={toast}/>
      <div className="analysis-side">
        <section className="panel content-panel"><PanelHeading title="Pitch contour" description="Fundamental frequency (F0) where it could be estimated." action={<Activity size={19} className="analysis-icon"/>}/>
          {signals ? <><PitchChart original={signals.a} take={signals.b}/><p className="metric-caption">An absolute Hz plot. Intonation scoring uses movement relative to each voice, not matching vocal identity.</p></> : <p className="muted">{problem ? 'Pitch plot unavailable for this audio.' : 'Reading both recordings…'}</p>}
        </section>
        <section className="panel content-panel"><PanelHeading title="Pace & pauses" description="Quiet gaps are shaded on the waveforms." action={<Clock3 size={19} className="analysis-icon"/>}/>
          {signals ? <><div className="measure-table"><span/><strong>Original</strong><strong>My take</strong><span>{report?.wpmA && report.wpmB ? 'Speaking pace' : 'Speech span'}</span><b>{report?.wpmA && report.wpmB ? `${report.wpmA} WPM` : signalSpan(signals.a)}</b><b>{report?.wpmA && report.wpmB ? `${report.wpmB} WPM` : signalSpan(signals.b)}</b><span>Detected pauses</span><b>{signals.a.speech ? signals.a.pauses.length : '—'}</b><b>{signals.b.speech ? signals.b.pauses.length : '—'}</b><span>Total pause time</span><b>{signals.a.speech ? spanLabel(pauseTime(signals.a)) : '—'}</b><b>{signals.b.speech ? spanLabel(pauseTime(signals.b)) : '—'}</b></div>
            <p className="metric-caption">Estimates include internal gaps of at least 180 ms. Background sounds can affect the result.</p></> : <p className="muted">{problem ? 'Acoustic measures unavailable for this audio.' : 'Measuring timing and quiet gaps…'}</p>}
        </section>
      </div>
    </div>
    <section className="panel content-panel delivery-panel">
      <PanelHeading title="Delivery breakdown" description="Separate measures, no overall mimicry score. Expand a card to see how the estimate is calculated."/>
      {problem ? <p className="notice error" role="alert">{problem} Playback may still be available above.</p> : !report ? <p className="loading-line" role="status"><LoaderCircle size={16} className="spin"/> Analyzing this clip on your device…</p> : <div className="delivery-metrics">{report.summary.metrics.map(metric => <MetricCard metric={metric} key={metric.key}/>)}</div>}
      <p className="metric-caption"><Info size={15}/> Phoneme accuracy, articulation, and voice identity are not scored. Word match describes text differences only.</p>
    </section>
    {modal === 'edit' && <TranscriptEditor transcript={take.transcript} range={{ start: 0, end: take.duration }} duration={take.duration} close={() => setModal(undefined)} save={saveTranscript}/>}
    {modal === 'transcribe' && <Modal title="Transcribe your take" description="A mono copy will be sent to OpenAI for speech recognition. Returned word timings are estimates. Confirm before sharing this recording." close={() => setModal(undefined)} busy={waiting}>
      {problemSTT && <p className="notice error" role="alert">{problemSTT}</p>}<div className="dialog-actions"><button className="button secondary" disabled={waiting} onClick={() => setModal(undefined)}>Cancel</button><button className="button primary" disabled={waiting} onClick={() => void transcribe()}>{waiting ? 'Transcribing…' : 'Send & transcribe'}</button></div>
    </Modal>}
  </>;
}

function signalSpan(signal: Signal) { return signal.speech ? spanLabel(signal.speech.end - signal.speech.start) : '—'; }
function MetricCard({ metric }: { metric: Metric }) {
  const Icon = scoreIcons[metric.key];
  return <details className="delivery-metric"><summary><div><Icon size={15}/><strong>{metric.title}</strong><b>{metric.score === null ? '—' : `${metric.score}/100`}</b></div><p>{metric.detail}</p>{metric.score !== null && <div className="metric-track"><i style={{ width: `${metric.score}%` }}/></div>}</summary><p>{metric.method}</p></details>;
}

const playbackModes = [{ id: 'reference', label: 'Original audio' }, { id: 'take', label: 'My recording' }, { id: 'sequence', label: 'Play both sequentially' }, { id: 'sync', label: 'Together' }] as const;
type PlayKind = typeof playbackModes[number]['id'];
const wordLabel: Record<WordPair['status'], string> = { match: 'Matched', missing: 'Missing from take transcript', substitution: 'Different word', extra: 'Extra word' };

function ComparisonMedia({ source, take, peaks, a, b, referenceCues, takeCues, words, edit, transcribe, onWord, toast }: {
  source: Source; take: Take; peaks: number[]; a?: Signal; b?: Signal; referenceCues: Cue[]; takeCues: Cue[]; words: WordPair[]; edit: () => void;
  transcribe?: () => void; onWord: Props['onWord']; toast: Props['toast'];
}) {
  const refDuration = take.range.end - take.range.start;
  const longest = Math.max(refDuration, take.duration);
  const [originalVolume, setOriginalVolume] = useState(.82), [takeVolume, setTakeVolume] = useState(.9);
  const originalUrl = useMediaURL(source.blob, source.url), takeUrl = useMediaURL(take.blob);
  const { position: originalTime, playing: originalPlaying, media: originalRef, pause: pauseOriginal, seek: seekOriginal, play: playOriginal } = usePlayer(originalUrl, 1, originalVolume, take.range.start);
  const { position: takeTime, playing: takePlaying, media: takeRef, pause: pauseMine, seek: seekMine, play: playMine } = usePlayer(takeUrl, 1, takeVolume);
  const [kind, setKind] = useState<PlayKind>('sequence');
  const [isTogether, setTogether] = useState(false);
  const [error, setError] = useState('');
  const clipPeaks = useMemo(() => fitPeaks(peaks, refDuration / longest), [peaks, refDuration, longest]);
  const takePeaks = useMemo(() => fitPeaks(take.peaks, take.duration / longest), [take.peaks, take.duration, longest]);
  const playing = originalPlaying || takePlaying;
  const own = { start: 0, end: take.duration };
  const referenceStart = take.range.start;
  useEffect(() => {
    // The elements are started together; correct visible drift while both are audible.
    if (!isTogether || !originalPlaying || !takePlaying) return;
    const timer = window.setInterval(() => {
      if (!originalRef.current || !takeRef.current) return;
      const expected = originalRef.current.currentTime - referenceStart;
      if (expected < take.duration - .1 && Math.abs(expected - takeRef.current.currentTime) > .14) seekMine(expected);
    }, 120);
    return () => window.clearInterval(timer);
  }, [isTogether, originalPlaying, takePlaying, originalRef, takeRef, referenceStart, take.duration, seekMine]);
  function stop() { pauseOriginal(); pauseMine(); setTogether(false); }
  function failed(err: unknown) { stop(); setError(err instanceof Error ? err.message : 'Playback failed.'); }
  async function play(kindToPlay = kind) {
    setError(''); stop();
    try {
      if (kindToPlay === 'reference') await playOriginal(take.range);
      if (kindToPlay === 'take') await playMine(own);
      if (kindToPlay === 'sequence') await playOriginal(take.range, { restart: true, onEnd: () => { void playMine(own, { restart: true }).catch(failed); } });
      if (kindToPlay === 'sync') { setTogether(true); await Promise.all([playOriginal(take.range, { restart: true }), playMine(own, { restart: true })]); }
    } catch (err) { failed(err); }
  }
  function phrase(or?: Range, mine?: Range) {
    stop(); setError('');
    const t = mine ? boundedRange(mine, take.duration) : undefined;
    if (or) {
      const r = { start: Math.max(or.start, take.range.start), end: Math.min(or.end, take.range.end) };
      if (r.end > r.start) void playOriginal(r, { restart: true, onEnd: t ? () => { void playMine(t, { restart: true }).catch(failed); } : undefined }).catch(failed);
    } else if (t) void playMine(t, { restart: true }).catch(failed);
  }
  function seekBoth(value: number) {
    setError('');
    seekOriginal(take.range.start + clamp(value, 0, refDuration)); seekMine(clamp(value, 0, take.duration));
  }
  function matchingTake(cue: Cue) {
    const points = words.filter(w => w.original?.timing && w.take?.timing && w.original.timing.start >= cue.start - .04 && w.original.timing.end <= cue.end + .04).flatMap(w => w.take?.timing ? [w.take.timing] : []);
    return points.length ? { start: Math.min(...points.map(p => p.start)), end: Math.max(...points.map(p => p.end)) } : undefined;
  }
  return <section className="panel content-panel comparison-media">
    <audio ref={originalRef} src={originalUrl} preload="auto"/><audio ref={takeRef} src={takeUrl} preload="auto"/>
    <PanelHeading title={source.name} description={`Reference clip ${timeLabel(take.range.start, true)} – ${timeLabel(take.range.end, true)}`} action={<span className="badge">A / B REVIEW</span>}/>
    <div className="comparison-transport"><button className="round-play" aria-label={playing ? 'Pause comparison' : 'Play comparison'} onClick={() => { if (playing) stop(); else void play(); }}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button>
      <div className="segmented compare-segments" aria-label="Playback mode">{playbackModes.map(item => <button key={item.id} className={kind === item.id ? 'selected' : ''} aria-pressed={kind === item.id} onClick={() => { stop(); setKind(item.id); }}>{item.label}</button>)}</div>
    </div>
    <div className="compare-wave-label"><span><Headphones size={15}/> Original audio</span><VolumeKnob label="Comparison original volume" value={originalVolume} set={setOriginalVolume}/><small>{spanLabel(refDuration)}</small></div>
    <Waveform variant="compact" peaks={clipPeaks} duration={longest} position={Math.max(0, originalTime - take.range.start)} onSeek={seekBoth} label="Original comparison waveform" pauses={a?.pauses}/>
    <div className="compare-wave-label take-label"><span><Mic size={15}/> My recording</span><VolumeKnob label="Comparison take volume" value={takeVolume} set={setTakeVolume}/><small>{spanLabel(take.duration)}</small></div>
    <Waveform variant="compact" tone="take" peaks={takePeaks} duration={longest} position={takeTime} onSeek={seekBoth} label="Take comparison waveform" pauses={b?.pauses}/>
    {kind === 'sync' && <p className="metric-caption"><Headphones size={14}/> Playback shares a clip-start time. Use headphones to hear both voices clearly.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="comparison-text">
      <PanelHeading title="Transcript alignment" description="Select a timed line or word to hear its available audio." action={<div className="row-actions">{transcribe && <button className="button secondary small" onClick={transcribe}>Transcribe take</button>}<button className="button secondary small" onClick={edit}><PencilLine size={14}/> Edit take text</button></div>}/>
      <div className="transcript-columns">
        <div><h3>REFERENCE</h3>{referenceCues.length ? referenceCues.map(cue => <button className="compare-cue" key={cue.id} onClick={() => phrase(cue, matchingTake(cue))}><Play size={13}/><span>{cue.text}</span></button>) : <p className="muted">No complete timed text in this reference clip. In the studio, add a cue or select a whole sentence.</p>}</div>
        <div><h3>MY TAKE</h3>{takeCues.length ? takeCues.map(cue => <button className="compare-cue" key={cue.id} onClick={() => {
          const matched = words.filter(w => w.take?.timing && w.original?.timing && w.take.timing.start >= cue.start - .04 && w.take.timing.end <= cue.end + .04).flatMap(w => w.original?.timing ? [w.original.timing] : []);
          phrase(matched.length ? { start: Math.min(...matched.map(w => w.start)), end: Math.max(...matched.map(w => w.end)) } : undefined, cue);
        }}><Play size={13}/><span>{cue.text}</span></button>) : <p className="muted">Add what you actually said to compare words. {transcribe ? 'You can also generate a transcript.' : 'Automatic transcription is not configured.'}</p>}</div>
      </div>
      {words.length > 0 && <>
        <div className="align-legend"><span className="word-tag match">Match</span><span className="word-tag missing">Missing</span><span className="word-tag substitution">Changed</span><span className="word-tag extra">Extra</span><span className="word-tag shifted">Estimated time difference</span></div>
        <div className="word-alignment">{words.map(({ original, take: mine, status }, index) => {
          const timed = original?.timing || mine?.timing;
          const delta = original?.timing && mine?.timing ? mine.timing.start - (original.timing.start - take.range.start) : undefined;
          const text = status === 'substitution' ? `${original!.text} → ${mine!.text}` : original?.text ?? mine?.text;
          const label = `${text}: ${wordLabel[status]}${delta !== undefined && Math.abs(delta) > .25 ? `, ${Math.round(Math.abs(delta) * 1000)} ms ${delta < 0 ? 'earlier' : 'later'} from clip start (estimated)` : ''}`;
          const classes = `word-tag ${status}${delta !== undefined && Math.abs(delta) > .25 ? ' shifted' : ''}`;
          return timed ? <button className={classes} key={index} title={`${label}. Play available timed audio.`} aria-label={label} onClick={() => phrase(original?.timing, mine?.timing)}>{text}</button> : <span key={index} className={classes} title={label} aria-label={label}>{text}</span>;
        })}</div>
        <p className="metric-caption">Recognition timestamps are estimates, not forced alignment. Word differences may be recognition errors. They do not prove a pronunciation problem.</p>
        {words.some(w => w.status !== 'match' && w.original) && <div className="word-drills"><h3>Words to review</h3>{words.filter(w => w.status !== 'match' && w.original).slice(0, 6).map((w, i) => <div className="drill-row" key={i}><div><strong>{w.original!.text}</strong><small>{wordLabel[w.status]}{w.take ? ` · Take text: ${w.take.text}` : ''}</small></div>
          {w.original!.timing && <><button className="icon-btn" aria-label={`Listen to ${w.original!.text}`} onClick={() => phrase(w.original!.timing, w.take?.timing)}><Play size={15}/></button><button className="icon-btn" aria-label={`Save ${w.original!.text} to Word Bank`} onClick={() => { void onWord(w.original!.timing!, w.original!.text).catch(() => toast('Could not save the word drill.', true)); }}><BookmarkPlus size={16}/></button></>}
        </div>)}<p className="metric-caption">Listen and verify the text first. Without word timing, create a manual drill in Saved Sentences. Phonetic feedback is not available.</p></div>}
      </>}
    </div>
  </section>;
}

function fitPeaks(peaks: number[], fraction: number) {
  if (fraction >= .998 || !peaks.length) return peaks;
  return Array.from({ length: 320 }, (_, i) => i / 320 < fraction ? (peaks[Math.min(peaks.length - 1, Math.floor(i / 320 / fraction * peaks.length))] ?? 0) : 0);
}
function VolumeKnob({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  return <details className="popover comparison-volume"><summary aria-label={label} className="icon-btn" title={label}><Volume2 size={15}/></summary><div className="popover-content volume-content"><label>Volume <span>{Math.round(value * 100)}%</span><input type="range" aria-label={label} min={0} max={1} step={.01} value={value} onChange={e => set(Number(e.target.value))}/></label></div></details>;
}
