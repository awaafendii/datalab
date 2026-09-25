// Copie le worker de pdf.js dans public/ : Next.js le sert tel quel, sans
// tenter de le minifier (le worker est un module ES que Terser refuse).
// Lancé automatiquement avant `npm run dev` et `npm run build` ; la copie
// suit donc toujours la version installée de pdfjs-dist.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(publicDir, { recursive: true });
copyFileSync(source, join(publicDir, "pdf.worker.min.mjs"));
console.log("pdf.js worker copié dans public/pdf.worker.min.mjs");
