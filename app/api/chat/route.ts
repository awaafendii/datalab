// Assistant IA — route conversationnelle (chatbot spécialisé data).
//
// Reçoit le contexte de toutes les feuilles (schéma + stats agrégées +
// échantillon), l'historique et la question. Renvoie une réponse en langage
// naturel à TOUTE question d'analyse de données, et éventuellement un plan de
// tableau à exécuter localement. Tolérant : si le modèle répond en texte brut
// (sans JSON), on l'utilise tel quel comme réponse.
//
// Même fournisseur et garde-fous que les autres routes IA (Groq par défaut).

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

const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT_MAX = 40;
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

interface SheetContext {
  name?: string;
  columns?: string[];
  rowCount?: number;
  numericSummary?: unknown;
  categoricalSummary?: unknown;
  sample?: unknown;
}

function buildSystem(): string {
  return [
    "Tu es un assistant IA spécialisé en ANALYSE DE DONNÉES (chatbot type ChatGPT dédié à la data).",
    "Tu réponds en français à TOUTE question sur les données chargées. Tu n'es PAS limité à des questions prédéfinies.",
    "",
    "On te fournit, pour chaque FEUILLE : le schéma, des STATISTIQUES AGRÉGÉES GLOBALES (somme, moyenne,",
    "min, max, comptes, top catégories) et un petit échantillon. Ces stats globales NE couvrent PAS les",
    "CROISEMENTS précis (ex. moyenne PAR catégorie, filtres combinés, Top N par groupe).",
    "",
    "TOOL-USE : pour obtenir un chiffre EXACT non disponible dans le contexte, tu peux DEMANDER un calcul.",
    "DataLab l'exécute sur TOUTES les données et te renvoie le résultat exact (« Résultats calculés »),",
    "puis tu réponds à partir de ces chiffres.",
    "",
    "À CHAQUE tour, réponds par UN SEUL objet JSON strict (aucun texte autour) :",
    '- Pour demander un calcul : {"action":"compute","sheet":"<nom exact de la feuille>","plan":{"title":"...","steps":[...],"explanation":"..."}}',
    '- Pour la réponse finale (conversationnelle, cite les chiffres) : {"action":"answer","answer":"..."}',
    "",
    "Demande un calcul UNIQUEMENT si nécessaire ; sinon réponds directement avec les stats fournies.",
    "Si des « Résultats calculés » te sont déjà fournis, utilise-les et réponds (action:\"answer\").",
    "N'invente JAMAIS de chiffres.",
    "",
    "Format du plan (colonnes EXISTANTES, noms exacts) — steps = opérations :",
    "filter(column,operator,value) operator= =|!=|>|<|>=|<=|contains|in|not_in ; select(columns[]) ;",
    "rename(renames[{from,to}]) ; derive(name, formula avec [Colonne], + - * / et parenthèses) ;",
    "sort(by[{column,dir}]) ; group_aggregate(group_by[],measures[{column,agg,as}]) agg=sum|avg|median|min|max|count|count_distinct ; limit(n).",
  ].join("\n");
}

function buildUser(sheets: SheetContext[], question: string, toolResults: unknown[]): string {
  const ctx = sheets.map((s) => ({
    feuille: s.name,
    colonnes: s.columns,
    lignes: s.rowCount,
    stats_numeriques: s.numericSummary,
    repartitions: s.categoricalSummary,
    echantillon: s.sample,
  }));
  const parts = [`Contexte des feuilles (JSON) :`, JSON.stringify(ctx)];
  if (Array.isArray(toolResults) && toolResults.length) {
    parts.push(
      "",
      "Résultats calculés (EXACTS, calculés sur toutes les données — utilise-les pour répondre) :",
      JSON.stringify(toolResults).slice(0, 60000),
    );
  }
  parts.push("", `Question : ${question}`);
  return parts.join("\n");
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
          ...history.slice(-8),
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 1800,
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
  let body: {
    sheets?: SheetContext[];
    history?: { role: "user" | "assistant"; content: string }[];
    question?: string;
    toolResults?: unknown[];
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (!Array.isArray(body.sheets) || body.sheets.length === 0) {
    return Response.json({ error: "Aucune donnée chargée." }, { status: 400 });
  }
  if (!body.question || !body.question.trim()) {
    return Response.json({ error: "Aucune question fournie." }, { status: 400 });
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

  const system = buildSystem();
  const user = buildUser(body.sheets, body.question, Array.isArray(body.toolResults) ? body.toolResults : []);
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
    if (!text.trim()) {
      errors.push(`${model}: réponse vide`);
      continue;
    }
    const parsed = extractJson(text) as
      | { action?: string; answer?: unknown; plan?: { steps?: unknown }; sheet?: unknown }
      | null;
    if (parsed) {
      const planOk = parsed.plan && Array.isArray(parsed.plan.steps);
      // Demande de calcul (tool-use) : action compute OU plan présent sans réponse.
      if ((parsed.action === "compute" || (planOk && typeof parsed.answer !== "string")) && planOk) {
        return Response.json({ action: "compute", plan: parsed.plan, sheet: typeof parsed.sheet === "string" ? parsed.sheet : null });
      }
      if (typeof parsed.answer === "string") {
        return Response.json({ action: "answer", answer: parsed.answer });
      }
    }
    // Tolérant : le modèle a répondu en texte brut -> réponse finale.
    return Response.json({ action: "answer", answer: text });
  }

  return Response.json(
    { error: `Assistant IA injoignable (${AI_BASE_URL}). Détails : ${errors.join(" ; ").slice(0, 300)}` },
    { status: 502 },
  );
}
