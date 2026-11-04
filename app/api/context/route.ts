// Route serveur optionnelle : appelée uniquement quand l'utilisateur clique
// sur "Activer l'analyse IA" dans l'interface. C'est le seul endroit de
// l'application où un échantillon de données quitte le navigateur — il est
// envoyé au serveur IA **compatible OpenAI** configuré pour une compréhension
// plus fine du secteur d'activité, des en-têtes et des colonnes clés que le
// dictionnaire heuristique local (lib/sectors.ts).
//
// Par défaut : **Groq** (api.groq.com), endpoint compatible OpenAI, palier
// gratuit sans carte bancaire, très rapide. Il suffit de fournir AI_API_KEY
// (clé Groq). Alternative 100 % locale / hors-ligne : pointer AI_BASE_URL sur
// LM Studio (http://localhost:1234/v1), qui ne requiert pas de clé.
//
// Configuration (variables d'environnement, côté serveur uniquement — la clé
// n'est JAMAIS exposée au navigateur ni incluse dans l'installeur) :
//   - AI_BASE_URL : URL du serveur compatible OpenAI.
//       • En ligne (défaut) : https://api.groq.com/openai/v1 (Groq).
//       • Local / hors-ligne : http://localhost:1234/v1 (LM Studio, sans clé).
//   - AI_MODELS   : identifiants de modèles séparés par des virgules, essayés
//       dans l'ordre jusqu'à une réponse valide (défaut
//       "llama-3.1-8b-instant,gemma2-9b-it,openai/gpt-oss-120b" ; ids du catalogue Groq).
//   - AI_API_KEY  : clé du service en ligne (obligatoire si host ≠ localhost).
//   - AI_TIMEOUT_MS : délai max par modèle avant bascule (défaut 25000).
//   - ALLOWED_ORIGIN : origine supplémentaire autorisée (déploiement en ligne).
//
// Sans serveur IA joignable ou sans clé, cette route renvoie une erreur claire
// et l'application continue de fonctionner en mode heuristique local.
//
// Garde-fous : même origine uniquement (ou ALLOWED_ORIGIN), plafond de taille
// du corps, limitation de débit par IP (fenêtre glissante en mémoire),
// troncature des cellules.

export const runtime = "nodejs";
export const maxDuration = 30;

const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const AI_MODELS = (process.env.AI_MODELS || "llama-3.1-8b-instant,gemma2-9b-it,openai/gpt-oss-120b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 25000);

// Un service en ligne (host ≠ localhost) exige une clé ; LM Studio en local
// n'en demande pas.
const AI_IS_LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(AI_BASE_URL);

const MAX_SAMPLE_ROWS = 8;
const MAX_COLUMNS = 60;
const MAX_CELL_CHARS = 200;
const MAX_BODY_BYTES = 256 * 1024; // 256 Ko

// Limitation de débit par IP : fenêtre glissante en mémoire.
const RATE_LIMIT_MAX = 20; // requêtes
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // par 10 minutes
const hits = new Map<string, number[]>();

interface ContextRequestBody {
  fileName?: string;
  columns?: string[];
  headerInferred?: boolean;
  sampleRows?: Record<string, unknown>[];
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// true si la requête dépasse le quota (et enregistre l'appel sinon).
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Nettoyage opportuniste pour éviter que la Map ne grossisse indéfiniment.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      const kept = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }
  return false;
}

// N'autorise que les appels de même origine (le navigateur envoie l'en-tête
// Origin pour les POST). Une origine explicite peut être ajoutée via
// ALLOWED_ORIGIN. Les requêtes sans Origin (ex. hors navigateur) sont
// refusées par prudence, puisque l'app en déclenche toujours une.
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

function buildPrompt(body: ContextRequestBody): string {
  const columns = (body.columns ?? [])
    .slice(0, MAX_COLUMNS)
    .map((c) => truncate(c));
  const sample = (body.sampleRows ?? []).slice(0, MAX_SAMPLE_ROWS).map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row).slice(0, MAX_COLUMNS)) {
      out[String(key).slice(0, MAX_CELL_CHARS)] = truncate(row[key]);
    }
    return out;
  });

  return [
    "Tu analyses un extrait de jeu de données tabulaire pour une application de nettoyage et d'analyse de données.",
    body.headerInferred
      ? "Les noms de colonnes ci-dessous ont été générés automatiquement car le fichier original n'avait pas de ligne d'en-têtes détectable. Propose de meilleurs noms si tu peux déduire leur sens à partir des valeurs."
      : "Les noms de colonnes ci-dessous proviennent du fichier original.",
    "",
    `Colonnes : ${JSON.stringify(columns)}`,
    `Échantillon de lignes (JSON) : ${JSON.stringify(sample)}`,
    "",
    "Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte avant ni après, au format exact :",
    JSON.stringify({
      sector_label: "string : secteur d'activité probable, en français, ex. 'Ressources humaines'",
      confidence: "number entre 0 et 1",
      key_columns: "string[] : noms de colonnes EXISTANTS (repris tels quels dans la liste ci-dessus) les plus pertinents pour le nettoyage et l'analyse",
      header_suggestions: "array de {column, suggestion} : uniquement si tu proposes un meilleur nom pour une colonne, sinon []",
      rationale: "string : 1 à 2 phrases en français expliquant ton raisonnement",
    }),
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

// Appelle un modèle du serveur compatible OpenAI. Renvoie le texte de réponse,
// ou lève une erreur (réseau, délai dépassé, statut non OK).
async function callModel(model: string, prompt: string): Promise<string> {
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
          {
            role: "system",
            content:
              "Tu réponds UNIQUEMENT avec un objet JSON strict et valide, sans aucun texte autour, sans balises Markdown.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 800,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`statut ${resp.status} ${detail.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
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
    return Response.json(
      { error: "Trop de requêtes. Réessayez dans quelques minutes." },
      { status: 429 },
    );
  }

  // Refuse tôt un corps trop volumineux d'après l'en-tête déclaré.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Requête trop volumineuse." }, { status: 413 });
  }

  // Lit le corps en texte pour vérifier la taille réelle (l'en-tête peut mentir).
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Requête trop volumineuse." }, { status: 413 });
  }

  let body: ContextRequestBody;
  try {
    body = JSON.parse(raw) as ContextRequestBody;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }

  if (!Array.isArray(body.columns) || body.columns.length === 0) {
    return Response.json({ error: "Aucune colonne fournie." }, { status: 400 });
  }

  if (AI_MODELS.length === 0) {
    return Response.json(
      { error: "Aucun modèle IA configuré (variable AI_MODELS vide)." },
      { status: 500 },
    );
  }

  if (!AI_IS_LOCAL && !AI_API_KEY) {
    return Response.json(
      {
        error:
          "Analyse IA non configurée : clé API manquante (variable AI_API_KEY) pour le service IA en ligne.",
      },
      { status: 500 },
    );
  }

  const prompt = buildPrompt(body);
  const errors: string[] = [];

  // Essaie chaque modèle dans l'ordre : le premier qui renvoie un JSON
  // exploitable gagne, pour répondre au plus vite.
  for (const model of AI_MODELS) {
    let text: string;
    try {
      text = await callModel(model, prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = msg.includes("abort") ? "délai dépassé" : msg;
      errors.push(`${model}: ${friendly}`);
      continue;
    }
    const parsed = extractJson(text);
    if (parsed) return Response.json(parsed);
    errors.push(`${model}: réponse illisible`);
  }

  // Tous les modèles ont échoué : message clair, l'app repasse en heuristique.
  return Response.json(
    {
      error:
        `Serveur IA injoignable ou sans réponse exploitable (${AI_BASE_URL}). ` +
        `Vérifiez que LM Studio (ou le serveur configuré) est démarré et qu'un modèle est chargé. ` +
        `Détails : ${errors.join(" ; ").slice(0, 300)}`,
    },
    { status: 502 },
  );
}
