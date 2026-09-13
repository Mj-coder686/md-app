import type { MarkdownDocument, ReaderSettings, StoredState } from './types';
const STATE_KEY = 'md-reader-state-v1';
const DOCS_DB = 'md-reader-documents';
const STORE = 'documents';
const FILES = 'files';
export const defaultSettings: ReaderSettings = { theme: 'paper', fontStyle: 'sans', fontSize: 17, lineWidth: 'narrow' };
interface StateMeta {
  documents: Array<Omit<MarkdownDocument, 'content' | 'data'>>;
  currentId: string | null;
  settings: ReaderSettings;
}
let saved = new Map<string, { content: string }>();
let queue: Promise<void> = Promise.resolve();
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOCS_DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(FILES)) {
        const files = request.result.createObjectStore(FILES, { keyPath: 'id' });
        const cursor = request.transaction!.objectStore(STORE).openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          if (item.value.data) { files.put({ id: item.value.id, data: item.value.data }); const doc = { ...item.value }; delete doc.data; item.update(doc); }
          item.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function saveMetadata(state: StoredState): void {
  const meta: StateMeta = {
    documents: state.documents.map(({ content: _content, data: _data, ...doc }) => doc),
    currentId: state.currentId, settings: state.settings
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(meta));
}
export async function loadState(): Promise<StoredState> {
  let meta: StateMeta = { documents: [], currentId: null, settings: { ...defaultSettings } };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StateMeta>;
      meta = { documents: Array.isArray(parsed.documents) ? parsed.documents : [], currentId: parsed.currentId ?? null,
        settings: { ...defaultSettings, ...(parsed.settings ?? {}) } };
    }
  } catch { /* recover from the content database below */ }
  const db = await openDatabase();
  const docs = await new Promise<MarkdownDocument[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
  saved = new Map(docs.map(doc => [doc.id, { content: doc.content }]));
  const byId = new Map(docs.map(doc => [doc.id, doc]));
  const metadata = new Map(meta.documents.map(doc => [doc.id, doc]));
  const documents: MarkdownDocument[] = docs.map(doc => ({ ...doc, ...metadata.get(doc.id), kind: doc.kind ?? 'md' }));
  for (const doc of meta.documents) if (!byId.has(doc.id)) documents.push({ ...doc, kind: doc.kind ?? 'md', content: '' });
  return { documents, currentId: meta.currentId, settings: meta.settings };
}
export function saveState(state: StoredState): Promise<void> {
  const docs = state.documents.map(doc => ({ ...doc }));
  const operation = queue.catch(() => {}).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE, FILES], 'readwrite');
        const store = transaction.objectStore(STORE);
        const files = transaction.objectStore(FILES);
        const ids = new Set(docs.map(doc => doc.id));
        for (const doc of docs) {
          const previous = saved.get(doc.id);
          if (!previous || previous.content !== doc.content) { const { data: _data, ...record } = doc; store.put(record); }
          if (doc.data) files.put({ id: doc.id, data: doc.data });
        }
        for (const id of saved.keys()) if (!ids.has(id)) { store.delete(id); files.delete(id); }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('本机存储不可用'));
      });
      saved = new Map(docs.map(doc => [doc.id, { content: doc.content }]));
      // Use live metadata so a completed file write cannot rewind reading progress.
      saveMetadata(state);
    } finally { db.close(); }
  });
  queue = operation;
  return operation;
}

export async function loadDocumentData(id: string): Promise<ArrayBuffer | undefined> {
  const db = await openDatabase();
  return new Promise<ArrayBuffer | undefined>((resolve, reject) => {
    const request = db.transaction(FILES, 'readonly').objectStore(FILES).get(id);
    request.onsuccess = () => resolve(request.result?.data);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}
