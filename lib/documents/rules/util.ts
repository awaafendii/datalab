import type { Anomaly, AnomalyLocation } from "../types";
import type { DocContext, TableInfo } from "../structure";
import { truncate } from "../text";

export type NewAnomaly = Omit<Anomaly, "id"> & { key: string };

export function anomaly(a: NewAnomaly): Anomaly {
  const { key, ...rest } = a;
  return { id: `${a.rule}:${key}`, ...rest };
}

export function sectionOf(ctx: DocContext, index: number): string {
  return (ctx.pathOf[index] ?? []).map((t) => truncate(t, 70)).join(" › ");
}

export function blockLoc(ctx: DocContext, index: number): AnomalyLocation {
  const b = ctx.blocks[index];
  return {
    section: sectionOf(ctx, index) || undefined,
    page: b?.page,
    blockId: b?.id,
  };
}

export function rowLabel(t: TableInfo, r: number): string {
  const row = t.body[r] ?? [];
  const label = row[t.labelCol] || row.find((c) => c !== "" && !/^\d+([.,]\d+)?\s*%?$/.test(c)) || row[0] || "";
  return truncate(label, 60) || `ligne ${r + 1}`;
}

export function colLabel(t: TableInfo, c: number): string {
  return truncate(t.header[c] || `colonne ${c + 1}`, 60);
}

export function tableLoc(ctx: DocContext, t: TableInfo, r?: number, c?: number): AnomalyLocation {
  return {
    section: t.section || undefined,
    table: truncate(t.title, 110),
    row: r !== undefined ? rowLabel(t, r) : undefined,
    column: c !== undefined ? colLabel(t, c) : undefined,
    sheet: t.block.sheet,
    page: t.block.page,
    blockId: t.block.id,
  };
}

// Au-delà de quelques exemples, une liste devient illisible : on résume.
export function listSome(items: string[], max = 6, sep = " ; "): string {
  if (items.length <= max) return items.join(sep);
  return items.slice(0, max).join(sep) + `${sep}… (+${items.length - max})`;
}
