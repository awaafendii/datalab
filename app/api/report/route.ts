// Assistant IA — Phase 2 : route serveur « rapport de synthèse / décision ».
//
// Reçoit un RÉSUMÉ du tableau (stats agrégées + petit échantillon) et renvoie
// un rapport décisionnel structuré (JSON). Les lignes brutes complètes ne sont
// pas envoyées. Même fournisseur et mêmes garde-fous que /api/assistant.

export const runtime = "nodejs";
export const maxDuration = 30;

const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const AI_MODELS = (process.env.AI_MODELS || "openai/gpt-oss-120b,openai/gpt-oss-20b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 25000);
const AI_IS_LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(AI_BASE_URL);

const MAX_BODY_BYTES = 512 * 1024;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      const kept = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }
  return false;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && origin === allowed) return true;
  const host = req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildSystem(): string {
  return [
    "Tu es un analyste qui rédige un rapport de synthèse d'aide à la décision, en français,",
    "à partir d'un résumé statistique d'un tableau de données (tu ne vois qu'un résumé agrégé).",
    "Sois factuel, chiffré, et oriente vers la décision. N'invente aucun chiffre absent du résumé.",
    "",
    "Réponds UNIQUEMENT avec un objet JSON strict (aucun texte avant/après, pas de Markdown) :",
    JSON.stringify({
      title: "titre du rapport",
      overview: "paragraphe de synthèse générale",
      findings: ["constat chiffré 1", "constat chiffré 2"],
      recommendations: ["recommandation actionnable 1", "recommandation 2"],
    }),
  ].join("\n");
}

function buildUser(body: Record<string, unknown>): string {
  return [
    `Titre / sujet : ${String(body.title ?? "")}`,
    body.userContext ? `Contexte de décision : ${String(body.userContext)}` : "",
    `Nombre de lignes : ${Number(body.rowCount ?? 0)}`,
    `Colonnes : ${JSON.stringify(body.columns ?? [])}`,
    `Statistiques numériques : ${JSON.stringify(body.numericSummary ?? [])}`,
    `Répartitions catégorielles : ${JSON.stringify(body.categoricalSummary ?? [])}`,
    `Échantillon : ${JSON.stringify(body.sampleRows ?? [])}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function callModel(model: string, system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (AI_API_KEY) headers.authorization = `Bearer ${AI_API_KEY}`;
    const resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 1500,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`statut ${resp.status} ${detail.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: "Origine non autorisée." }, { status: 403 });
  }
  if (rateLimited(clientIp(req))) {
    return Response.json({ error: "Trop de requêtes. Réessayez dans quelques minutes." }, { status: 429 });
  }
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Requête trop volumineuse." }, { status: 413 });
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Requête trop volumineuse." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (!Array.isArray(body.columns) || body.columns.length === 0) {
    return Response.json({ error: "Aucune donnée fournie." }, { status: 400 });
  }
  if (AI_MODELS.length === 0) {
    return Response.json({ error: "Aucun modèle IA configuré (AI_MODELS vide)." }, { status: 500 });
  }
  if (!AI_IS_LOCAL && !AI_API_KEY) {
    return Response.json(
      { error: "Rapport IA non configuré : clé API manquante (AI_API_KEY) pour le service en ligne." },
      { status: 500 },
    );
  }

  const system = buildSystem();
  const user = buildUser(body);
  const errors: string[] = [];

  for (const model of AI_MODELS) {
    let text: string;
    try {
      text = await callModel(model, system, user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${model}: ${msg.includes("abort") ? "délai dépassé" : msg}`);
      continue;
    }
    const parsed = extractJson(text);
    if (parsed && typeof (parsed as { overview?: unknown }).overview === "string") {
      return Response.json(parsed);
    }
    errors.push(`${model}: rapport illisible`);
  }

  return Response.json(
    { error: `Rapport IA injoignable ou illisible (${AI_BASE_URL}). Détails : ${errors.join(" ; ").slice(0, 300)}` },
    { status: 502 },
  );
}
