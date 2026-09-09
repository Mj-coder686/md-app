import type { MarkdownDocument, ReaderSettings, StoredState } from './types';

const STATE_KEY = 'md-reader-state-v1';
const DOCS_DB = 'md-reader-documents';
const STORE = 'documents';

export const defaultSettings: ReaderSettings = {
  theme: 'paper',
  fontStyle: 'sans',
  fontSize: 17,
  lineWidth: 'narrow'
};

interface StateMeta {
  documents: Array<Omit<MarkdownDocument, 'content'>>;
  currentId: string | null;
  settings: ReaderSettings;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOCS_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadContents(): Promise<MarkdownDocument[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as MarkdownDocument[]);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function loadState(): Promise<StoredState> {
  let meta: StateMeta = { documents: [], currentId: null, settings: { ...defaultSettings } };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StateMeta>;
      meta = {
        documents: Array.isArray(parsed.documents) ? parsed.documents : [],
        currentId: parsed.currentId ?? null,
        settings: { ...defaultSettings, ...(parsed.settings ?? {}) }
      };
    }
  } catch { /* use defaults */ }
  const storedDocs = await loadContents();
  const byId = new Map(storedDocs.map(doc => [doc.id, doc]));
  return {
    documents: meta.documents.map(item => ({ ...item, content: byId.get(item.id)?.content ?? '' })),
    currentId: meta.currentId,
    settings: meta.settings
  };
}

export async function saveState(state: StoredState): Promise<void> {
  const meta: StateMeta = {
    documents: state.documents.map(({ content: _content, ...document }) => document),
    currentId: state.currentId,
    settings: state.settings
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(meta));
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const activeIds = new Set(state.documents.map(doc => doc.id));
    state.documents.forEach(doc => store.put(doc));
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    keys.filter(key => !activeIds.has(String(key))).forEach(key => store.delete(key));
  } catch {
    // Metadata remains usable even if the WebView storage quota is unavailable.
  }
}
