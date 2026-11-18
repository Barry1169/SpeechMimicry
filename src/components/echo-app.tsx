'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  Activity, AudioLines, Bookmark, CheckCircle2, ChevronRight, CircleAlert, Disc3, Headphones, House, Keyboard, LockKeyhole, Menu, Mic,
  Moon, Settings2, Sparkles, SplitSquareHorizontal, Sun, UsersRound, X, type LucideIcon,
} from 'lucide-react';
import { DEFAULT_SESSION, MODE_NAMES, SAMPLE, boundedRange, uid, type Clip, type Range, type Session, type Source, type Speaker, type Take } from '@/lib/model';
import { clearWorkspace, INITIAL, loadWorkspace, writeChanges, type Change } from '@/lib/storage';
import { Modal, Confirm, Empty, PageHeading } from './ui';
import { ImportDialog } from './import-dialog';
import { ChooseSource, CustomDrill, SourceEditor, SpeakerEditor, TakeEditor } from './workspace-forms';
import { Dashboard, LibraryView, ProgressView, RecordingsView, SavedView } from './workspace-views';
import { SettingsView } from './settings';
import { MODES, Studio } from './studio';
import { ComparisonView, CoachView, SpeakingStyle } from './comparison';

const NAV = [
  { label: 'WORKSPACE', links: [{ id: 'dashboard', title: 'Dashboard', Icon: House }, { id: 'studio', title: 'Practice Studio', Icon: Headphones }, { id: 'compare', title: 'Voice Comparison', Icon: SplitSquareHorizontal }] },
  { label: 'LIBRARY', links: [{ id: 'speakers', title: 'Speaker Library', Icon: UsersRound }, { id: 'recordings', title: 'My Recordings', Icon: Mic }, { id: 'saved', title: 'Saved Sentences', Icon: Bookmark }] },
  { label: 'INSIGHTS', links: [{ id: 'coach', title: 'AI Mimicry Coach', Icon: Sparkles }, { id: 'progress', title: 'Progress & Analytics', Icon: Activity }] },
] as const;
const SETTINGS_LINK = { id: 'settings', title: 'Settings', Icon: Settings2 } as const;
const VIEWS = [...NAV.flatMap(n => [...n.links]), SETTINGS_LINK];
export type ViewId = typeof VIEWS[number]['id'];
type Dialog = { kind: 'import'; speakerId?: string } | { kind: 'source' | 'style'; source: Source } | { kind: 'speaker'; speaker?: Speaker } | { kind: 'take'; take: Take } | { kind: 'choose' | 'guide' | 'keys' | 'word' };
type Confirmation = { title: string; message: string; action?: string; run: () => Promise<void> };

function readView(): ViewId {
  const requested = new URLSearchParams(location.search).get('view');
  return VIEWS.find(v => v.id === requested)?.id ?? 'studio';
}
function route(view: ViewId) { return view === 'studio' ? '/' : `?view=${view}`; }
function applyChange<T extends { id: string }>(old: T[], entry: { value: T } | { remove: string }) {
  if ('remove' in entry) return old.filter(v => v.id !== entry.remove);
  const val = entry.value;
  return old.some(x => x.id === val.id) ? old.map(x => x.id === val.id ? val : x) : [val, ...old];
}

export function EchoApp() {
  const [view, setView] = useState<ViewId>('studio');
  const [workspace, setWorkspace] = useState(INITIAL);
  const [hydrated, setHydrated] = useState(false);
  const [transcription, setTranscription] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [dialog, setDialog] = useState<Dialog>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [notified, setNotified] = useState<{ text: string; error?: boolean }>();
  const [compareId, setCompareId] = useState<string>();
  const [lastCaptured, setLastCaptured] = useState<string>();
  const activeView = useRef<ViewId>('studio');
  const capturing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [startupKey, setStartupKey] = useState(0);
  const notify = useCallback((text: string, error?: boolean) => setNotified({ text, error }), []);
  const markBusy = useCallback((status: boolean) => { capturing.current = status; setBusy(status); }, []);
  const savedClips = useMemo(() => workspace.clips.map(clip => {
    if (clip.category !== 'word') return clip;
    const attempts = workspace.takes.filter(take => take.drillId === clip.id);
    return { ...clip, attempts: attempts.length, matched: attempts.filter(t => t.report?.metrics.some(m => m.key === 'words' && m.score === 100)).length };
  }), [workspace.clips, workspace.takes]);
  const currentSource = workspace.sources.find(s => s.id === workspace.session.sourceId) ?? SAMPLE;
  const currentTake = workspace.takes.find(t => t.id === lastCaptured && t.sourceId === currentSource.id) ?? workspace.takes.find(t => t.sourceId === currentSource.id);
  const assessable = workspace.takes.filter(t => workspace.sources.some(s => s.id === t.sourceId));
  const selectedTake = assessable.find(t => t.id === compareId) ?? assessable[0];
  const selectedReference = workspace.sources.find(s => s.id === selectedTake?.sourceId);

  useEffect(() => {
    let live = true;
    const initial = readView();
    activeView.current = initial;
    // Hydrate the URL and stores from browser-only APIs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(initial);
    void loadWorkspace().then(data => { if (live) setWorkspace(data); }).catch(() => { if (live) notify('Local storage is unavailable. You can still play the studio sample.', true); }).finally(() => { if (live) setHydrated(true); });
    void fetch('/api/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => { if (live && data) setTranscription(Boolean(data.transcription)); }).catch(() => undefined);
    return () => { live = false; };
  }, [notify]);
  useEffect(() => {
    const pop = () => {
      if (capturing.current) { history.replaceState({}, '', route(activeView.current)); notify('Finish or save the current take before leaving the studio.', true); return; }
      const next = readView();
      activeView.current = next; setView(next); setDrawer(false);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [notify]);
  useEffect(() => {
    if (!drawer) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [drawer]);
  useEffect(() => {
    if (!hydrated) return;
    const pref = workspace.settings.theme;
    const system = matchMedia('(prefers-color-scheme: dark)');
    function sync() {
      const real = pref === 'system' ? (system.matches ? 'dark' : 'light') : pref;
      document.documentElement.dataset.theme = real;
      try { localStorage.setItem('echospeak-theme', pref); } catch { /* optional cache */ }
      setThemeMode(real);
    }
    sync(); system.addEventListener('change', sync); return () => system.removeEventListener('change', sync);
  }, [workspace.settings.theme, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => { void writeChanges([{ store: 'preferences', value: workspace.session }]).catch(() => undefined); }, 260);
    return () => clearTimeout(timeout);
  }, [hydrated, workspace.session]);
  useEffect(() => {
    if (!notified) return;
    const dismiss = setTimeout(() => setNotified(undefined), 4500);
    return () => clearTimeout(dismiss);
  }, [notified]);

  const commit = useCallback(async (...changes: Change[]) => {
    await writeChanges(changes);
    setWorkspace(old => {
      const next = { ...old };
      for (const entry of changes) {
        if (entry.store === 'sources') next.sources = applyChange(next.sources, entry);
        else if (entry.store === 'takes') next.takes = applyChange(next.takes, entry);
        else if (entry.store === 'speakers') next.speakers = applyChange(next.speakers, entry);
        else if (entry.store === 'clips') next.clips = applyChange(next.clips, entry);
        else if (entry.store === 'preferences' && 'value' in entry) {
          if (entry.value.id === 'session') next.session = entry.value;
          else next.settings = entry.value;
        }
      }
      return next;
    });
  }, []);
  const updateSession = useCallback((session: Session) => setWorkspace(old => ({ ...old, session })), []);
  function navigate(next: ViewId, event?: MouseEvent<HTMLAnchorElement>) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    event?.preventDefault();
    if (capturing.current && next !== activeView.current) { notify('Finish or save the current take before leaving the studio.', true); return; }
    setDrawer(false);
    if (next !== activeView.current) {
      history.pushState({}, '', route(next));
      activeView.current = next;
      setView(next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  function openSource(source: Source, range?: Range, mode: Session['mode'] = 'repeat', clipId?: string) {
    const selected = range ?? (source.id === SAMPLE.id ? DEFAULT_SESSION.range : { start: 0, end: Math.min(15, source.duration) });
    updateSession({ id: 'session', sourceId: source.id, range: boundedRange(selected, source.duration), mode, clipId });
    if (view === 'studio' && currentSource.id === source.id) setStartupKey(key => key + 1);
    navigate('studio');
  }
  function openClip(clip: Clip) {
    const reference = workspace.sources.find(s => s.id === clip.sourceId);
    if (!reference) { notify('This saved clip no longer has a reference recording.', true); return; }
    openSource(reference, clip, clip.category === 'word' ? 'loop' : 'repeat', clip.id);
  }
  function openCompare(id: string) { setCompareId(id); navigate('compare'); }
  function openCoach(id: string) { setCompareId(id); navigate('coach'); }
  async function saveClip(source: Source, range: Range, text: string, category: Clip['category']) {
    if (workspace.clips.some(c => c.sourceId === source.id && c.category === category && Math.abs(c.start - range.start) < .02 && Math.abs(c.end - range.end) < .02 && (category !== 'word' || c.text.toLowerCase() === text.toLowerCase()))) { notify('This section is already saved.'); return; }
    await commit({ store: 'clips', value: { id: uid(), start: range.start, end: range.end, sourceId: source.id, category, text, created: Date.now(), attempts: 0, matched: 0 } });
    notify(category === 'word' ? 'Drill saved to Word Bank.' : 'Added to Saved Sentences.');
  }
  function saveStudioClip(range: Range, text: string, category: Clip['category']) { void saveClip(currentSource, range, text, category).catch(() => notify('Could not save this clip.', true)); }
  async function storeTake(take: Take, captured?: boolean) {
    await commit({ store: 'takes', value: take });
    if (captured) { setLastCaptured(take.id); setCompareId(take.id); }
  }
  function confirmDeleteTake(take: Take) {
    setConfirmation({ title: take.draft ? 'Discard this take?' : 'Delete this recording?', message: 'This will remove its audio and assessment from this device. The reference will not be changed.', action: take.draft ? 'Discard recording' : 'Delete recording', run: async () => {
      await commit({ store: 'takes', remove: take.id }); notify('Take removed from this device.');
    } });
  }
  function confirmDeleteSource(source: Source) {
    const count = workspace.takes.filter(t => t.sourceId === source.id).length;
    setConfirmation({ title: 'Delete this reference?', message: `“${source.name}” and any saved clips will be removed. ${count ? `${count} personal ${count === 1 ? 'take will' : 'takes will'} stay in My Recordings but cannot be compared to this reference.` : 'This cannot be undone.'}`, run: async () => {
      await commit({ store: 'sources', remove: source.id }, ...workspace.clips.filter(c => c.sourceId === source.id).map(c => ({ store: 'clips', remove: c.id }) as Change),
        ...workspace.takes.filter(t => t.sourceId === source.id).map(t => ({ store: 'takes', value: { ...t, report: undefined, referenceText: undefined } }) as Change));
      if (workspace.session.sourceId === source.id) updateSession(DEFAULT_SESSION);
      notify('Reference deleted.');
    } });
  }
  function confirmDeleteSpeaker(speaker: Speaker) {
    setConfirmation({ title: 'Delete this speaker?', message: `“${speaker.name}” and their notes will be deleted. Reference audio and takes stay in My Recordings.`, run: async () => {
      await commit({ store: 'speakers', remove: speaker.id }, ...workspace.sources.filter(s => s.speakerId === speaker.id).map(s => ({ store: 'sources', value: { ...s, speakerId: undefined } }) as Change));
      notify('Speaker deleted.');
    } });
  }
  function confirmClear() {
    setConfirmation({ title: 'Delete all local data?', message: 'This will remove every recording, take, profile, bookmark and preference saved by EchoSpeak in this browser. Download anything you want to keep first.', action: 'Delete all data', run: async () => {
      await clearWorkspace(); setWorkspace(INITIAL); setStartupKey(n => n + 1); setCompareId(undefined); setLastCaptured(undefined); notify('Local workspace cleared.');
    } });
  }
  function runConfirmation() {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true);
    void confirmation.run().then(() => setConfirmation(undefined)).catch(() => notify('Could not remove data from browser storage.', true)).finally(() => setConfirmBusy(false));
  }
  const setImport = () => setDialog({ kind: 'import' });
  const chooseReference = () => setDialog({ kind: 'choose' });
  const viewName = VIEWS.find(v => v.id === view)!.title;
  function navLink(item: { id: ViewId; title: string; Icon: LucideIcon }) {
    const { id, title, Icon } = item;
    return <a key={id} href={route(id)} className={`nav-link ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={event => navigate(id, event)}><Icon size={17} strokeWidth={1.75}/><span>{title}</span></a>;
  }
  function themeToggle() {
    const next = themeMode === 'dark' ? 'light' : 'dark';
    void commit({ store: 'preferences', value: { ...workspace.settings, theme: next } }).catch(() => { document.documentElement.dataset.theme = next; setThemeMode(next); });
  }

  return <div className="app-shell" data-ready={hydrated}>
    {drawer && <button className="drawer-backdrop" onClick={() => setDrawer(false)} aria-label="Close navigation"/>}
    <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Workspace sidebar">
      <Link className="brand" href="/" onClick={event => navigate('studio', event)} aria-label="EchoSpeak Practice Studio"><span className="brand-icon"><AudioLines size={23} strokeWidth={1.85}/></span><span><span className="brand-name">EchoSpeak</span><span className="brand-sub">MIMICRY STUDIO</span></span></Link>
      <button className="icon-btn mobile-close" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={18}/></button>
      <nav className="sidebar-nav" aria-label="Main navigation">{NAV.map(group => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.links.map(navLink)}</div>)}</nav>
      <div className="sidebar-bottom">
        {navLink(SETTINGS_LINK)}
        <button className="nav-link" onClick={themeToggle}>{themeMode === 'light' ? <Moon size={17} strokeWidth={1.75}/> : <Sun size={17} strokeWidth={1.75}/>}<span>{themeMode === 'light' ? 'Dark mode' : 'Light mode'}</span></button>
        <div className="local-workspace"><span className="local-icon"><Disc3 size={17} strokeWidth={1.7}/></span><div><strong>Personal studio</strong><small>Stored on this device</small></div><LockKeyhole size={13} className="local-lock"/></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-crumb"><button className="icon-btn mobile-menu" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}><Menu size={21}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{viewName}</strong></div><div className="topbar-actions"><button className="shortcut" aria-label="Keyboard shortcuts" onClick={() => setDialog({ kind: 'keys' })}><Keyboard size={16}/><span>Shortcuts</span></button><button className="avatar-top" aria-label="Personal studio settings" title="Personal studio settings" onClick={() => navigate('settings')}>ES</button></div></header>
      <main className="main-content" id="main-content">
        <Studio key={startupKey} visible={view === 'studio'} source={currentSource} take={currentTake} session={workspace.session} settings={workspace.settings} clips={savedClips} transcription={transcription}
          onSession={updateSession} updateSource={source => commit({ store: 'sources', value: source })} storeTake={storeTake} onSaveClip={saveStudioClip} onImport={setImport} onChoose={chooseReference} onEditSource={() => setDialog({ kind: 'source', source: currentSource })} onStyle={() => setDialog({ kind: 'style', source: currentSource })}
          onCompare={openCompare} onDeleteTake={confirmDeleteTake} onSettings={() => navigate('settings')} onGuide={() => setDialog({ kind: 'guide' })} onBusy={markBusy} toast={notify}/>
        {view === 'dashboard' && <Dashboard data={workspace} onNew={chooseReference} onContinue={() => navigate('studio')} onLibrary={() => navigate('speakers')} onRecordings={() => navigate('recordings')} onCompare={openCompare} onPractice={openSource} onProgress={() => navigate('progress')}/>}
        {view === 'recordings' && <RecordingsView sources={workspace.sources} takes={workspace.takes} open={openSource} compare={openCompare} onImport={setImport} edit={source => setDialog({ kind: 'source', source })} editTake={take => setDialog({ kind: 'take', take })} keep={take => { void storeTake({ ...take, draft: false }).then(() => notify('Recording kept.')).catch(() => notify('Could not keep this recording.', true)); }} removeTake={confirmDeleteTake} removeSource={confirmDeleteSource} favorite={source => { void commit({ store: 'sources', value: { ...source, favorite: !source.favorite } }).catch(() => notify('Could not update favorites.', true)); }}/>}
        {view === 'speakers' && <LibraryView data={workspace} add={() => setDialog({ kind: 'speaker' })} edit={speaker => setDialog({ kind: 'speaker', speaker })} favorite={speaker => { void commit({ store: 'speakers', value: { ...speaker, favorite: !speaker.favorite } }).catch(() => notify('Could not update favorites.', true)); }} remove={confirmDeleteSpeaker} open={openSource} importFor={speakerId => setDialog({ kind: 'import', speakerId })} onStyle={source => setDialog({ kind: 'style', source })}/>}
        {view === 'saved' && <SavedView data={{ ...workspace, clips: savedClips }} open={openClip} remove={clip => setConfirmation({ title: 'Remove from saved items?', message: 'The bookmarked section will be removed. The original recording is unchanged.', action: 'Remove bookmark', run: async () => { await commit({ store: 'clips', remove: clip.id }); notify('Bookmark removed.'); } })} add={() => setDialog({ kind: 'word' })} onRecordings={() => navigate('recordings')}/>}
        {view === 'progress' && <ProgressView data={{ ...workspace, clips: savedClips }} compare={openCompare} onPractice={() => navigate('studio')}/>}
        {view === 'settings' && <SettingsView key={`${startupKey}-${workspace.settings.theme}`} settings={workspace.settings} save={settings => commit({ store: 'preferences', value: settings })} clear={confirmClear} transcription={transcription} toast={notify}/>}
        {(view === 'compare' || view === 'coach') && (!selectedTake || !selectedReference ? <><PageHeading tag={view === 'compare' ? 'DELIVERY ANALYSIS' : 'PRACTICE GUIDANCE'} title={viewName} description="Meaningful feedback starts with a real recording."/><section className="panel content-panel"><Empty icon={view === 'compare' ? AudioLines : Sparkles} title="Record a take to begin" message="Import a reference, select a clip, and capture your imitation in the Practice Studio." action={<button className="button primary" onClick={() => navigate('studio')}>Open Practice Studio</button>}/></section></>
          : view === 'compare' ? <ComparisonView key={selectedTake.id} take={selectedTake} source={selectedReference} takes={assessable} onSelect={setCompareId} save={storeTake} openStudio={() => openSource(selectedReference, selectedTake.range, selectedTake.mode)} onCoach={() => openCoach(selectedTake.id)} settings={workspace.settings} transcription={transcription} onWord={(range, text) => saveClip(selectedReference, range, text, 'word')} toast={notify}/>
          : <CoachView key={selectedTake.id} take={selectedTake} source={selectedReference} history={workspace.takes} onCompare={() => openCompare(selectedTake.id)} onPractice={mode => openSource(selectedReference, selectedTake.range, mode)}/>)}
      </main>
    </div>
    {dialog?.kind === 'import' && !busy && <ImportDialog settings={workspace.settings} speakerId={dialog.speakerId} close={() => setDialog(undefined)} onImport={async source => { await commit({ store: 'sources', value: source }); openSource(source); notify('Reference imported and saved on this device.'); }}/>}
    {dialog?.kind === 'choose' && <ChooseSource sources={workspace.sources} currentId={currentSource.id} close={() => setDialog(undefined)} select={openSource} add={setImport}/>}
    {dialog?.kind === 'source' && <SourceEditor source={dialog.source} speakers={workspace.speakers} close={() => setDialog(undefined)} save={async source => { await commit({ store: 'sources', value: source }); notify('Reference updated.'); }}/>}
    {dialog?.kind === 'speaker' && <SpeakerEditor speaker={dialog.speaker} close={() => setDialog(undefined)} save={async speaker => { await commit({ store: 'speakers', value: speaker }); notify('Speaker profile saved.'); }}/>}
    {dialog?.kind === 'take' && <TakeEditor take={dialog.take} close={() => setDialog(undefined)} save={async value => { await storeTake(value); notify('Recording renamed.'); }}/> }
    {dialog?.kind === 'word' && <CustomDrill sources={workspace.sources} initialSource={currentSource} range={workspace.session.range} close={() => setDialog(undefined)} save={(source, range, text) => saveClip(source, range, text, 'word')}/>}
    {dialog?.kind === 'style' && <SpeakingStyle source={dialog.source} close={() => setDialog(undefined)}/>}
    {dialog?.kind === 'guide' && <Modal title="Find your practice mode" description="Choose one way to study the speaker’s delivery. You can switch modes at any time between takes." close={() => setDialog(undefined)}><div className="guide-list">{MODES.map(({ id, Icon }) => <div className="guide-row" key={id}><Icon size={18}/><div><strong>{MODE_NAMES[id]}</strong>{guideCopy[id]}</div></div>)}</div></Modal>}
    {dialog?.kind === 'keys' && <Modal title="Keyboard shortcuts" description="These shortcuts work in the Practice Studio when focus is not in an input or control." close={() => setDialog(undefined)}><div className="guide-list">{[['Play or pause reference', 'Space'], ['Skip by five seconds', '← / →'], ['Start recording', 'R'], ['Toggle clip loop', 'L'], ['Select a custom waveform range', 'Shift + drag'], ['Select consecutive sentences', 'Shift + click']].map(([label, key]) => <div className="guide-row" key={key}>{label}<kbd>{key}</kbd></div>)}</div></Modal>}
    {confirmation && <Confirm {...confirmation} busy={confirmBusy} confirm={runConfirmation} close={() => setConfirmation(undefined)}/>}
    {notified && <div className={`toast ${notified.error ? 'is-error' : ''}`} role={notified.error ? 'alert' : 'status'}>{notified.error ? <CircleAlert size={17}/> : <CheckCircle2 size={17}/>}<span>{notified.text}</span><button className="icon-btn" aria-label="Dismiss notification" onClick={() => setNotified(undefined)}><X size={15}/></button></div>}
  </div>;
}

const guideCopy = {
  listen: 'Replay the reference and mark the phrases that need another listen.',
  shadow: 'Start recording to play and speak at the same time. Use headphones.',
  repeat: 'Start a guided repeat to hear the clip, then record your response automatically. Review each repetition.',
  memory: 'Hear the example, then repeat it without the transcript.',
  loop: 'Play the current clip for your selected repetition count. The next sentence is queued afterward.',
};
