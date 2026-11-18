'use client';
import { useEffect, useState } from 'react';
import { Activity, ArrowRight, AudioLines, Check, Clock3, Gauge, Headphones, LoaderCircle, Sparkles, Volume2 } from 'lucide-react';
import { coaching, inspectSignal, type Signal } from '@/lib/analysis';
import { decodeMedia, monoSamples } from '@/lib/media';
import { localDate, spanLabel, type Measurements, type MetricKey, type Mode, type Source, type Take } from '@/lib/model';
import { coversTextRange, splitWords, transcriptInRange } from '@/lib/transcription';
import { Modal, Empty, PageHeading, PanelHeading } from './ui';
import { PitchChart } from './pitch-chart';

const practiceMode: Record<MetricKey, Mode> = { pace: 'repeat', rhythm: 'loop', intonation: 'repeat', pitch: 'repeat', volume: 'repeat', pauses: 'listen', timing: 'shadow', words: 'loop' };
const metricValue = (take: Take, key: MetricKey) => take.report?.metrics.find(m => m.key === key)?.score ?? null;
const exactClip = (a: Take, b: Take) => a.sourceId === b.sourceId && Math.abs(a.range.start - b.range.start) < .06 && Math.abs(a.range.end - b.range.end) < .06;
const fmt = (value?: number, suffix = '', digits = 0) => value === undefined ? '—' : `${Number(value.toFixed(digits))}${suffix}`;

export function CoachView({ take, source, history, onCompare, onPractice }: { take: Take; source: Source; history: Take[]; onCompare: () => void; onPractice: (mode: Mode) => void }) {
  const report = take.report;
  const suggestions = report ? coaching(report) : [];
  const measured = report?.metrics.filter(metric => metric.score !== null) ?? [];
  const earlier = history.filter(t => t.id !== take.id && t.created < take.created && exactClip(take, t) && t.report?.metrics.some(m => m.score !== null)).sort((a, b) => b.created - a.created);
  const previous = earlier[0];
  const trend = previous ? measured.flatMap(metric => {
    const score = metricValue(previous, metric.key);
    return score === null ? [] : [{ label: metric.title, delta: metric.score! - score }];
  }) : [];
  const recurring = suggestions.filter(metric => earlier.filter(t => {
    const score = metricValue(t, metric.key);
    return score !== null && score < 90;
  }).length >= 2);
  const original = report?.original, recorded = report?.recorded;
  return <>
    <PageHeading tag="PRACTICE GUIDANCE" title="AI Mimicry Coach" description="Turn measurable differences into a short practice plan for your next take." action={<button className="button secondary" onClick={onCompare}><AudioLines size={17}/> View comparison</button>}/>
    {!measured.length ? <section className="panel content-panel"><Empty icon={Sparkles} title={report ? 'Not enough audible data' : 'Analyze a take first'} message={report ? 'Try a clearer recording or select a reference with audible speech. No recommendations were inferred from this take.' : `Open ${take.name} in Voice Comparison to calculate delivery measures.`} action={<button className="button primary" onClick={onCompare}>Open comparison</button>}/></section> : <>
      <div className="coach-lead"><span className="note-icon"><Sparkles size={20}/></span><div><div className="micro-label">GUIDANCE FROM YOUR COMPARISON</div><h2>{suggestions[0]?.action ?? 'Repeat the clip at a natural pace.'}</h2><p>{source.name} · {take.name} · {localDate(take.created)}</p></div><button className="button primary" onClick={() => onPractice(suggestions[0] ? practiceMode[suggestions[0].key] : 'repeat')}>Practise this clip <ArrowRight size={16}/></button></div>
      <div className="secondary-grid coach-grid">
        <section className="panel content-panel"><PanelHeading title="Original speaker" description="Measured features of the selected clip." action={<Headphones size={19} className="analysis-icon"/>}/><CoachValues values={original}/></section>
        <section className="panel content-panel"><PanelHeading title="Your performance" description="Measured features of your recording." action={<AudioLines size={19} className="analysis-icon"/>}/><CoachValues values={recorded}/></section>
      </div>
      <section className="panel content-panel history-panel"><PanelHeading title="Targeted practice plan" description="Up to three priorities, ordered by the lowest available category scores. The coach runs locally from these measures."/>
        {suggestions.length ? <div className="practice-plan">{suggestions.map((item, i) => <article key={item.key}><span className="list-art">{String(i + 1).padStart(2, '0')}</span><div><span className="micro-label">{item.title}</span><h3>{item.action}</h3><p>{item.detail}.</p><p>{item.exercise}</p>{recurring.some(m => m.key === item.key) && <p className="recurring"><Activity size={13}/> Also suggested by at least two earlier takes of this clip.</p>}</div><button className="button secondary small" onClick={() => onPractice(practiceMode[item.key])}>Open drill <ArrowRight size={14}/></button></article>)}</div>
        : <p className="notice"><Check size={15}/> No measured category fell below the practice threshold. That doesn’t mean every feature matched. Listen back before choosing what to practise.</p>}
      </section>
      <section className="panel content-panel history-panel"><PanelHeading title="Since your last comparable take" description={previous ? `${previous.name} · ${localDate(previous.created)} · same reference and clip. Scores are estimates, not proof of improvement.` : 'A second analyzed take of the same clip will make changes easier to see.'}/>
        {trend.length ? <div className="metric-chips">{trend.map(t => <span key={t.label}>{t.label} <b>{t.delta > 0 ? '+' : ''}{t.delta}</b></span>)}</div> : <p className="muted">No comparable category scores from an earlier take yet.</p>}
      </section>
    </>}
  </>;
}

function CoachValues({ values }: { values?: Measurements }) {
  const rows = [
    ['Speaking pace', fmt(values?.wpm, ' WPM')], ['Audible span', fmt(values?.span, 's', 1)], ['Median pitch estimate', fmt(values?.hz, ' Hz')],
    ['Pitch variation', fmt(values?.pitchSpan, ' st', 1)], ['Detected pauses', fmt(values?.pauses)], ['Total pause time', fmt(values?.pauseSeconds, 's', 1)],
  ];
  return <div className="coach-values">{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>;
}

export function SpeakingStyle({ source, close }: { source: Source; close: () => void }) {
  const [data, setData] = useState<Signal>();
  const [error, setError] = useState('');
  const { blob, duration, url } = source;
  const window = Math.min(duration, 90);
  useEffect(() => {
    if (window < 12 || (!blob && !url)) return;
    let active = true;
    void decodeMedia(blob ?? url!).then(audio => {
      if (active) setData(inspectSignal(monoSamples(audio, { start: 0, end: window }), audio.sampleRate));
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Analysis could not run.'); });
    return () => { active = false; };
  }, [window, blob, url]);
  const range = { start: 0, end: window };
  const transcript = coversTextRange(source.transcript, range) ? transcriptInRange(source.transcript, range) : [];
  const words = transcript.length ? splitWords(transcript.map(c => c.text).join(' '), source.transcript?.language).length : 0;
  const wpm = words && data?.speech && data.speech.end > data.speech.start ? Math.round(words * 60 / (data.speech.end - data.speech.start)) : undefined;
  const meanPause = data?.pauses.length ? data.pauses.reduce((a, p) => a + p.end - p.start, 0) / data.pauses.length : undefined;
  return <Modal title="Speaking-style profile" description={`${source.name} · Estimates from the first ${spanLabel(window)}. These describe the recording, not the speaker’s identity or accent.`} close={close} wide>
    {window < 12 ? <Empty icon={Activity} title="Choose a longer reference" message="The profile needs at least 12 seconds of audio. You can still compare a short clip in the studio."/>
      : error ? <p className="notice error" role="alert">{error}</p> : !data ? <p className="loading-line"><LoaderCircle size={16} className="spin"/> Running local acoustic analysis…</p>
      : !data.speech || data.voicedTime < 2 ? <Empty icon={Activity} title="Not enough audible activity" message="Choose a clearer recording with a few spoken phrases to profile it."/>
      : <>
        <div className="style-values"><div><Gauge size={16}/><span>Speaking pace</span><b>{fmt(wpm, ' WPM')}</b></div><div><AudioLines size={16}/><span>Pitch span</span><b>{fmt(data.pitchRange ?? undefined, ' st', 1)}</b></div><div><Clock3 size={16}/><span>Average detected pause</span><b>{fmt(meanPause, 's', 2)}</b></div><div><Volume2 size={16}/><span>Median level</span><b>{fmt(data.loudness ?? undefined, ' dBFS')}</b></div></div>
        <PitchChart original={data}/>
        <div className="style-rhythm" aria-label="Relative loudness in 32 time bins">{data.rhythm.map((n, i) => <i key={i} style={{ height: `${Math.max(4, n * 100)}%` }}/>)}</div>
        <p className="metric-caption">The bars illustrate relative loudness as a cue to rhythm. They do not identify stress, articulation, or intent. Speaking pace requires timed transcript text.</p>
      </>}
  </Modal>;
}
