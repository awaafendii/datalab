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

export const runtime = "nodejs";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const MAX_SAMPLE_ROWS = 8;
const MAX_COLUMNS = 60;

interface ContextRequestBody {
  fileName?: string;
  columns?: string[];
  headerInferred?: boolean;
  sampleRows?: Record<string, unknown>[];
}

function buildPrompt(body: ContextRequestBody): string {
  const columns = (body.columns ?? []).slice(0, MAX_COLUMNS);
  const sample = (body.sampleRows ?? []).slice(0, MAX_SAMPLE_ROWS);

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

  let body: ContextRequestBody;
  try {
    body = await req.json();
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
