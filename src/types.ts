export type Theme = 'paper' | 'light' | 'dark';
export type FontStyle = 'sans' | 'serif';
export type ViewMode = 'read' | 'edit';
export type DocumentKind = 'md' | 'pdf' | 'word';

export interface MarkdownDocument {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  kind?: DocumentKind;
  data?: ArrayBuffer;
  scrollY?: number;
  page?: number;
  pageCount?: number;
  zoom?: number;
  fingerprint?: string;
}

export interface ReaderSettings {
  theme: Theme;
  fontStyle: FontStyle;
  fontSize: number;
  lineWidth: 'narrow' | 'wide';
}

export interface StoredState {
  documents: MarkdownDocument[];
  currentId: string | null;
  settings: ReaderSettings;
}
