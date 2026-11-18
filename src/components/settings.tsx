'use client';
import { useEffect, useState } from 'react';
import { AudioLines, Mic, Monitor, Moon, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { REPETITIONS, SPEEDS, type Settings } from '@/lib/model';
import { PageHeading, PanelHeading, submitWith } from './ui';

const themes = [{ id: 'light', label: 'Light', Icon: Sun }, { id: 'dark', label: 'Dark', Icon: Moon }, { id: 'system', label: 'System', Icon: Monitor }] as const;
const languages = [['', 'Auto-detect'], ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'], ['ar', 'Arabic'], ['zh', 'Chinese']];

export function SettingsView({ settings, save, clear, transcription, toast }: { settings: Settings; save: (s: Settings) => Promise<void>; clear: () => void; transcription: boolean; toast: (s: string, error?: boolean) => void }) {
  const [form, setForm] = useState(settings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    const list = () => { void navigator.mediaDevices?.enumerateDevices().then(items => setDevices(items.filter(d => d.kind === 'audioinput' && !!d.deviceId))).catch(() => undefined); };
    list(); navigator.mediaDevices?.addEventListener('devicechange', list);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', list);
  }, []);
  function field<K extends keyof Settings>(name: K, value: Settings[K]) { setForm(f => ({ ...f, [name]: value })); }
  async function refresh() {
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && !!d.deviceId)); }
      finally { stream.getTracks().forEach(track => track.stop()); }
    } catch { toast('Could not list microphones. Allow microphone access on this site and try again.', true); }
    finally { setScanning(false); }
  }
  async function apply() {
    setBusy(true);
    try { await save(form); toast('Preferences saved.'); }
    catch { toast('Could not save preferences.', true); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeading tag="YOUR WORKSPACE" title="Settings" description="Make the studio comfortable, set your defaults, and manage private data."/>
    <form className="settings-grid" onSubmit={submitWith(() => void apply())}>
      <section className="panel content-panel"><PanelHeading title="Appearance" description="Choose the studio’s color theme."/>
        <div className="theme-picks" aria-label="Theme">{themes.map(({ id, Icon, label }) => <button type="button" key={id} aria-pressed={form.theme === id} className={form.theme === id ? 'chosen' : ''} onClick={() => field('theme', id)}><Icon size={21}/>{label}</button>)}</div>
      </section>
      <section className="panel content-panel"><PanelHeading title="Practice defaults" description="Applied when you open the studio." action={<AudioLines className="muted" size={21}/>}/>
        <div className="form-row"><label>Playback speed<select value={form.speed} onChange={e => field('speed', Number(e.target.value))}>{SPEEDS.map(n => <option key={n} value={n}>{n === 1 ? '1.0' : n}×</option>)}</select></label><label>Repetitions<select value={form.repetitions} onChange={e => field('repetitions', Number(e.target.value))}>{REPETITIONS.map(n => <option key={n}>{n}</option>)}</select></label></div>
        <label>Transcription language<select value={form.language} onChange={e => field('language', e.target.value)}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </section>
      <section className="panel content-panel"><PanelHeading title="Microphone" description="Change the device and recording quality for future takes." action={<Mic className="muted" size={21}/>}/>
        <div className="form-stack"><label>Input device<select value={form.microphone} onChange={e => field('microphone', e.target.value)}><option value="">System default</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}{form.microphone && !devices.some(d => d.deviceId === form.microphone) && <option value={form.microphone}>Previously selected (unavailable)</option>}</select></label>
        <button type="button" className="button secondary small align-start" disabled={scanning} onClick={() => void refresh()}>{scanning ? 'Checking…' : 'Refresh microphone list'}</button>
        <label>Recording quality<select value={form.quality} onChange={e => field('quality', e.target.value as Settings['quality'])}><option value="high">High · target 128 kbps</option><option value="standard">Standard · target 64 kbps</option></select></label>
        <label className="checkbox-label"><input type="checkbox" checked={form.noiseReduction} onChange={e => field('noiseReduction', e.target.checked)}/> Enable noise reduction when supported</label></div>
      </section>
      <section className="panel content-panel"><PanelHeading title="Data & privacy" description="This is an educational, private, local workspace." action={<ShieldCheck className="muted" size={21}/>}/>
        <p className="muted">Imported audio and takes are stored in this browser. No account, voice cloning, identity matching, or background uploads.</p>
        <p className="muted">{transcription ? 'Cloud transcription is available and asks for consent before any upload. Local deletion cannot remove copies already processed by the provider.' : 'Cloud transcription is not configured. Add timed transcript cues manually to work fully offline.'}</p>
        <button type="button" className="button danger-outline align-start" onClick={clear}><Trash2 size={15}/> Delete all local data</button>
      </section>
      <div className="settings-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</button></div>
    </form>
  </>;
}
