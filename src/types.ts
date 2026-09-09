export type Theme = 'paper' | 'light' | 'dark';
export type FontStyle = 'sans' | 'serif';
export type ViewMode = 'read' | 'edit';

export interface MarkdownDocument {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
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
