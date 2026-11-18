'use client';
import { useState } from 'react';
import { ArrowRight, AudioLines, FileAudio, Plus, Scissors, Search, Upload } from 'lucide-react';
import { type Range, type Source, type Speaker, type Take, timeLabel, uid } from '@/lib/model';
import { Modal, submitWith } from './ui';

export function ChooseSource({ sources, currentId, close, select, add }: { sources: Source[]; currentId: string; close: () => void; select: (source: Source) => void; add: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = sources.filter(s => s.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <Modal title="Choose a reference" description="Open a local recording or bring something new into the studio." close={close}>
    <label className="search-box"><Search size={17}/><input aria-label="Search references" placeholder="Find a reference…" value={search} onChange={e => setSearch(e.target.value)}/></label>
    <div className="reference-picker">{filtered.map(source => <button key={source.id} className="reference-choice" onClick={() => { select(source); close(); }}>
      <span className="list-art"><FileAudio size={18}/></span><span><strong>{source.name}</strong><small>{timeLabel(source.duration)} · {source.collection || 'Local reference'}{source.id === currentId ? ' · In studio' : ''}</small></span><ArrowRight size={17}/>
    </button>)}{!filtered.length && <p className="notice">No matching references.</p>}</div>
    <div className="dialog-actions"><button className="button primary" onClick={add}><Upload size={16}/> Import audio</button></div>
  </Modal>;
}

export function SourceEditor({ source, speakers, close, save }: { source: Source; speakers: Speaker[]; close: () => void; save: (source: Source) => Promise<void> }) {
  const [name, setName] = useState(source.name), [collection, setCollection] = useState(source.collection ?? ''), [speaker, setSpeaker] = useState(source.speakerId ?? '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function apply() {
    if (!name.trim()) { setError('A recording needs a name.'); return; }
    setBusy(true);
    try { await save({ ...source, name: name.trim(), collection: collection.trim() || undefined, speakerId: speaker || undefined }); close(); }
    catch { setError('Could not save these changes.'); } finally { setBusy(false); }
  }
  return <Modal title="Edit reference" description="Organize this audio in your local library." close={close} busy={busy}>
    <form className="form-stack" onSubmit={submitWith(() => void apply())}>
      <label>Recording name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} required/></label>
      <label>Collection<input placeholder="e.g. Podcast delivery" maxLength={60} value={collection} onChange={e => setCollection(e.target.value)}/></label>
      <label>Speaker<select value={speaker} onChange={e => setSpeaker(e.target.value)}><option value="">No speaker assigned</option>{speakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>Save changes</button></div>
    </form>
  </Modal>;
}

export function SpeakerEditor({ speaker, close, save }: { speaker?: Speaker; close: () => void; save: (speaker: Speaker) => Promise<void> }) {
  const [draft, setDraft] = useState<Speaker>(() => speaker ?? { id: uid(), name: '', description: '', language: '', accent: '', style: '', category: '', notes: '', favorite: false });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const change = (key: keyof Speaker, value: string) => setDraft(old => ({ ...old, [key]: value }));
  async function apply() {
    setError(''); if (!draft.name.trim()) { setError('Enter a name for this speaker.'); return; }
    setBusy(true);
    try { await save({ ...draft, name: draft.name.trim() }); close(); }
    catch { setError('Could not save the speaker profile.'); } finally { setBusy(false); }
  }
  return <Modal title={speaker ? 'Edit speaker' : 'Add speaker'} description="Create your own reference profile. Enter language and accent only if you know them." wide close={close} busy={busy}>
    <form className="form-stack" onSubmit={submitWith(() => void apply())}>
      <div className="form-row"><label>Speaker name<input required maxLength={80} value={draft.name} onChange={e => change('name', e.target.value)}/></label><label>Category<input maxLength={60} placeholder="Podcasters, narrators…" value={draft.category} onChange={e => change('category', e.target.value)}/></label></div>
      <div className="form-row"><label>Language<input maxLength={60} value={draft.language} onChange={e => change('language', e.target.value)}/></label><label>Accent (if known)<input maxLength={60} value={draft.accent} onChange={e => change('accent', e.target.value)}/></label></div>
      <label>Speaking style<input maxLength={100} placeholder="Your observation, e.g. measured and warm" value={draft.style} onChange={e => change('style', e.target.value)}/></label>
      <label>Profile image (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPG, PNG or WebP under 2 MB.'); return; }
        setError(''); setDraft(old => ({ ...old, avatar: file }));
      }}/></label>
      <label>Description<textarea rows={2} maxLength={500} value={draft.description} onChange={e => change('description', e.target.value)}/></label>
      <label>Personal notes<textarea rows={2} maxLength={1200} value={draft.notes} onChange={e => change('notes', e.target.value)}/></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy}><Plus size={16}/> {speaker ? 'Save changes' : 'Create speaker'}</button></div>
    </form>
  </Modal>;
}

export function CustomDrill({ sources, initialSource, range, close, save }: { sources: Source[]; initialSource: Source; range: Range; close: () => void; save: (source: Source, range: Range, text: string) => Promise<void> }) {
  const [sourceId, setSourceId] = useState(initialSource.id), [text, setText] = useState('');
  const [start, setStart] = useState(range.start.toFixed(2)), [end, setEnd] = useState(range.end.toFixed(2));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const source = sources.find(s => s.id === sourceId) ?? initialSource;
  async function apply() {
    const a = Number(start), b = Number(end);
    if (!text.trim() || !start || !end || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > source.duration + .011 || b - a < .08) { setError('Enter a word and choose a valid time range.'); return; }
    setBusy(true);
    try { await save(source, { start: a, end: Math.min(b, source.duration) }, text.trim()); close(); }
    catch { setError('Could not save this drill.'); } finally { setBusy(false); }
  }
  return <Modal title="Add a word drill" description="Link a difficult word to the exact portion of a recording you want to repeat." close={close} busy={busy}>
    <form className="form-stack" onSubmit={submitWith(() => void apply())}>
      <label>Word or short phrase<input value={text} onChange={e => setText(e.target.value)} maxLength={90} required/></label>
      <label>Reference recording<select value={sourceId} onChange={e => { setSourceId(e.target.value); setStart('0'); setEnd(Math.min(1, sources.find(s => s.id === e.target.value)?.duration ?? 1).toFixed(2)); }}>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="form-row"><label>Start (s)<input type="number" step="any" min={0} value={start} onChange={e => setStart(e.target.value)} required/></label><label>End (s)<input type="number" step="any" min={0} value={end} onChange={e => setEnd(e.target.value)} required/></label></div>
      <p className="privacy-note"><AudioLines size={16}/> Reference length: {timeLabel(source.duration, true)}</p>
      {error && <p className="notice error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button primary" disabled={busy}><Scissors size={16}/> Save drill</button></div>
    </form>
  </Modal>;
}

export function TakeEditor({ take, close, save }: { take: Take; close: () => void; save: (take: Take) => Promise<void> }) {
  const [name, setName] = useState(take.name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function apply() {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try { await save({ ...take, name: name.trim() }); close(); }
    catch { setError('Could not update the recording name.'); } finally { setBusy(false); }
  }
  return <Modal title="Rename take" description="The audio and its comparison will stay unchanged." close={close} busy={busy}>
    <form className="form-stack" onSubmit={submitWith(() => void apply())}>
      <label>Take name<input required value={name} maxLength={120} onChange={e => setName(e.target.value)}/></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>Save name</button></div>
    </form>
  </Modal>;
}
