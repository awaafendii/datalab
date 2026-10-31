// Route serveur optionnelle : appelée uniquement quand l'utilisateur clique
// sur "Activer l'analyse IA" dans l'interface. C'est le seul endroit de
// l'application où des données quittent le navigateur — un échantillon de
// lignes est envoyé à l'API Claude pour une compréhension plus fine du
// secteur d'activité, des en-têtes et des colonnes clés que ce que permet
// le dictionnaire heuristique local (lib/sectors.ts).
//
// Nécessite la variable d'environnement ANTHROPIC_API_KEY (côté serveur
// uniquement — jamais exposée au navigateur). Sans elle, cette route renvoie
// une erreur claire et l'application continue de fonctionner en mode
// heuristique local.
//
// Garde-fous (cette route proxy une API payante) :
//   - même origine uniquement (ou ALLOWED_ORIGIN) : empêche un site tiers
//     d'appeler la route depuis le navigateur d'un visiteur ;
//   - plafond de taille du corps : évite les requêtes volumineuses ;
//   - limitation de débit par IP (fenêtre glissante en mémoire) : réduit le
//     risque d'épuisement des crédits Anthropic si l'URL est découverte ;
//   - troncature des cellules : borne le coût et la surface d'injection.
// La limitation en mémoire est « au mieux » sur un hébergement sans état
// (plusieurs instances) ; pour une protection stricte, placer un WAF / un
// rate-limit de plateforme (ex. Vercel) devant cette route.

export const runtime = "nodejs";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
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

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "L'analyse IA n'est pas configurée sur ce déploiement (variable ANTHROPIC_API_KEY absente côté serveur).",
      },
      { status: 500 },
    );
  }

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

  let apiResp: Response;
  try {
    apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        messages: [{ role: "user", content: buildPrompt(body) }],
      }),
    });
  } catch {
    return Response.json({ error: "Impossible de contacter l'API Claude." }, { status: 502 });
  }

  if (!apiResp.ok) {
    const detail = await apiResp.text().catch(() => "");
    return Response.json(
      { error: `Erreur API Claude (${apiResp.status}) : ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const data = (await apiResp.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  const parsed = extractJson(text);

  if (!parsed) {
    return Response.json(
      { error: "Réponse de l'IA illisible, réessayez." },
      { status: 502 },
    );
  }

  return Response.json(parsed);
}
