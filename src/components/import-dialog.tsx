'use client';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, FileAudio, Link2, Mic, Square, UploadCloud, ShieldCheck, LoaderCircle } from 'lucide-react';
import { fetchDirectMedia, IMPORT_ACCEPT, prepareImport } from '@/lib/media';
import { type Settings, type Source, timeLabel, uid } from '@/lib/model';
import { useRecorder } from '@/lib/use-recorder';
import { useMediaURL } from '@/lib/use-player';
import { Modal, submitWith } from './ui';

type Tab = 'file' | 'url' | 'mic';
const tabs = [{ id: 'file', label: 'Local file', Icon: FileAudio }, { id: 'url', label: 'Media URL', Icon: Link2 }, { id: 'mic', label: 'Microphone', Icon: Mic }] as const;

export function ImportDialog({ settings, speakerId, close, onImport }: { settings: Settings; speakerId?: string; close: () => void; onImport: (source: Source) => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('file');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [permitted, setPermitted] = useState(false);
  const [recorded, setRecorded] = useState<Blob>();
  const [name, setName] = useState('');
  const [askingDiscard, setAskingDiscard] = useState<'close' | 'replace'>();
  const picker = useRef<HTMLInputElement>(null);
  const recorder = useRecorder(settings, setError);
  const preview = useMediaURL(recorded);
  const busy = Boolean(status) || recorder.phase !== 'idle';
  const hasRecording = Boolean(recorded) || recorder.phase === 'recording' || recorder.phase === 'processing';
  useEffect(() => {
    if (!hasRecording) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [hasRecording]);
  function requestClose() { if (recorded) setAskingDiscard('close'); else close(); }

  async function add(file: File, title?: string) {
    setError('');
    setStatus('Reading audio and building waveform…'); setProgress(null);
    try {
      const result = await prepareImport(file);
      setStatus('Saving privately to this browser…');
      await onImport(importedSource(result, file.name, title, speakerId));
      close();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not import this recording.'); }
    finally { setStatus(''); }
  }
  async function byURL() {
    setError(''); setStatus('Downloading media…'); setProgress(null);
    try { const file = await fetchDirectMedia(address, setProgress, AbortSignal.timeout(45_000)); await add(file); }
    catch (err) { setStatus(''); setError(err instanceof Error ? err.message : 'Could not access that link.'); }
  }
  async function record() {
    setError('');
    try { const stream = await recorder.acquire(); recorder.start(stream, async value => { setRecorded(value.blob); if (!name) setName('Microphone reference'); }); }
    catch (err) { recorder.cancel(); setError(err instanceof Error ? err.message : 'Could not start the microphone.'); }
  }
  return <Modal title="Import audio" description="Bring a speaker’s recording into your practice studio." close={requestClose} busy={busy}>
    <div className="segmented import-tabs" aria-label="Import method">{tabs.map(({ id, label, Icon }) => <button key={id} className={tab === id ? 'selected' : ''} aria-pressed={tab === id} disabled={busy || !!recorded} onClick={() => { setError(''); setTab(id); }}><Icon size={16}/>{label}</button>)}</div>
    {tab === 'file' && <>
      <input ref={picker} type="file" aria-label="Choose audio or video file" accept={IMPORT_ACCEPT} hidden onChange={e => { const file = e.target.files?.[0]; if (file) void add(file); e.currentTarget.value = ''; }}/>
      <button className={`dropzone ${dragging ? 'dragging' : ''}`} disabled={busy} onClick={() => picker.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={e => { e.preventDefault(); setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (!busy && file) void add(file); }}>
        <span className="drop-icon"><UploadCloud size={25}/></span><strong>Drop an audio or video file here</strong><span>or <b>browse files</b> on your device</span><small>MP3, WAV, M4A, MP4, WebM · up to 80 MB</small>
      </button>
    </>}
    {tab === 'url' && <form className="form-stack" onSubmit={submitWith(() => void byURL())}>
      <label>Direct HTTPS media URL<input type="url" required placeholder="https://example.com/recording.mp3" value={address} onChange={e => setAddress(e.target.value)} disabled={busy}/></label>
      <p className="muted">The host must permit browser access. Links to streaming pages or protected media aren’t supported.</p>
      <label className="checkbox-label"><input type="checkbox" checked={permitted} onChange={e => setPermitted(e.target.checked)} required/>I have permission to use this recording.</label>
      <button className="button primary" disabled={busy || !address || !permitted}><Link2 size={16}/> Import link</button>
    </form>}
    {tab === 'mic' && <div className="form-stack mic-import">
      <div className="mic-import-head"><span className="drop-icon"><AudioLines size={23}/></span><div><strong>Record a reference</strong><p className="muted">Maximum 90 seconds · {timeLabel(recorder.elapsed)}</p></div></div>
      {recorder.phase === 'recording' ? <button className="button danger" onClick={recorder.stop}><Square size={15}/> Stop recording</button>
        : recorded ? <><audio controls src={preview} className="native-audio"/><label>Reference name<input value={name} maxLength={120} onChange={e => setName(e.target.value)}/></label>
          <div className="row-actions"><button className="button secondary" disabled={busy} onClick={() => setAskingDiscard('replace')}>Discard</button><button className="button primary" disabled={!name.trim() || busy} onClick={() => void add(new File([recorded], 'reference.webm', { type: recorded.type }), name)}><PlusIcon/> Add to studio</button></div></>
        : <button className="button primary" disabled={busy} onClick={() => void record()}><Mic size={16}/> {busy ? 'Preparing microphone…' : 'Start microphone'}</button>}
    </div>}
    {askingDiscard && <div className="notice">Discard this unsaved microphone recording?<div className="dialog-actions"><button className="button secondary small" onClick={() => setAskingDiscard(undefined)}>Keep it</button><button className="button danger small" onClick={() => { if (askingDiscard === 'close') close(); else { setRecorded(undefined); setAskingDiscard(undefined); } }}>Discard recording</button></div></div>}
    {status && <div className="import-progress" role="status"><span><LoaderCircle className="spin" size={16}/>{status}</span><progress aria-label="Import progress" max={100} value={progress ?? undefined}/></div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <p className="privacy-note"><ShieldCheck size={16}/> Only import recordings you have permission to use. Your files stay on this device unless you opt into transcription.</p>
  </Modal>;
}
function PlusIcon() { return <FileAudio size={16}/>; }

function importedSource(media: Awaited<ReturnType<typeof prepareImport>>, fileName: string, title?: string, speakerId?: string): Source {
  return { ...media, id: uid(), name: ((title || fileName.replace(/\.[^.]+$/, '')).trim() || 'Untitled reference').slice(0, 120), created: Date.now(), speakerId, collection: 'Imported audio' };
}
