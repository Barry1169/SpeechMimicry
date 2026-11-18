'use client';
import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  Activity, ArrowRight, AudioLines, Bookmark, Clock3, Ellipsis, FileAudio, Flame, FolderOpen, Headphones, Mic, PencilLine, Plus,
  Search, Sparkles, Star, Trash2, Upload, UsersRound,
} from 'lucide-react';
import { localDate, MODE_NAMES, SAMPLE, spanLabel, timeLabel, type Clip, type Source, type Speaker, type Take } from '@/lib/model';
import { categoryAverage, currentStreak, practiceDays } from '@/lib/progress';
import { useMediaURL } from '@/lib/use-player';
import { Empty, LinkButton, PageHeading, PanelHeading } from './ui';
import type { Workspace } from '@/lib/storage';

export function Dashboard({ data, onNew, onContinue, onLibrary, onRecordings, onCompare, onPractice, onProgress }: { data: Workspace; onNew: () => void; onContinue: () => void; onLibrary: () => void; onRecordings: () => void; onCompare: (id: string) => void; onPractice: (source: Source) => void; onProgress: () => void }) {
  const source = data.sources.find(s => s.id === data.session.sourceId) ?? SAMPLE;
  const recent = data.takes.slice(0, 3);
  const latestAssessment = data.takes.find(t => t.report?.metrics.some(m => m.score !== null));
  const seen = [...new Set(data.takes.map(take => data.sources.find(s => s.id === take.sourceId)?.speakerId).filter(Boolean))];
  const recentSpeakers = seen.flatMap(id => data.speakers.filter(s => s.id === id)).slice(0, 3);
  const today = practiceDays(data.takes, 1)[0].seconds;
  const sentences = new Set(data.takes.flatMap(t => data.sources.find(s => s.id === t.sourceId)?.transcript?.cues.filter(c => c.start >= t.range.start - .03 && c.end <= t.range.end + .03).map(c => `${t.sourceId}:${c.id}`) ?? [])).size;
  return <>
    <PageHeading tag="YOUR PRACTICE OVERVIEW" title="Welcome to EchoSpeak" description="A space to listen closely and build the delivery you admire, one line at a time." action={<button className="button primary" onClick={onNew}><Plus size={17}/> Start New Mimicry Session</button>}/>
    <div className="dashboard-hero"><div><div className="micro-label"><AudioLines size={15}/> CONTINUE PRACTISING</div><h2>{source.name}</h2><p>{MODE_NAMES[data.session.mode]} · {spanLabel(data.session.range.end - data.session.range.start)} selected</p><button className="button primary" onClick={onContinue}>Open Practice Studio <ArrowRight size={16}/></button></div><Image src="/studio-reference.jpg" alt="" width={440} height={200}/></div>
    <div className="stats-grid">
      <Stat icon={<Clock3 size={18}/>} title="Practice today" value={spanLabel(today)}/>
      <Stat icon={<Flame size={18}/>} title="Current streak" value={`${currentStreak(data.takes)} ${currentStreak(data.takes) === 1 ? 'day' : 'days'}`}/>
      <Stat icon={<Bookmark size={18}/>} title="Sentences practised" value={String(sentences)}/>
      <Stat icon={<Activity size={18}/>} title="Assessed takes" value={String(data.takes.filter(t => t.report?.metrics.some(m => m.score !== null)).length)}/>
    </div>
    <div className="secondary-grid">
      <section className="panel content-panel"><PanelHeading title="Recent recordings" action={<LinkButton onClick={onRecordings}>All recordings</LinkButton>}/>
        {recent.length ? recent.map(take => <ListLine key={take.id} icon={<Mic size={17}/>} title={take.name} subtitle={`${spanLabel(take.duration)} · ${localDate(take.created)}`} action={<button className="button secondary small" onClick={() => onCompare(take.id)}>Compare</button>}/>) : <Empty icon={Mic} title="No takes yet" message="Your recordings will appear here after your first practice."/>}
      </section>
      <section className="panel content-panel"><PanelHeading title="Recently used speakers" action={<LinkButton onClick={onLibrary}>Speaker library</LinkButton>}/>
        {recentSpeakers.length ? recentSpeakers.map(speaker => <ListLine key={speaker.id} icon={<UsersRound size={17}/>} title={speaker.name} subtitle={speaker.style || speaker.language || 'Personal speaker profile'} action={<button className="button secondary small" onClick={() => { const reference = data.sources.find(s => s.speakerId === speaker.id); if (reference) onPractice(reference); }}>Practise</button>}/>) : <Empty icon={UsersRound} title="Build a personal library" message="Add a speaker and a reference recording to start practising their delivery."/>}
      </section>
      <section className="panel content-panel"><PanelHeading title="Recent assessment" action={<LinkButton onClick={onProgress}>View progress</LinkButton>}/>
        {latestAssessment ? <><p className="muted">{latestAssessment.name} · {localDate(latestAssessment.created)}</p><div className="metric-chips">{latestAssessment.report!.metrics.filter(m => m.score !== null).slice(0, 4).map(m => <span key={m.key}>{m.title} <b>{m.score}</b></span>)}</div></> : <p className="muted">Compare a take to start tracking pace, rhythm, intonation, and pauses separately.</p>}
      </section>
      <section className="panel content-panel"><PanelHeading title="Recommended practice"/><ListLine icon={<Headphones size={17}/>} title="Listen for the pauses" subtitle="Studio reference · a short repeat exercise" action={<button className="button secondary small" onClick={() => onPractice(SAMPLE)}>Open</button>}/></section>
    </div>
  </>;
}

export function Stat({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="panel stat"><span className="list-art">{icon}</span><span>{title}</span><strong>{value}</strong></div>;
}

export function ListLine({ icon, title, subtitle, action, className = '' }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode; className?: string }) {
  return <div className={`list-line ${className}`}><span className="list-art">{icon}</span><div className="list-copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{action && <div className="list-actions">{action}</div>}</div>;
}

export function RecordingsView({ sources, takes, open, compare, onImport, edit, editTake, keep, removeTake, removeSource, favorite }: { sources: Source[]; takes: Take[]; open: (source: Source) => void; compare: (id: string) => void; onImport: () => void; edit: (source: Source) => void; editTake: (take: Take) => void; keep: (take: Take) => void; removeTake: (take: Take) => void; removeSource: (source: Source) => void; favorite: (source: Source) => void }) {
  const [tab, setTab] = useState<'takes' | 'sources'>('takes');
  const [onlyFavorites, setFavorites] = useState(false);
  const [search, setSearch] = useState(''), [collection, setCollection] = useState(''), [preview, setPreview] = useState('');
  const filteredTakes = takes.filter(t => t.name.toLowerCase().includes(search.trim().toLowerCase()) || sources.find(s => s.id === t.sourceId)?.name.toLowerCase().includes(search.trim().toLowerCase()));
  const filteredSources = sources.filter(s => `${s.name} ${s.collection ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()) && (!collection || s.collection === collection) && (!onlyFavorites || s.favorite));
  return <>
    <PageHeading tag="YOUR AUDIO LIBRARY" title="My Recordings" description="Review your takes and organize reference audio saved on this device." action={<button className="button primary" onClick={onImport}><Upload size={16}/> Import audio</button>}/>
    <div className="view-toolbar"><div className="segmented" aria-label="Recording type"><button className={tab === 'takes' ? 'selected' : ''} aria-pressed={tab === 'takes'} onClick={() => { setTab('takes'); setPreview(''); }}>My takes <span>{takes.length}</span></button><button className={tab === 'sources' ? 'selected' : ''} aria-pressed={tab === 'sources'} onClick={() => { setTab('sources'); setPreview(''); }}>References <span>{sources.length}</span></button></div><SearchField text={search} set={setSearch} placeholder="Search recordings…"/>
    {tab === 'sources' && <><select aria-label="Filter collection" value={collection} onChange={e => setCollection(e.target.value)}><option value="">All collections</option>{[...new Set(sources.map(s => s.collection).filter(Boolean))].map(name => <option key={name}>{name}</option>)}</select><button className={`button secondary small ${onlyFavorites ? 'is-on' : ''}`} aria-pressed={onlyFavorites} onClick={() => setFavorites(!onlyFavorites)}><Star size={15}/> Favorites</button></>}</div>
    <section className="panel content-panel recordings-list" aria-label={tab === 'takes' ? 'My takes' : 'References'}>
      {tab === 'takes' && (filteredTakes.length ? filteredTakes.map(take => <div key={take.id} className="list-item">
        <ListLine icon={<Mic size={17}/>} title={take.name} subtitle={`${sources.find(s => s.id === take.sourceId)?.name ?? 'Reference removed'} · ${spanLabel(take.duration)} · ${localDate(take.created)}${take.draft ? ' · Draft (kept locally)' : ''}`} action={<>
          <button className="button secondary small" aria-expanded={preview === take.id} onClick={() => setPreview(old => old === take.id ? '' : take.id)}>{preview === take.id ? 'Hide player' : 'Play'}</button>
          <button className="button secondary small" disabled={!sources.some(s => s.id === take.sourceId)} onClick={() => compare(take.id)}>Compare</button>
          {take.draft && <button className="button secondary small" onClick={() => keep(take)}>Keep</button>}
          <button className="icon-btn" aria-label={`Rename ${take.name}`} onClick={() => editTake(take)}><PencilLine size={15}/></button>
          <button className="icon-btn" aria-label={`Delete ${take.name}`} onClick={() => removeTake(take)}><Trash2 size={16}/></button></>}/>
        {preview === take.id && <Preview media={take.blob} name={take.name}/>}
      </div>) : <Empty icon={Mic} title={search ? 'No matching takes' : 'No recordings yet'} message={search ? 'Try a different keyword.' : 'Record your first take in the Practice Studio.'}/>)}
      {tab === 'sources' && (filteredSources.length ? filteredSources.map(source => <div key={source.id} className="list-item">
        <ListLine icon={<FileAudio size={17}/>} title={source.name} subtitle={`${spanLabel(source.duration)} · ${source.collection ?? 'No collection'}`} action={<>
          <button className={`icon-btn ${source.favorite ? 'saved' : ''}`} aria-label={source.favorite ? 'Unfavorite reference' : 'Favorite reference'} aria-pressed={!!source.favorite} onClick={() => favorite(source)}><Star size={17} fill={source.favorite ? 'currentColor' : 'none'}/></button>
          <button className="button secondary small" aria-expanded={preview === source.id} onClick={() => setPreview(old => old === source.id ? '' : source.id)}>{preview === source.id ? 'Hide player' : 'Preview'}</button>
          <button className="button primary small" onClick={() => open(source)}>Practise</button>
          {source.id !== SAMPLE.id && <details className="popover"><summary className="icon-btn" aria-label="Recording options"><Ellipsis size={18}/></summary><div className="popover-content menu-content"><button onClick={() => edit(source)}><PencilLine size={15}/> Rename & organize</button><button onClick={() => removeSource(source)}><Trash2 size={15}/> Delete reference</button></div></details>}
        </>}/>
        {preview === source.id && <Preview media={source.blob} sourceUrl={source.url} name={source.name}/>}
      </div>) : <Empty icon={FolderOpen} title="No matching references" message="Change your filters or import a new recording."/>)}
    </section>
  </>;
}

function Preview({ media, sourceUrl, name }: { media?: Blob; sourceUrl?: string; name: string }) {
  const src = useMediaURL(media, sourceUrl);
  return <div className="list-preview"><audio controls className="native-audio" src={src} aria-label={`Play ${name}`}/>{src && <a className="button secondary small" href={src} download={media instanceof File ? media.name : `${name}.${sourceUrl?.endsWith('mp3') ? 'mp3' : media?.type.includes('mp4') ? 'm4a' : media?.type.includes('webm') ? 'webm' : media?.type.includes('ogg') ? 'ogg' : 'wav'}`}>Download</a>}</div>;
}

export function SearchField({ text, set, placeholder }: { text: string; set: (s: string) => void; placeholder: string }) {
  return <label className="search-box"><Search size={17}/><input aria-label={placeholder.replace('…', '')} placeholder={placeholder} value={text} onChange={e => set(e.target.value)}/></label>;
}

export function LibraryView({ data, add, edit, favorite, remove, open, importFor, onStyle }: { data: Workspace; add: () => void; edit: (s: Speaker) => void; favorite: (s: Speaker) => void; remove: (s: Speaker) => void; open: (s: Source) => void; importFor: (id: string) => void; onStyle: (s: Source) => void }) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [favorites, setFavorites] = useState(false);
  const speakers = data.speakers.filter(s => (!favorites || s.favorite) && (!filter || s.category === filter) && `${s.name} ${s.description} ${s.category} ${s.language}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <PageHeading tag="REFERENCE LIBRARY" title="Speaker Library" description="Build a personal collection of voices and delivery styles you want to study." action={<button className="button primary" onClick={add}><Plus size={17}/> Add speaker</button>}/>
    <div className="view-toolbar"><SearchField text={search} set={setSearch} placeholder="Search speakers…"/><select aria-label="Speaker category" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All categories</option>{[...new Set(data.speakers.map(s => s.category).filter(Boolean))].map(s => <option key={s}>{s}</option>)}</select><button className={`button secondary ${favorites ? 'is-on' : ''}`} aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Star size={16}/> Favorites</button></div>
    {speakers.length ? <div className="secondary-grid">{speakers.map(s => {
      const sources = data.sources.filter(src => src.speakerId === s.id);
      const ids = new Set(sources.map(src => src.id));
      return <section className="panel content-panel speaker-card" key={s.id}>
        <div className="speaker-header"><SpeakerAvatar speaker={s}/><div className="list-copy"><h2>{s.name}</h2><small>{[s.category, s.language, s.accent].filter(Boolean).join(' · ') || 'Personal speaker profile'}</small></div>
          <button className={`icon-btn ${s.favorite ? 'saved' : ''}`} aria-label={`Favorite ${s.name}`} aria-pressed={s.favorite} onClick={() => favorite(s)}><Star size={17} fill={s.favorite ? 'currentColor' : 'none'}/></button>
          <details className="popover"><summary className="icon-btn" aria-label={`Options for ${s.name}`}><Ellipsis size={20}/></summary><div className="popover-content menu-content"><button onClick={() => edit(s)}><PencilLine size={15}/> Edit speaker</button><button onClick={() => remove(s)}><Trash2 size={15}/> Delete speaker</button></div></details>
        </div>
        {s.description && <p className="muted">{s.description}</p>}{s.style && <p><strong>Speaking style:</strong> {s.style}</p>}{s.notes && <p className="note-inline">{s.notes}</p>}
        <div className="speaker-counts">{sources.length} references · {data.clips.filter(c => ids.has(c.sourceId)).length} saved clips · {data.takes.filter(t => ids.has(t.sourceId)).length} takes</div>
        {sources.map(source => <ListLine key={source.id} icon={<FileAudio size={16}/>} title={source.name} subtitle={timeLabel(source.duration)} action={<><button className="button secondary small" onClick={() => onStyle(source)}>Style profile</button><button className="button primary small" onClick={() => open(source)}>Practise</button></>}/>)}
        <button className="button secondary small align-start" onClick={() => importFor(s.id)}><Plus size={14}/> Add recording</button>
      </section>;
    })}</div> : <div className="panel content-panel"><Empty icon={UsersRound} title={data.speakers.length ? 'No matching speakers' : 'Your library starts with one voice'} message={data.speakers.length ? 'Change your filters to see more profiles.' : 'Add a speaker, then attach recordings you have permission to practise with.'} action={!data.speakers.length && <button className="button primary small" onClick={add}><Plus size={15}/> Add a speaker</button>}/></div>}
  </>;
}

function SpeakerAvatar({ speaker }: { speaker: Speaker }) {
  const src = useMediaURL(speaker.avatar);
  return <span className="speaker-avatar">{src ? <Image src={src} alt="" width={46} height={46} unoptimized/> : speaker.name.split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase()).join('')}</span>;
}

export function SavedView({ data, open, remove, add, onRecordings }: { data: Workspace; open: (clip: Clip) => void; remove: (clip: Clip) => void; add: () => void; onRecordings: () => void }) {
  const [filter, setFilter] = useState<Clip['category'] | ''>(''), [search, setSearch] = useState('');
  const clips = data.clips.filter(c => (!filter || c.category === filter) && `${c.text} ${data.sources.find(s => s.id === c.sourceId)?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const tabs = [{ id: '', label: 'All saved' }, { id: 'sentence', label: 'Sentences' }, { id: 'word', label: 'Word Bank' }, { id: 'clip', label: 'Clips' }] as const;
  return <>
    <PageHeading tag="PRACTICE COLLECTIONS" title="Saved Sentences" description="Return to bookmarked lines, challenging words, and favorite practice clips." action={<button className="button primary" onClick={add}><Plus size={17}/> Add word drill</button>}/>
    <div className="view-toolbar"><div className="segmented" aria-label="Saved item type">{tabs.map(tab => <button key={tab.id} aria-pressed={tab.id === filter} className={tab.id === filter ? 'selected' : ''} onClick={() => setFilter(tab.id)}>{tab.label}</button>)}</div><SearchField text={search} set={setSearch} placeholder="Search saved items…"/></div>
    <section className="panel content-panel">
      {clips.length ? clips.map(clip => <ListLine key={clip.id} icon={clip.category === 'word' ? <Sparkles size={17}/> : <Bookmark size={17}/>} title={clip.text} subtitle={`${data.sources.find(s => s.id === clip.sourceId)?.name ?? 'Missing reference'} · ${timeLabel(clip.start, true)}–${timeLabel(clip.end, true)}${clip.category === 'word' ? ` · ${clip.attempts} attempts · ${Math.min(clip.matched, 5)}/5 word matches` : ''}`} action={<><button className="button primary small" onClick={() => open(clip)}>{clip.category === 'word' ? 'Open drill' : 'Practise'}</button><button className="icon-btn" aria-label={`Remove saved item: ${clip.text}`} onClick={() => remove(clip)}><Trash2 size={16}/></button></>}/>) : <Empty icon={Bookmark} title={data.clips.length ? 'No matching saved items' : 'Keep the lines worth repeating'} message="Use the bookmark next to a transcript cue or save a custom clip from the studio."/>}
    </section>
    <div className="view-foot"><LinkButton onClick={onRecordings}>Browse saved recordings</LinkButton></div>
  </>;
}

export function ProgressView({ data, compare, onPractice }: { data: Workspace; compare: (id: string) => void; onPractice: () => void }) {
  const [days, setDays] = useState(7), [speaker, setSpeaker] = useState('');
  const threshold = new Date(); threshold.setDate(threshold.getDate() - days + 1); threshold.setHours(0, 0, 0, 0);
  const takes = data.takes.filter(t => t.created >= threshold.getTime() && (!speaker || data.sources.find(s => s.id === t.sourceId)?.speakerId === speaker));
  const wordDrillIds = new Set(data.clips.filter(c => c.category === 'word').map(c => c.id));
  const successes = takes.filter(t => t.drillId && wordDrillIds.has(t.drillId) && t.report?.metrics.some(m => m.key === 'words' && m.score === 100)).length;
  const sentenceCount = new Set(takes.flatMap(take => data.sources.find(s => s.id === take.sourceId)?.transcript?.cues
    .filter(c => c.start >= take.range.start - .03 && c.end <= take.range.end + .03).map(c => `${take.sourceId}/${c.id}`) ?? [])).size;
  const points = practiceDays(takes, days), max = Math.max(1, ...points.map(p => p.seconds));
  const summary = [
    { title: 'Transcript word match', value: categoryAverage(takes, 'words') }, { title: 'Pace', value: categoryAverage(takes, 'pace') },
    { title: 'Intonation', value: categoryAverage(takes, 'intonation') }, { title: 'Rhythm', value: categoryAverage(takes, 'rhythm') },
  ];
  return <>
    <PageHeading tag="YOUR DEVELOPMENT" title="Progress & Analytics" description="Track the time you’ve practised and review how separate delivery measures change." action={<button className="button primary" onClick={onPractice}>Back to studio <ArrowRight size={16}/></button>}/>
    <div className="view-toolbar"><div className="segmented"><button aria-pressed={days === 7} className={days === 7 ? 'selected' : ''} onClick={() => setDays(7)}>Last 7 days</button><button aria-pressed={days === 30} className={days === 30 ? 'selected' : ''} onClick={() => setDays(30)}>Last 30 days</button></div><select aria-label="Filter progress by speaker" value={speaker} onChange={e => setSpeaker(e.target.value)}><option value="">All speakers</option>{data.speakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <div className="stats-grid"><Stat icon={<Clock3 size={18}/>} title="Recorded practice" value={spanLabel(takes.reduce((n, t) => n + t.duration, 0))}/><Stat icon={<Flame size={18}/>} title="Current streak (all time)" value={`${currentStreak(data.takes)}d`}/><Stat icon={<Mic size={18}/>} title="Takes captured" value={String(takes.length)}/><Stat icon={<Activity size={18}/>} title="Words in assessed takes" value={String(takes.reduce((n, t) => n + (t.report?.takeWords ?? 0), 0))}/></div>
    <div className="secondary-grid"><section className="panel content-panel"><PanelHeading title="Practice time" description="Recorded speaking time by local calendar day."/><div className={`progress-bars ${days === 30 ? 'dense' : ''}`}>{points.map(p => <div key={p.key} title={`${p.key} · ${spanLabel(p.seconds)}`}><span style={{ height: `${Math.max(p.seconds ? 5 : 2, p.seconds / max * 100)}%` }} className={p.seconds ? 'has-practice' : ''}/>{days === 7 && <small>{p.label}</small>}</div>)}</div></section>
    <section className="panel content-panel"><PanelHeading title="Category averages" description="Compared takes in the selected period. These are not voice-identity scores."/>{summary.map(m => <div className="progress-metric" key={m.title}><span>{m.title}</span><div><i style={{ width: `${m.value ?? 0}%` }}/></div><b>{m.value === null ? '—' : m.value}</b></div>)}</section></div>
    <section className="panel content-panel history-panel"><PanelHeading title="Drill activity" description="Counts in this period. A word drill match is a transcript match, not a pronunciation grade."/>
      <div className="metric-chips"><span>Unique timed sentences <b>{sentenceCount}</b></span><span>Successful word-drill repetitions <b>{successes}</b></span><span>Compared takes <b>{takes.filter(t => t.report?.metrics.some(m => m.score !== null)).length}</b></span></div>
    </section>
    <section className="panel content-panel history-panel"><PanelHeading title="Recording history" description="Open older takes to compare them against their own reference clips."/>{takes.length ? takes.map(take => <ListLine key={take.id} icon={<Mic size={16}/>} title={take.name} subtitle={`${localDate(take.created)} · ${spanLabel(take.duration)}${take.report ? ' · Assessed' : ''}`} action={<button className="button secondary small" onClick={() => compare(take.id)}>Open comparison</button>}/>) : <Empty icon={Activity} title="No practice in this period" message="Record a take and run a comparison to build a history here."/>}</section>
  </>;
}
