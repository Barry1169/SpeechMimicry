'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { type Cue, type Range, type Transcript, uid } from '@/lib/model';
import { Modal, submitWith } from './ui';

type EditCue = { id: string; text: string; start: string; end: string; original?: Cue };
export function TranscriptEditor({ transcript, range, duration, close, save }: { transcript?: Transcript; range: Range; duration: number; close: () => void; save: (transcript: Transcript) => Promise<void> }) {
  const fresh = () => ({ id: uid(), start: Number(range.start.toFixed(2)).toString(), end: Number(range.end.toFixed(2)).toString(), text: '' });
  const [rows, setRows] = useState<EditCue[]>(() => transcript?.cues.length ? transcript.cues.map(cue => ({ id: cue.id, start: String(cue.start), end: String(cue.end), text: cue.text, original: cue })) : [fresh()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function change(id: string, patch: Partial<EditCue>) { setRows(old => old.map(row => row.id === id ? { ...row, ...patch } : row)); }
  async function apply() {
    setError('');
    const cues: Cue[] = [];
    for (const row of rows) {
      if (!row.text.trim()) continue;
      const start = Number(row.start), end = Number(row.end);
      if (!row.start || !row.end || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + .011) { setError('Each cue needs a start and an end within the recording.'); return; }
      const original = row.original;
      cues.push({ start, end: Math.min(end, duration), text: row.text.trim(), id: row.id,
        words: original?.start === start && original?.end === end && original?.text === row.text.trim() ? original.words : undefined });
    }
    cues.sort((a, b) => a.start - b.start);
    if (cues.some((cue, i) => i > 0 && cue.start < cues[i - 1].end - .011)) { setError('Cue times cannot overlap. Adjust the times, then try again.'); return; }
    setBusy(true);
    try { await save({ cues, origin: cues.some(cue => cue.words?.length) ? 'recognition' : 'manual', language: transcript?.language }); close(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save the transcript.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Edit transcript" description={`Use seconds to time each sentence. Edited words lose their old timecodes. Recording length: ${duration.toFixed(2)}s.`} wide close={close} busy={busy}>
    <form onSubmit={submitWith(() => void apply())}>
      <div className="edit-cues">{rows.map((row, i) => <div className="edit-cue" key={row.id}>
        <div className="edit-cue-top"><strong>Cue {i + 1}</strong><button type="button" className="icon-btn" title="Remove cue" aria-label={`Remove cue ${i + 1}`} onClick={() => setRows(old => old.filter(r => r.id !== row.id))}><Trash2 size={15}/></button></div>
        <textarea aria-label={`Cue ${i + 1} text`} placeholder="Enter a sentence…" rows={2} maxLength={1200} value={row.text} onChange={e => change(row.id, { text: e.target.value })}/>
        <div className="form-row"><label>Start (s)<input aria-label={`Cue ${i + 1} start`} type="number" min="0" max={Math.ceil(duration * 100) / 100} step="any" value={row.start} onChange={e => change(row.id, { start: e.target.value })}/></label><label>End (s)<input aria-label={`Cue ${i + 1} end`} type="number" min="0" max={Math.ceil(duration * 100) / 100} step="any" value={row.end} onChange={e => change(row.id, { end: e.target.value })}/></label></div>
      </div>)}</div>
      <button type="button" className="button secondary small" onClick={() => setRows(old => [...old, fresh()])}><Plus size={14}/> Add cue</button>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save transcript'}</button></div>
    </form>
  </Modal>;
}
