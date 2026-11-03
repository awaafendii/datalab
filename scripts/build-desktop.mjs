// Prépare la sortie Next « standalone » pour l'empaquetage Electron.
//
// `next build` (avec output: "standalone") génère .next/standalone/server.js
// et un node_modules réduit, mais NE copie PAS les fichiers statiques
// (.next/static) ni le dossier public. Ce script complète l'assemblage pour
// que le serveur embarqué serve correctement l'interface hors-ligne.
//
// Lancé automatiquement par `npm run build:desktop`.

import { cp, access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const standalone = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standalone, ".next", "static");
const publicSrc = path.join(root, "public");
const publicDest = path.join(standalone, "public");

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standalone))) {
    console.error(
      "[build-desktop] .next/standalone introuvable. Lance d'abord `npm run build` (output: 'standalone' doit être actif dans next.config.mjs)."
    );
    process.exit(1);
  }

  // .next/static -> .next/standalone/.next/static
  if (await exists(staticSrc)) {
    await rm(staticDest, { recursive: true, force: true });
    await cp(staticSrc, staticDest, { recursive: true });
    console.log("[build-desktop] .next/static copié.");
  } else {
    console.warn("[build-desktop] .next/static absent (inattendu).");
  }

  // public -> .next/standalone/public
  if (await exists(publicSrc)) {
    await rm(publicDest, { recursive: true, force: true });
    await cp(publicSrc, publicDest, { recursive: true });
    console.log("[build-desktop] public/ copié.");
  }

  console.log("[build-desktop] Assemblage standalone terminé.");
}

main().catch((err) => {
  console.error("[build-desktop] Échec :", err);
  process.exit(1);
});
