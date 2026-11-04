// Assistant IA — route serveur « planification de transformation ».
//
// Reçoit le SCHÉMA des colonnes + un petit échantillon + la demande en langage
// naturel de l'utilisateur, et renvoie un PLAN de transformation structuré
// (JSON) que DataLab exécute ensuite localement (lib/assistant/execute.ts).
// Les lignes brutes complètes ne sont JAMAIS envoyées — seulement le schéma et
// un échantillon réduit.
//
// Même fournisseur et mêmes garde-fous que /api/context (compatible OpenAI,
// Groq par défaut). Configuration via les mêmes variables d'environnement
// (AI_BASE_URL, AI_MODELS, AI_API_KEY, AI_TIMEOUT_MS).

export const runtime = "nodejs";
export const maxDuration = 30;

const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const AI_MODELS = (process.env.AI_MODELS || "openai/gpt-oss-120b,llama-3.1-8b-instant")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 25000);
const AI_IS_LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(AI_BASE_URL);

const MAX_SAMPLE_ROWS = 12;
const MAX_COLUMNS = 80;
const MAX_CELL_CHARS = 200;
const MAX_BODY_BYTES = 512 * 1024;

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

interface AssistantBody {
  columns?: string[];
  columnTypes?: Record<string, string>;
  sampleRows?: Record<string, unknown>[];
  userRequest?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

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

function truncate(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_CELL_CHARS) {
    return value.slice(0, MAX_CELL_CHARS) + "…";
  }
  return value;
}

function buildSystemPrompt(): string {
  return [
    "Tu es un assistant d'analyse de données tabulaires dans l'application DataLab.",
    "À partir du schéma des colonnes, d'un échantillon de lignes et d'une demande en français,",
    "tu produis UNIQUEMENT un objet JSON strict décrivant un PLAN de transformation à appliquer",
    "sur l'ensemble des données (tu NE renvoies PAS de données, seulement le plan).",
    "",
    "Format EXACT de la réponse (aucun texte avant/après, pas de Markdown) :",
    JSON.stringify(
      {
        title: "titre court du document produit",
        steps: "liste ordonnée d'opérations (voir ci-dessous)",
        explanation: "1 à 3 phrases en français expliquant la transformation",
      },
      null,
      0,
    ),
    "",
    "Opérations autorisées (champ 'op') — n'utilise QUE celles-ci, et UNIQUEMENT des colonnes EXISTANTES :",
    '- {"op":"filter","column":"Col","operator":"=|!=|>|<|>=|<=|contains|in|not_in","value": valeur ou [valeurs]}',
    '- {"op":"select","columns":["Col1","Col2"]}  (choisir/ordonner les colonnes)',
    '- {"op":"rename","renames":[{"from":"Ancien","to":"Nouveau"}]}',
    '- {"op":"derive","name":"Nouvelle colonne","formula":"[Col A] / [Col B] * 100"}  (formule: + - * / ( ) et [nom de colonne] entre crochets)',
    '- {"op":"sort","by":[{"column":"Col","dir":"asc|desc"}]}',
    '- {"op":"group_aggregate","group_by":["Col"],"measures":[{"column":"Montant","agg":"sum|avg|median|min|max|count|count_distinct","as":"Nom résultat"}]}',
    '- {"op":"limit","n":10}',
    "",
    "Règles : utilise les noms de colonnes EXACTEMENT comme dans la liste « Noms EXACTS des colonnes »,",
    "sans JAMAIS y ajouter le type ni de parenthèses (écris \"Service\", pas \"Service (texte)\"). Pour une colonne calculée,",
    "référence toujours les colonnes entre crochets. Si la demande est ambiguë, choisis l'interprétation",
    "la plus utile. Réponds en français pour 'title' et 'explanation'.",
  ].join("\n");
}

function buildUserPrompt(body: AssistantBody): string {
  const columns = (body.columns ?? []).slice(0, MAX_COLUMNS);
  const types = body.columnTypes ?? {};
  const sample = (body.sampleRows ?? []).slice(0, MAX_SAMPLE_ROWS).map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row).slice(0, MAX_COLUMNS)) {
      out[String(key).slice(0, MAX_CELL_CHARS)] = truncate(row[key]);
    }
    return out;
  });
  return [
    `Noms EXACTS des colonnes (à reprendre TELS QUELS, sans rien ajouter) : ${JSON.stringify(columns)}`,
    `Types (information seulement, NE PAS inclure dans les noms) : ${JSON.stringify(types)}`,
    `Échantillon (JSON) : ${JSON.stringify(sample)}`,
    "",
    `Demande de l'utilisateur : ${body.userRequest ?? ""}`,
  ].join("\n");
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

async function callModel(
  model: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  user: string,
): Promise<string> {
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
          ...history.slice(-6),
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 1200,
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
  let body: AssistantBody;
  try {
    body = JSON.parse(raw) as AssistantBody;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (!Array.isArray(body.columns) || body.columns.length === 0) {
    return Response.json({ error: "Aucune colonne fournie." }, { status: 400 });
  }
  if (!body.userRequest || !body.userRequest.trim()) {
    return Response.json({ error: "Aucune demande fournie." }, { status: 400 });
  }
  if (AI_MODELS.length === 0) {
    return Response.json({ error: "Aucun modèle IA configuré (AI_MODELS vide)." }, { status: 500 });
  }
  if (!AI_IS_LOCAL && !AI_API_KEY) {
    return Response.json(
      { error: "Assistant IA non configuré : clé API manquante (AI_API_KEY) pour le service en ligne." },
      { status: 500 },
    );
  }

  const system = buildSystemPrompt();
  const user = buildUserPrompt(body);
  const history = Array.isArray(body.history) ? body.history : [];
  const errors: string[] = [];

  for (const model of AI_MODELS) {
    let text: string;
    try {
      text = await callModel(model, system, history, user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${model}: ${msg.includes("abort") ? "délai dépassé" : msg}`);
      continue;
    }
    const parsed = extractJson(text);
    if (parsed && Array.isArray((parsed as { steps?: unknown }).steps)) {
      return Response.json(parsed);
    }
    errors.push(`${model}: plan illisible`);
  }

  return Response.json(
    {
      error:
        `Assistant IA injoignable ou sans plan exploitable (${AI_BASE_URL}). ` +
        `Détails : ${errors.join(" ; ").slice(0, 300)}`,
    },
    { status: 502 },
  );
}
