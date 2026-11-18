import { DEFAULT_SESSION, DEFAULT_SETTINGS, SAMPLE, type Clip, type Session, type Settings, type Source, type Speaker, type Take } from './model';

export const DB_NAME = 'echospeak-studio';
export const STORES = ['sources', 'takes', 'speakers', 'clips', 'preferences'] as const;
type Store = typeof STORES[number];
interface Records { sources: Source; takes: Take; speakers: Speaker; clips: Clip; preferences: Session | Settings; }
export type Change = { [S in Store]: { store: S; value: Records[S] } | { store: S; remove: string } }[Store];
export interface Workspace { sources: Source[]; takes: Take[]; speakers: Speaker[]; clips: Clip[]; settings: Settings; session: Session; }
export const INITIAL: Workspace = { sources: [SAMPLE], takes: [], speakers: [], clips: [], session: DEFAULT_SESSION, settings: DEFAULT_SETTINGS };

let pending: Promise<IDBDatabase> | undefined;
function openDB(): Promise<IDBDatabase> {
  if (pending) return pending;
  pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('This browser does not provide local storage for recordings.')); return; }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      for (const name of STORES) open.result.createObjectStore(name, { keyPath: 'id' });
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => { db.close(); pending = undefined; };
      resolve(db);
    };
    open.onerror = () => reject(open.error ?? new Error('Could not open local storage.'));
    open.onblocked = () => reject(new Error('Close other EchoSpeak tabs and try again.'));
  }).catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}

export async function loadWorkspace(): Promise<Workspace> {
  const db = await openDB();
  const tx = db.transaction(STORES as unknown as string[], 'readonly');
  const query = <S extends Store>(name: S) => new Promise<Records[S][]>((resolve, reject) => {
    const req = tx.objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const [sources, takes, speakers, clips, prefs] = await Promise.all([query('sources'), query('takes'), query('speakers'), query('clips'), query('preferences')]);
  if (!sources.some(s => s.id === SAMPLE.id)) sources.push(SAMPLE);
  const session = prefs.find((p): p is Session => p.id === 'session');
  const settings = prefs.find((p): p is Settings => p.id === 'preferences');
  return {
    sources: sources.sort((a, b) => b.created - a.created), takes: takes.sort((a, b) => b.created - a.created),
    speakers, clips: clips.sort((a, b) => b.created - a.created),
    session: session && sources.some(s => s.id === session.sourceId) ? session : DEFAULT_SESSION,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

export async function writeChanges(changes: Change[]) {
  if (!changes.length) return;
  const db = await openDB();
  const tx = db.transaction([...new Set(changes.map(c => c.store))], 'readwrite');
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Changes could not be saved to this browser.'));
  });
  try {
    for (const change of changes) {
      const store = tx.objectStore(change.store);
      if ('remove' in change) store.delete(change.remove);
      else store.put(change.value);
    }
  } catch (err) {
    tx.abort();
    await done.catch(() => undefined);
    throw err;
  }
  await done;
}

export async function clearWorkspace() {
  const db = await openDB();
  const tx = db.transaction(STORES as unknown as string[], 'readwrite');
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Could not remove data.'));
    for (const store of STORES) tx.objectStore(store).clear();
  });
}
