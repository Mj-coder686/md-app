/// <reference types="vite/client" />

declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: { externalFileAccess?: boolean }): Promise<{ value: string }>;
}
