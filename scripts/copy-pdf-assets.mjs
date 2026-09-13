import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../public/pdf');
mkdirSync(destination, { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) cpSync(resolve(source, folder), resolve(destination, folder), { recursive: true });
