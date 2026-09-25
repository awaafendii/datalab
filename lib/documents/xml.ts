// Lecteur XML minimal, suffisant pour le WordprocessingML des fichiers .docx.
// Écrit à la main (plutôt que DOMParser) pour fonctionner à l'identique dans
// le navigateur et sous Node, ce qui permet de tester l'extraction sur de
// vrais documents hors navigateur.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!src) return attrs;
  const re = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  return attrs;
}

// Construit l'arbre complet. Tolérant : une balise fermante orpheline est
// ignorée, une balise non fermée est refermée par son parent.
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const re =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[6] !== undefined) {
      top.children.push(decodeEntities(m[6]));
      continue;
    }
    if (m[1] !== undefined) {
      top.children.push(m[1]);
      continue;
    }
    if (m[3] === undefined) continue; // commentaire, instruction, doctype
    if (m[2] === "/") {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[3]) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el: XmlElement = { name: m[3], attrs: parseAttrs(m[4]), children: [] };
    top.children.push(el);
    if (m[5] !== "/") stack.push(el);
  }
  return root;
}

export function isElement(n: XmlNode): n is XmlElement {
  return typeof n !== "string";
}

export function children(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const c of el.children) {
    if (isElement(c) && (name === undefined || c.name === name)) out.push(c);
  }
  return out;
}

export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (isElement(c) && c.name === name) return c;
  return undefined;
}

// Premier descendant portant ce nom (parcours en profondeur).
export function find(el: XmlElement, name: string): XmlElement | undefined {
  for (const c of el.children) {
    if (!isElement(c)) continue;
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

export function attr(el: XmlElement | undefined, name: string): string | undefined {
  return el?.attrs[name];
}
