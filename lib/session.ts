// Mémorisation de la session dans le navigateur (IndexedDB) : fichier chargé,
// réglages et état de chaque feuille, graphiques personnalisés. Les données
// restent sur cet ordinateur, rien n'est envoyé. Les résultats de nettoyage
// et d'analyse ne sont pas stockés : ils sont recalculés à la restauration
// (mêmes données + mêmes réglages = même résultat).
//
// Deux enregistrements : le classeur (lourd, réécrit seulement quand on
// charge un autre fichier) et l'état de travail (léger, réécrit à chaque
// modification).

import type { ChartConfig } from "./charts/types";
import type { CleaningOptions, ContextResult, WorkbookInput } from "./types";

export interface SavedSheet {
  name: string;
  options: CleaningOptions;
  cleaned: boolean;
  aiContext: ContextResult | null;
  charts: ChartConfig[];
}

export interface SavedState {
  version: 1;
  savedAt: string; // ISO
  fileName: string;
  activeIndex: number;
  sheets: SavedSheet[];
}

const DB_NAME = "datalab";
const STORE = "session";
const PREF_KEY = "datalab:memoriser-session";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponible"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB inaccessible"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error("Échec de l'enregistrement"));
      tx.onabort = () => reject(tx.error ?? new Error("Enregistrement interrompu"));
    });
  } finally {
    db.close();
  }
}

export async function saveWorkbook(workbook: WorkbookInput): Promise<void> {
  await run("readwrite", (s) => s.put(workbook, "workbook"));
}

export async function saveState(state: SavedState): Promise<void> {
  await run("readwrite", (s) => s.put(state, "state"));
}

export async function loadSession(): Promise<{ workbook: WorkbookInput; state: SavedState } | null> {
  const workbook = await run<WorkbookInput>("readonly", (s) => s.get("workbook") as IDBRequest<WorkbookInput>);
  const state = await run<SavedState>("readonly", (s) => s.get("state") as IDBRequest<SavedState>);
  if (!workbook || !state || state.version !== 1 || state.fileName !== workbook.fileName) return null;
  if (state.sheets.length !== workbook.sheets.length) return null;
  return { workbook, state };
}

export async function clearSession(): Promise<void> {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    // rien à effacer si IndexedDB est indisponible
  }
}

// Préférence « Mémoriser ma session sur cet ordinateur » (activée par défaut).
export function sessionEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "non";
  } catch {
    return true;
  }
}

export function setSessionEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "oui" : "non");
  } catch {
    // préférence non mémorisée (navigation privée) : sans conséquence
  }
}

// Message lisible pour une erreur d'enregistrement (quota dépassé…).
export function sessionErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "QuotaExceededError") {
    return "Fichier trop volumineux pour être mémorisé dans ce navigateur : il faudra le recharger après une actualisation de la page.";
  }
  return "La session n'a pas pu être mémorisée dans ce navigateur (stockage indisponible ou désactivé).";
}
