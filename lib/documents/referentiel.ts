import type { DocKind, IndicatorType, Severity } from "./types";
import { norm } from "./text";

// Référentiel du contrôle documentaire. C'est ici que l'on adapte l'outil à
// l'administration : types de documents et sections attendues, familles de
// directions et leurs indicateurs usuels, sigles connus, sources de
// financement. Construit à partir de documents réels (MESRSI, MFP : rapports
// d'activités, rapports de bilan, stratégies, rapports d'inspection,
// matrices de suivi des indicateurs) et volontairement large pour couvrir
// toutes les directions. Toutes les expressions régulières s'appliquent à
// du texte normalisé (minuscules, sans accents).

// --- Types de documents et sections attendues ---

export interface SectionSpec {
  id: string;
  label: string;
  patterns: RegExp[];
  severity: Severity;
  why: string;
}

export interface KindProfile {
  kind: DocKind;
  label: string;
  description: string;
  title: RegExp[]; // indices forts (titre, nom du fichier)
  body: RegExp[]; // indices faibles (titres de sections)
  sections: SectionSpec[];
  requiresDate: boolean;
  requiresIssuer: boolean;
}

const S = {
  contexte: {
    id: "contexte",
    label: "Contexte / introduction",
    patterns: [/introduction|contexte|justification|preambule|generalites|historique/],
    severity: "majeure",
    why: "le lecteur doit comprendre le cadre (programme, réforme, mandat) avant les résultats",
  },
  objectifs: {
    id: "objectifs",
    label: "Objectifs",
    patterns: [/objectif|but de la mission|finalite/],
    severity: "majeure",
    why: "sans objectifs explicites, les résultats ne peuvent pas être appréciés",
  },
  methodologie: {
    id: "methodologie",
    label: "Méthodologie",
    patterns: [/methodolog|demarche|approche|deroulement/],
    severity: "mineure",
    why: "la méthode (sources, échantillon, outils) conditionne la fiabilité des chiffres",
  },
  activites: {
    id: "activites",
    label: "Activités réalisées",
    patterns: [/activites|realisations|actions (realisees|menees)|mise en oeuvre/],
    severity: "majeure",
    why: "c'est le cœur d'un rapport d'activités",
  },
  resultats: {
    id: "resultats",
    label: "Résultats obtenus",
    patterns: [/resultat|acquis|bilan|constats?|analyse/],
    severity: "majeure",
    why: "les résultats doivent être distingués des activités",
  },
  difficultes: {
    id: "difficultes",
    label: "Difficultés rencontrées",
    patterns: [/difficultes|contraintes|obstacles|problemes|goulots|defis|faiblesses/],
    severity: "mineure",
    why: "elles justifient les écarts entre prévu et réalisé",
  },
  recommandations: {
    id: "recommandations",
    label: "Recommandations / perspectives",
    patterns: [/recommandation|perspectives|propositions|suggestions|mesures correctives/],
    severity: "majeure",
    why: "un rapport doit déboucher sur des mesures actionnables",
  },
  indicateurs: {
    id: "indicateurs",
    label: "Indicateurs de performance",
    patterns: [/indicateur|performance|suivi[- ]evaluation|cadre de (resultats|mesure)|tableau de bord/],
    severity: "majeure",
    why: "la gestion axée sur les résultats exige des indicateurs chiffrés (référence, cible, réalisé)",
  },
  conclusion: {
    id: "conclusion",
    label: "Conclusion",
    patterns: [/conclusion|synthese finale/],
    severity: "mineure",
    why: "elle résume les acquis et la suite à donner",
  },
  resume: {
    id: "resume",
    label: "Résumé exécutif",
    patterns: [/resume|synthese|note de synthese|executive summary/],
    severity: "mineure",
    why: "les décideurs lisent d'abord le résumé",
  },
  sigles: {
    id: "sigles",
    label: "Liste des sigles et abréviations",
    patterns: [/sigles|abreviations|acronymes/],
    severity: "mineure",
    why: "les documents stratégiques emploient de nombreux sigles",
  },
  diagnostic: {
    id: "diagnostic",
    label: "État des lieux / diagnostic",
    patterns: [/etat des lieux|diagnostic|analyse de (la )?situation|situation (actuelle|de reference)|etat des laboratoires/],
    severity: "majeure",
    why: "la stratégie doit partir d'une situation de référence chiffrée",
  },
  axes: {
    id: "axes",
    label: "Axes / orientations stratégiques",
    patterns: [/axes?|orientations? strategiques|programmes? strategiques|priorites strategiques|strategie d/],
    severity: "majeure",
    why: "c'est le contenu même de la stratégie",
  },
  miseEnOeuvre: {
    id: "mise-en-oeuvre",
    label: "Plan d'action / mise en œuvre (phasage)",
    patterns: [/plan d.action|mise en oeuvre|phasage|chronogramme|calendrier|plan operationnel|feuille de route/],
    severity: "majeure",
    why: "sans calendrier ni responsables, la stratégie reste déclarative",
  },
  suiviEvaluation: {
    id: "suivi-evaluation",
    label: "Suivi-évaluation (indicateurs, cibles)",
    patterns: [/suivi[- ]evaluation|indicateur|cadre de (resultats|mesure|performance)|cadre logique/],
    severity: "majeure",
    why: "chaque objectif doit avoir un indicateur, une valeur de référence et une cible",
  },
  financement: {
    id: "financement",
    label: "Coût et financement",
    patterns: [/financement|budget|cout|ressources financieres|mobilisation des ressources|montants?/],
    severity: "majeure",
    why: "une stratégie non chiffrée ne peut pas être inscrite au budget (CDMT, PIP)",
  },
  gouvernance: {
    id: "gouvernance",
    label: "Gouvernance / pilotage",
    patterns: [/gouvernance|pilotage|dispositif institutionnel|coordination|cadre institutionnel/],
    severity: "mineure",
    why: "il faut savoir qui pilote et qui rend compte",
  },
  risques: {
    id: "risques",
    label: "Risques et mesures d'atténuation",
    patterns: [/risques?|hypotheses|attenuation|swot|menaces/],
    severity: "mineure",
    why: "les risques conditionnent l'atteinte des cibles",
  },
  objet: {
    id: "objet",
    label: "Objet du marché / de la prestation",
    patterns: [/objet|objectifs?|finalite|description (du projet|de la prestation)/],
    severity: "majeure",
    why: "le prestataire doit savoir précisément ce qui est attendu",
  },
  perimetre: {
    id: "perimetre",
    label: "Périmètre / consistance",
    patterns: [/perimetre|portee|etendue|consistance|champ d.application|limites/],
    severity: "majeure",
    why: "un périmètre flou entraîne des avenants et des litiges",
  },
  exigences: {
    id: "exigences",
    label: "Exigences / spécifications techniques",
    patterns: [/exigences|specifications|prescriptions techniques|fonctionnalites|besoins (fonctionnels|techniques)|caracteristiques techniques/],
    severity: "bloquante",
    why: "c'est le cœur d'un cahier des charges",
  },
  livrables: {
    id: "livrables",
    label: "Livrables",
    patterns: [/livrables?|produits attendus|rapports? attendus/],
    severity: "majeure",
    why: "chaque livrable doit être daté et vérifiable",
  },
  delais: {
    id: "delais",
    label: "Délais / calendrier",
    patterns: [/delais?|planning|calendrier|chronogramme|duree|echeancier/],
    severity: "majeure",
    why: "les délais conditionnent les pénalités et le suivi",
  },
  reception: {
    id: "reception",
    label: "Réception / critères de validation",
    patterns: [/reception|recette|validation|criteres d.(acceptation|evaluation)|verification/],
    severity: "majeure",
    why: "sans critères de réception, la conformité ne peut pas être prononcée",
  },
  budgetPrestation: {
    id: "budget",
    label: "Budget / modalités financières",
    patterns: [/budget|cout|prix|modalites de paiement|offre financiere|remuneration|financement/],
    severity: "majeure",
    why: "le coût et les modalités de paiement doivent être connus",
  },
  resultatsAttendus: {
    id: "resultats-attendus",
    label: "Résultats attendus",
    patterns: [/resultats attendus|produits attendus|effets attendus/],
    severity: "majeure",
    why: "les termes de référence doivent dire ce que l'activité doit produire",
  },
  participants: {
    id: "participants",
    label: "Participants / cibles / profil",
    patterns: [/participants|cibles?|beneficiaires|profil|composition|public/],
    severity: "mineure",
    why: "le dimensionnement (et le budget) en dépend",
  },
  constats: {
    id: "constats",
    label: "Constats",
    patterns: [/constats?|observations|desordres|anomalies relevees|resultats de (l.)?(inspection|audit|controle|mission)/],
    severity: "bloquante",
    why: "c'est le cœur d'un rapport d'inspection ou d'audit",
  },
  causes: {
    id: "causes",
    label: "Analyse des causes",
    patterns: [/causes?|origine|analyse/],
    severity: "mineure",
    why: "les recommandations doivent traiter les causes, pas seulement les symptômes",
  },
} satisfies Record<string, SectionSpec>;

// --- Canevas du CDMT (lettre circulaire du Ministère du Budget) ---
// Commun à tous les ministères : seuls les libellés des programmes, des
// actions et des indicateurs changent. Établi à partir du CDMT 2026-2028 du
// MESRS (programmes 001 Pilotage et soutien, 002, 003…).

const C = {
  message: { id: "cdmt-message", label: "Message du Ministre", patterns: [/message du ministre|mot du ministre|avant-propos|preface/], severity: "mineure", why: "le canevas l'ouvre par le message du Ministre" },
  resume: { id: "cdmt-resume", label: "Résumé exécutif", patterns: [/resume executif|resume|synthese generale/], severity: "majeure", why: "il présente l'enveloppe globale et sa répartition par programme" },
  sigles: { id: "cdmt-sigles", label: "Sigles et abréviations", patterns: [/sigles|abreviations|acronymes/], severity: "mineure", why: "rubrique du canevas" },
  intro: { id: "cdmt-intro", label: "Introduction", patterns: [/introduction/], severity: "majeure", why: "elle rappelle le cadre (LOLF, GAR, budgets-programmes) et la structure en programmes" },
  mission: { id: "cdmt-mission", label: "Mission et organisation du ministère", patterns: [/mission|organisation|attributions|presentation du ministere/], severity: "majeure", why: "première partie de la présentation générale" },
  situation: { id: "cdmt-situation", label: "Situation du secteur et politique ministérielle", patterns: [/situation du secteur|politique (ministerielle|publique|sectorielle)|etat des lieux/], severity: "majeure", why: "elle justifie les choix de programmation" },
  bilan: { id: "cdmt-bilan", label: "Bilan stratégique (réalisations, difficultés)", patterns: [/bilan strategique|principales realisations|bilan/], severity: "majeure", why: "le CDMT part des résultats de l'exercice précédent" },
  orientations: { id: "cdmt-orientations", label: "Orientations stratégiques", patterns: [/orientations strategiques|synthese de la strategie|strategie/], severity: "majeure", why: "elles relient le CDMT à la politique nationale et sectorielle" },
  synthese: { id: "cdmt-synthese", label: "Synthèse des programmes et indicateurs de performance", patterns: [/synthese des programmes|programmes et indicateurs/], severity: "majeure", why: "tableau de bord global du ministère" },
  programmes: { id: "cdmt-programmes", label: "Présentation des programmes", patterns: [/presentation des programmes|^programme\s*\d/], severity: "bloquante", why: "c'est le cœur du CDMT" },
  conclusion: { id: "cdmt-conclusion", label: "Conclusion", patterns: [/conclusion/], severity: "mineure", why: "rubrique du canevas" },
  annexePlan: { id: "cdmt-annexe-plan", label: "Annexe : plan d'actions triennal", patterns: [/plan d.actions? (triennal|pluriannuel)/], severity: "majeure", why: "il détaille le coût de chaque activité par action et par programme" },
  annexeIndicateurs: { id: "cdmt-annexe-indicateurs", label: "Annexe : indicateurs de suivi et évaluation", patterns: [/indicateurs de suivi|suivi et evaluation|suivi-evaluation/], severity: "majeure", why: "référence pour le rapport annuel de performance" },
  annexeDepenses: { id: "cdmt-annexe-depenses", label: "Annexe : tableau d'évaluation des dépenses", patterns: [/evaluation des depenses/], severity: "mineure", why: "rubrique du canevas" },
  annexeInvest: { id: "cdmt-annexe-investissements", label: "Annexe : projets et programmes d'investissement", patterns: [/projets? et programmes? d.investissement|programmes? d.investissement/], severity: "mineure", why: "rubrique du canevas (PIP)" },
} satisfies Record<string, SectionSpec>;

// Rubriques obligatoires de chaque programme.
export const CDMT_PROGRAMME_SECTIONS: SectionSpec[] = [
  { id: "prog-description", label: "Description et objectifs du programme", patterns: [/description|objectifs du programme/], severity: "majeure", why: "rubrique a) du canevas" },
  { id: "prog-actions", label: "Actions prioritaires", patterns: [/actions? prioritaires?|actions du programme/], severity: "majeure", why: "rubrique b) du canevas" },
  { id: "prog-indicateurs", label: "Principaux indicateurs de performance", patterns: [/indicateurs? de performance|indicateurs/], severity: "majeure", why: "rubrique c) du canevas" },
  { id: "prog-cout", label: "Coût du programme (par nature, source de financement)", patterns: [/cout du programme|couts? |ressources|financement/], severity: "bloquante", why: "rubrique d) du canevas : sans coût, le programme n'est pas budgétisé" },
  { id: "prog-intervenants", label: "Intervenants du programme", patterns: [/intervenants|responsables|acteurs/], severity: "mineure", why: "rubrique e) du canevas" },
];

// Tableaux attendus dans un CDMT (repérés par leur légende).
export const CDMT_TABLES: { id: string; label: string; pattern: RegExp; severity: Severity }[] = [
  { id: "t-indicateurs", label: "Programmes et indicateurs de performance", pattern: /programmes et indicateurs|indicateurs de performance/, severity: "majeure" },
  { id: "t-synthese", label: "Synthèse des coûts globaux des programmes", pattern: /synthese des couts|couts globaux/, severity: "bloquante" },
  { id: "t-nature", label: "Emploi des ressources par programme et nature de dépense", pattern: /emploi des ressources/, severity: "majeure" },
  { id: "t-sources", label: "Ressources prévues par source de financement", pattern: /ressources prevues|sources? de financement/, severity: "majeure" },
  { id: "t-intervenants", label: "Intervenants des programmes", pattern: /intervenants/, severity: "mineure" },
];

// Nomenclature par nature économique (LOLF) : titres de dépenses.
export const NATURE_TITRES: { code: string; label: string; pattern: RegExp }[] = [
  { code: "1", label: "Charges financières de la dette", pattern: /dette/ },
  { code: "2", label: "Dépenses de personnel", pattern: /personnel/ },
  { code: "3", label: "Dépenses de biens et services", pattern: /biens et services/ },
  { code: "4", label: "Dépenses de transfert", pattern: /transferts?/ },
  { code: "5", label: "Dépenses d'investissement", pattern: /investissements?/ },
];

export const KIND_PROFILES: KindProfile[] = [
  {
    kind: "rapport-activite",
    label: "Rapport d'activités",
    description: "Rapport périodique d'une direction, d'un service ou d'un projet (annuel, trimestriel, de mission).",
    title: [/rapport (annuel )?d.activites?/, /rapport (trimestriel|semestriel|annuel)/, /bilan (des activites|annuel)/, /rapport de mission/],
    body: [/activites realisees/, /difficultes rencontrees/, /resultats obtenus/],
    sections: [S.contexte, S.objectifs, S.methodologie, S.activites, S.resultats, S.difficultes, S.recommandations, S.indicateurs, S.conclusion],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "rapport-etude",
    label: "Rapport d'étude / de bilan / d'évaluation",
    description: "Étude, enquête, diagnostic, évaluation ou bilan avec données chiffrées.",
    title: [/rapport (de |d.)(bilan|etude|evaluation|enquete|diagnostic|analyse)/, /\b(etude|enquete|evaluation|diagnostic)\b/, /\bbilan\b/],
    body: [/methodologie/, /echantillon/, /statistiques descriptives/, /resultats et analyse/],
    sections: [S.resume, S.contexte, S.objectifs, S.methodologie, S.resultats, S.recommandations, S.conclusion],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "rapport-inspection",
    label: "Rapport d'inspection / d'audit / de contrôle",
    description: "Visite technique, inspection, audit ou contrôle : constats et recommandations.",
    title: [/inspection/, /\baudit\b/, /rapport de (controle|visite|verification)/, /mission de (controle|verification|supervision)/],
    body: [/constats?/, /desordres/, /chef de mission/],
    sections: [
      { ...S.contexte, label: "Objet / contexte de la mission", severity: "mineure", why: "il faut savoir qui a demandé l'inspection et pourquoi" },
      S.constats,
      S.causes,
      S.recommandations,
      S.conclusion,
    ],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "strategie",
    label: "Stratégie / plan stratégique / politique",
    description: "Stratégie sectorielle, plan stratégique, politique nationale, feuille de route.",
    title: [/strategie/, /plan strategique/, /politique (nationale|sectorielle)/, /feuille de route/, /plan (decennal|sectoriel|directeur|national)/],
    body: [/axes? strategiques?/, /analyse swot/, /vision/, /phasage/],
    sections: [S.sigles, S.resume, S.contexte, S.diagnostic, S.objectifs, S.axes, S.miseEnOeuvre, S.suiviEvaluation, S.financement, S.gouvernance, S.risques],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "loi-finances",
    label: "Loi de finances (référence)",
    description: "Loi de finances initiale ou rectificative : texte de référence des crédits par section, programme et nature. Elle sert de référentiel aux contrôles et n'est pas contrôlée elle-même.",
    title: [/\bloi de finances (initiale |rectificative )?(pour l.annee )?(19|20)\d{2}\b/, /tableau des operations financieres de l.etat/, /synthese des depenses par institution/],
    body: [/budgets? d.affectation speciale/, /detail des (credits|recettes|depenses)/, /repartition des depenses par ministere/, /financement du budget de l.etat/],
    sections: [],
    requiresDate: false,
    requiresIssuer: false,
  },
  {
    kind: "cdmt",
    label: "CDMT / budget-programme",
    description: "Cadre de dépenses à moyen terme selon le canevas du Ministère du Budget (présentation générale, programmes, annexes), DPPD, budget-programme.",
    title: [/\bcdmt\b/, /cadre (des|de) depenses a moyen terme/, /\bdppd\b/, /programmation pluriannuelle/, /budget[- ]programmes?/, /projet annuel de performance/, /\bpap\b/, /lettre de cadrage/],
    body: [/plafonds?/, /nature economique/, /n\s?\+\s?[12]/, /autorisations d.engagement|credits de paiement/],
    sections: [
      C.message,
      C.resume,
      C.sigles,
      C.intro,
      C.mission,
      C.situation,
      C.bilan,
      C.orientations,
      C.synthese,
      C.programmes,
      C.conclusion,
      C.annexePlan,
      C.annexeIndicateurs,
      C.annexeDepenses,
      C.annexeInvest,
    ],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "cahier-charges",
    label: "Cahier des charges / spécifications",
    description: "Cahier des charges, spécifications techniques, dossier d'appel d'offres.",
    title: [/cahier (des|de) charges?/, /specifications techniques/, /dossier d.appel d.offres/, /\bdao\b/, /prescriptions techniques/, /cahier des clauses/],
    body: [/exigences/, /livrables/, /criteres de (reception|recette|selection)/, /soumissionnaire/],
    sections: [S.contexte, S.objet, S.perimetre, S.exigences, S.livrables, S.delais, S.reception, S.budgetPrestation],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "tdr",
    label: "Termes de référence (TdR)",
    description: "Termes de référence d'une mission, d'un atelier, d'une étude ou d'un recrutement.",
    title: [/termes de reference/, /\btdrs?\b/],
    body: [/resultats attendus/, /profil du consultant/, /chronogramme/],
    sections: [S.contexte, S.objectifs, S.resultatsAttendus, S.methodologie, S.participants, S.delais, S.budgetPrestation, S.livrables],
    requiresDate: true,
    requiresIssuer: true,
  },
  {
    kind: "matrice-indicateurs",
    label: "Matrice d'indicateurs / plan d'action",
    description: "Matrice de suivi (CAP, PTA, plan d'action) : activités, indicateurs, référence, cible, réalisation.",
    title: [/matrice|indicateurs?|plan de travail annuel|\bpta\b|contrat annuel de performance|\bcap\b|plan d.action|suivi[- ]evaluation/],
    body: [/reference/, /cible/, /source de verification/],
    sections: [],
    requiresDate: false,
    requiresIssuer: false,
  },
  {
    kind: "autre",
    label: "Autre document",
    description: "Type non reconnu : seuls les contrôles généraux s'appliquent.",
    title: [],
    body: [],
    sections: [],
    requiresDate: false,
    requiresIssuer: false,
  },
];

export function profileOf(kind: DocKind): KindProfile {
  return KIND_PROFILES.find((p) => p.kind === kind) ?? KIND_PROFILES[KIND_PROFILES.length - 1];
}

// --- Familles de directions / services et leurs indicateurs usuels ---
// Couvre les fonctions que l'on retrouve dans tous les ministères, pas une
// seule direction : chaque direction se rattache à une ou plusieurs familles
// via ses sigles ou le vocabulaire de ses documents.

export interface DepartmentFamily {
  id: string;
  label: string;
  sigles: string[]; // sigles de structures rattachées (en majuscules)
  keywords: RegExp[];
  indicators: string[]; // exemples d'indicateurs mesurables
}

export const DEPARTMENTS: DepartmentFamily[] = [
  {
    id: "strategie",
    label: "Planification, stratégie et statistiques",
    sigles: ["BSD", "BSP", "DPS", "CPS", "SSE", "SG", "CAB"],
    keywords: [/strategie|planification|annuaire statistique|carte universitaire|contrat annuel de performance|\bcap\b|cdmt|\bpta\b|suivi[- ]evaluation|prodeg/],
    indicators: [
      "Taux de réalisation des activités du CAP / PTA (%)",
      "Nombre d'études et d'enquêtes réalisées",
      "Annuaire statistique produit dans les délais (oui/non, date)",
      "Taux d'exécution physique du plan d'action (%)",
    ],
  },
  {
    id: "finances",
    label: "Finances, budget et comptabilité",
    sigles: ["DAF", "SAF", "DFM", "BAS", "FCE"],
    keywords: [/budget|credits?|engagement|liquidation|ordonnancement|decaissement|execution budgetaire|comptab|tresor|recettes|depenses/],
    indicators: [
      "Taux d'exécution budgétaire (engagements / crédits ouverts, %)",
      "Taux de décaissement (%)",
      "Délai moyen de paiement (jours)",
      "Montant des ressources mobilisées (GNF)",
    ],
  },
  {
    id: "rh",
    label: "Ressources humaines et fonction publique",
    sigles: ["DRH", "SRH", "MFP", "DGFP", "PATS"],
    keywords: [/ressources humaines|effectifs?|recrutement|recrues|affectation|carriere|avancement|retraite|formation continue|agents?|personnel|fonctionnaires/],
    indicators: [
      "Nombre d'agents recrutés / formés",
      "Ratio étudiants / enseignant-chercheur",
      "Proportion d'enseignants titulaires d'un doctorat (%)",
      "Taux d'absentéisme (%)",
    ],
  },
  {
    id: "marches",
    label: "Marchés publics et achats",
    sigles: ["CPMP", "PRMP", "DNMP", "ARMP", "DAO"],
    keywords: [/marches? publics?|appel d.offres|passation|attribution|soumission|fournisseurs?|acquisition|consultation restreinte|entente directe/],
    indicators: [
      "Nombre de marchés passés",
      "Délai moyen de passation (jours)",
      "Part des marchés attribués par appel d'offres ouvert (%)",
      "Taux d'exécution du plan de passation (%)",
    ],
  },
  {
    id: "enseignement",
    label: "Enseignement supérieur et formation",
    sigles: ["DNES", "IES", "LMD", "UGANC", "UGLC-SC", "UJNK", "UK", "UL", "UZ", "ISSEG", "ISAV-F", "ISMG", "ISSMV", "IST", "ISAU", "ESTH", "ISAMK", "ISFAD"],
    keywords: [/enseignement superieur|etudiants?|filieres?|programmes? (de formation|accredites?)|licence|master|doctorat|reussite|redoublement|diplomes?|orientation|accreditation/],
    indicators: [
      "Taux de réussite en Licence 1 (%)",
      "Nombre d'étudiants inscrits (dont filles)",
      "Nombre de programmes accrédités",
      "Taux d'encadrement (étudiants par enseignant)",
    ],
  },
  {
    id: "recherche",
    label: "Recherche scientifique et innovation",
    sigles: ["DNRS", "DNRSI", "IRS", "FONRSI", "ANFIVRI", "CSIG", "CEDUST", "STIM"],
    keywords: [/recherche scientifique|chercheurs?|publications?|laboratoires?|brevets?|innovation|projets de recherche|revues?/],
    indicators: [
      "Nombre de publications dans des revues à comité de lecture",
      "Nombre de projets de recherche financés",
      "Nombre de laboratoires équipés et fonctionnels",
      "Part du budget consacrée à la recherche (%)",
    ],
  },
  {
    id: "vie-universitaire",
    label: "Vie universitaire, sports, arts et culture",
    sigles: ["DNSACU", "CENOU", "OSEU"],
    keywords: [/jeux universitaires|sports?|culture|arts?|bourses?|oeuvres universitaires|restauration|hebergement|vie etudiante|mutuelle/],
    indicators: [
      "Nombre d'IES participantes",
      "Nombre de participants / bénéficiaires (dont filles)",
      "Nombre d'étudiants boursiers",
      "Nombre de lits / repas servis",
    ],
  },
  {
    id: "infrastructures",
    label: "Infrastructures, équipements et patrimoine",
    sigles: ["DNIEUS", "DIE", "SIE", "DPE", "EDG", "SEG"],
    keywords: [/infrastructures?|batiments?|travaux|rehabilitation|construction|toiture|etancheite|equipements?|maintenance|patrimoine|mobilier|inspection technique/],
    indicators: [
      "Nombre de bâtiments réhabilités / construits",
      "Taux de fonctionnement des équipements (%)",
      "Nombre de laboratoires équipés",
      "Délai moyen d'intervention de maintenance (jours)",
    ],
  },
  {
    id: "controle",
    label: "Contrôle, inspection et audit",
    sigles: ["IG", "IGS", "IGE", "CAI"],
    keywords: [/inspection|audit|controle|verification|conformite|irregularites|contentieux/],
    indicators: [
      "Nombre de missions d'inspection / d'audit réalisées",
      "Taux de mise en œuvre des recommandations (%)",
      "Nombre de structures contrôlées",
    ],
  },
  {
    id: "projets",
    label: "Projets et programmes financés (PTF)",
    sigles: ["UGP", "UCP", "PTF", "FINEX", "BAD", "BID", "UE", "UNESCO"],
    keywords: [/projets?|bailleurs?|partenaires techniques et financiers|decaissement|manuel de procedures?|convention de financement|appui budgetaire/],
    indicators: [
      "Taux de décaissement (%)",
      "Taux d'exécution physique des projets (%)",
      "Nombre de projets ayant atteint au moins 50 % de décaissement",
      "Montant mobilisé auprès des partenaires (GNF)",
    ],
  },
  {
    id: "numerique",
    label: "Numérique et systèmes d'information",
    sigles: ["SMSI", "DSI", "SSI", "DNTIC", "TIC"],
    keywords: [/numerique|informatique|systemes? d.information|plateforme|digitalisation|base de donnees|reseau|internet|logiciels?/],
    indicators: [
      "Taux de disponibilité des plateformes (%)",
      "Nombre de procédures dématérialisées",
      "Nombre d'utilisateurs actifs",
    ],
  },
  {
    id: "qualite",
    label: "Assurance qualité et évaluation",
    sigles: ["ANAQ", "CAQ", "DAQ"],
    keywords: [/assurance qualite|accreditation|evaluation (des programmes|institutionnelle)|auto-evaluation|normes?/],
    indicators: [
      "Nombre de programmes évalués / accrédités",
      "Nombre d'IES ayant une cellule qualité fonctionnelle",
    ],
  },
  {
    id: "cooperation",
    label: "Coopération, partenariats et communication",
    sigles: ["BCP", "SCRP", "DCI", "SCOM", "SRP"],
    keywords: [/cooperation|partenariats?|conventions?|jumelage|communication|relations publiques|mobilite/],
    indicators: [
      "Nombre de conventions signées / actives",
      "Nombre de bénéficiaires de mobilité",
      "Nombre de parutions / actions de communication",
    ],
  },
  {
    id: "genre",
    label: "Genre, équité et inclusion",
    sigles: ["CGE", "SGE"],
    keywords: [/genre|filles|femmes|equite|inclusion|handicap|vulnerables?/],
    indicators: ["Taux de féminisation (%)", "Nombre de bénéficiaires vulnérables accompagnés"],
  },
];

// --- Sigles connus ---
// `expansion` n'est renseignée que lorsqu'elle est établie (définie dans
// les documents officiels fournis ou d'usage constant). Un écart avec le
// document est signalé « à vérifier », jamais corrigé d'office.

export interface SigleRef {
  sigle: string;
  expansion?: string;
}

export const SIGLES: SigleRef[] = [
  { sigle: "MESRSI", expansion: "Ministère de l'Enseignement Supérieur, de la Recherche Scientifique et de l'Innovation" },
  { sigle: "MESRS", expansion: "Ministère de l'Enseignement Supérieur et de la Recherche Scientifique" },
  { sigle: "MFP", expansion: "Ministère de la Fonction Publique" },
  { sigle: "BSD", expansion: "Bureau de Stratégie et de Développement" },
  // « Direction » ou « Division » selon les ministères : pas de développé imposé.
  { sigle: "DAF" },
  { sigle: "DRH" },
  { sigle: "CPMP", expansion: "Cellule de Passation des Marchés Publics" },
  { sigle: "PRMP", expansion: "Personne Responsable des Marchés Publics" },
  { sigle: "CAB" },
  { sigle: "SG" },
  { sigle: "IG", expansion: "Inspection Générale" },
  { sigle: "LOLF", expansion: "Loi Organique relative aux Lois de Finances" },
  { sigle: "LFI", expansion: "Loi de Finances Initiale" },
  { sigle: "LFR", expansion: "Loi de Finances Rectificative" },
  { sigle: "PAP", expansion: "Projet Annuel de Performance" },
  { sigle: "RAP", expansion: "Rapport Annuel de Performance" },
  { sigle: "GAR", expansion: "Gestion Axée sur les Résultats" },
  { sigle: "PAO", expansion: "Plan d'Action Opérationnel" },
  { sigle: "PLEB", expansion: "Plateforme d'Élaboration du Budget" },
  { sigle: "ODD", expansion: "Objectifs de Développement Durable" },
  { sigle: "ANAQ", expansion: "Autorité Nationale d'Assurance Qualité" },
  { sigle: "DNRS", expansion: "Direction Nationale de la Recherche Scientifique" },
  { sigle: "DNIEUS", expansion: "Direction Nationale des Infrastructures et Équipements Universitaires et Scientifiques" },
  { sigle: "SMSI", expansion: "Service de Modernisation des Systèmes d'Information" },
  { sigle: "CSIG", expansion: "Cité des Sciences et de l'Innovation de Guinée" },
  { sigle: "EPS", expansion: "Établissement Public à caractère Scientifique" },
  { sigle: "CAMES" },
  { sigle: "LMD", expansion: "Licence-Master-Doctorat" },
  { sigle: "DNES", expansion: "Direction Nationale de l'Enseignement Supérieur" },
  { sigle: "DNSACU" },
  { sigle: "ProDEG", expansion: "Programme Décennal de l'Éducation en Guinée" },
  { sigle: "BND", expansion: "Budget National de Développement" },
  { sigle: "PIP", expansion: "Programme d'Investissements Publics" },
  { sigle: "PTF", expansion: "Partenaires Techniques et Financiers" },
  { sigle: "FINEX", expansion: "Financement Extérieur" },
  { sigle: "FCE", expansion: "Fonds Commun de l'Éducation" },
  // Loi de finances 2026, partie VI « Budgets d'Affectation Spéciale (BAS) ».
  { sigle: "BAS", expansion: "Budget d'Affectation Spéciale" },
  { sigle: "FNDL", expansion: "Fonds National de Développement Local" },
  { sigle: "FIM", expansion: "Fonds d'Investissement Minier" },
  { sigle: "FODECCON", expansion: "Fonds de Développement des Communes de Conakry" },
  { sigle: "ANAFIC", expansion: "Agence Nationale de Financement des Collectivités Locales" },
  { sigle: "LF", expansion: "Loi de Finances" },
  { sigle: "TOFE", expansion: "Tableau des Opérations Financières de l'État" },
  { sigle: "C2D", expansion: "Contrat de Désendettement et de Développement" },
  { sigle: "DTS", expansion: "Droits de Tirage Spéciaux" },
  { sigle: "AFD", expansion: "Agence Française de Développement" },
  { sigle: "CAP", expansion: "Contrat Annuel de Performance" },
  { sigle: "CDMT", expansion: "Cadre de Dépenses à Moyen Terme" },
  { sigle: "PTA", expansion: "Plan de Travail Annuel" },
  { sigle: "IES", expansion: "Institution d'Enseignement Supérieur" },
  { sigle: "IRS", expansion: "Institut de Recherche Scientifique" },
  { sigle: "CDI", expansion: "Centre de Documentation et d'Information" },
  { sigle: "PATS", expansion: "Personnel Administratif, Technique et de Service" },
  { sigle: "EDG", expansion: "Électricité de Guinée" },
  { sigle: "SEG", expansion: "Société des Eaux de Guinée" },
  { sigle: "STIM", expansion: "Sciences, Technologies, Ingénierie et Mathématiques" },
  { sigle: "TIC", expansion: "Technologies de l'Information et de la Communication" },
  { sigle: "TP", expansion: "Travaux Pratiques" },
  { sigle: "CNRD", expansion: "Comité National du Rassemblement pour le Développement" },
  { sigle: "UGANC", expansion: "Université Gamal Abdel Nasser de Conakry" },
  { sigle: "UGLC-SC", expansion: "Université Général Lansana Conté de Sonfonia-Conakry" },
  { sigle: "UJNK", expansion: "Université Julius Nyerere de Kankan" },
  { sigle: "UK", expansion: "Université de Kindia" },
  { sigle: "UL", expansion: "Université de Labé" },
  { sigle: "UZ", expansion: "Université de N'Zérékoré" },
  { sigle: "ISSEG", expansion: "Institut Supérieur des Sciences de l'Éducation de Guinée" },
  { sigle: "ISAV-F", expansion: "Institut Supérieur Agronomique et Vétérinaire de Faranah" },
  { sigle: "ISMG", expansion: "Institut Supérieur des Mines et Géologie de Boké" },
  { sigle: "ISSMV", expansion: "Institut Supérieur des Sciences et de Médecine Vétérinaire de Dalaba" },
  { sigle: "IST", expansion: "Institut Supérieur de Technologie de Mamou" },
  { sigle: "ISAU", expansion: "Institut Supérieur d'Architecture et d'Urbanisme" },
  { sigle: "ISAMK", expansion: "Institut Supérieur des Arts Mory Kanté" },
  { sigle: "ISFAD", expansion: "Institut Supérieur de Formation à Distance" },
  { sigle: "ESTH", expansion: "École Supérieure du Tourisme et de l'Hôtellerie" },
  { sigle: "UNESCO" },
  { sigle: "BAD", expansion: "Banque Africaine de Développement" },
  { sigle: "BID", expansion: "Banque Islamique de Développement" },
  { sigle: "UE", expansion: "Union Européenne" },
  { sigle: "PPP", expansion: "Partenariat Public-Privé" },
  { sigle: "SWOT" },
  { sigle: "LATICE" },
  { sigle: "COPGUI" },
  { sigle: "GNF", expansion: "Franc guinéen" },
  { sigle: "USD" },
  { sigle: "EUR" },
  { sigle: "FCFA" },
  { sigle: "PDF" },
  { sigle: "ONU" },
  { sigle: "OMS" },
];

// Sigles universels ou mots en capitales qu'il ne faut pas exiger de définir.
export const COMMON_UPPERCASE = new Set([
  "USD", "EUR", "GNF", "FCFA", "PDF", "ONU", "OMS", "UNESCO", "SWOT", "NB", "OK", "TVA", "HT", "TTC",
  "CV", "PV", "RAS", "ND", "NA", "BTS", "BAC", "PC", "TV", "GPS", "SMS", "ID", "UV", "CO", "CAO", "FAO",
  "DAO", "SIG", "CNC", "RAM", "SSD", "GO", "USB", "TD", "QCM", "SQL", "API", "ISO", "ADN", "ARN", "PCR",
  "HTML", "PHP", "IT", "IA", "IOT", "LED", "LCD", "HD", "VR", "AR", "3D", "2D", "CD", "DVD", "WIFI", "PIB",
  "ODD", "NTIC", "TIC", "IR", "UHF", "VHF", "GSM", "PME", "PMI", "ONG", "RH", "AG", "CA", "SA", "SARL",
]);

// --- Sources de financement reconnues ---

export const FUNDING_SOURCES: { label: string; pattern: RegExp }[] = [
  // Libellés de la loi de finances : « Ress. Propres », « Contre Partie Finex »,
  // « Ress. Extérieures », « Titre D'État », « C2D », « DTS », « BAS FNDL »…
  { label: "Budget National de Développement (BND)", pattern: /\bbnd\b|budget national|ress(ources?|\.)? propres|titre d.etat|tresor public/ },
  { label: "Contrepartie nationale des financements extérieurs", pattern: /contre ?partie/ },
  { label: "Financement extérieur (FINEX / PTF)", pattern: /finex|\bptf\b|financement exterieur|ress(ources?|\.)? exterieures|bailleurs?|banque mondiale|\bbad\b|\bbid\b|\bue\b|unesco|unicef|afd|jica|giz|usaid|\bc2d\b|\bdts\b/ },
  { label: "Programme d'Investissements Publics (PIP, titre 5)", pattern: /\bpip\b|titre 5|investissements? publics?/ },
  { label: "Subventions (titre 4)", pattern: /subvention|titre 4|transferts?/ },
  { label: "Budgets d'affectation spéciale (BAS : FCE, FNDL, FIM, FODECCON)", pattern: /\bfce\b|\bbas\b|\bfndl\b|\bfim\b|\bfodeccon\b|fonds commun|affectation speciale|appui sectoriel/ },
  { label: "Ressources propres", pattern: /ressources propres|fonds propres|recettes propres|autofinancement/ },
  { label: "Financement mixte", pattern: /mixte|cofinancement/ },
  { label: "Partenariat public-privé / secteur privé", pattern: /\bppp\b|prive|sponsor|mecenat/ },
];

// --- Typage des indicateurs à partir de leur libellé ---

export function indicatorType(label: string): IndicatorType {
  const t = norm(label);
  if (/\b(taux|pourcentage|proportion|part (de|des|du)|pourcent)\b|%/.test(t)) return "pourcentage";
  if (/\b(ratio|rapport entre|par (etudiant|enseignant|agent|habitant))\b/.test(t)) return "ratio";
  if (/\b(montants?|couts?|budgets?|recettes?|depenses?|gnf|usd|fcfa|valeur)\b/.test(t)) return "montant";
  if (/\b(delais?|duree|jours?|mois|heures?)\b/.test(t)) return "delai";
  if (/\b(nombre|nbre|nb|effectifs?|quantite)\b/.test(t)) return "nombre";
  if (/\b(existence|disponibilite|adoption|adopte|validation|valide|elaboration|mise en place|document|rapport|texte|plan)\b/.test(t))
    return "jalon";
  return "non-type";
}

// Indicateurs dont la cible doit baisser (une cible inférieure à la
// référence est alors normale). S'applique à du texte normalisé.
export const DECREASING_INDICATOR =
  /abandon|redoublement|echec|absenteisme|delai|retard|cout|pannes?|deces|plaintes?|litiges?|arrieres|chomage|taux d.erreur|non[- ]conform/;
