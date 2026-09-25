# DataLab — Plateforme d'analyse de données

Chargez un fichier **CSV** ou **Excel**, nettoyez et apurez automatiquement vos
données, explorez-les (statistiques, graphiques, corrélations, observations
générées) puis exportez le tout en **XLSX**, **PDF** ou **Word**.

> ⚙️ 100 % côté navigateur par défaut : vos données ne quittent jamais votre
> machine, aucun serveur ne les reçoit. La seule exception est l'**analyse IA
> optionnelle** (secteur d'activité, colonnes clés) : elle n'est déclenchée
> que si vous cliquez explicitement dessus, et envoie alors un échantillon de
> vos données à l'API Claude. Le nettoyage, l'analyse, le machine learning et
> les exports restent, eux, toujours 100 % locaux.

## Fonctionnalités

- **Chargement** CSV / TSV / TXT, Excel (XLSX, XLSM avec macros, XLS, XLSB,
  modèles XLTX / XLTM) et ODS (glisser-déposer ou parcourir). Les CSV
  enregistrés par Excel en Windows-1252 gardent leurs accents ; les dates
  Excel sont converties au format `AAAA-MM-JJ`. **Classeurs multi-feuilles** :
  chaque feuille est détectée, puis nettoyée, analysée et modélisée
  **indépendamment** (ses propres réglages, son propre profil, ses propres
  observations). Les feuilles vides ou sans tableau de données (page
  d'accueil, tableau de bord visuel…) sont ignorées et listées à l'écran. Un
  bouton permet d'appliquer en un clic les réglages d'une feuille à toutes les
  feuilles pas encore traitées.
- **Profilage automatique** : type de chaque colonne (numérique, texte, date,
  booléen), valeurs manquantes, valeurs uniques, min/max/moyenne/médiane, etc.
- **Compréhension du contexte** (nouveau) :
  - **En-têtes manquants** : si le fichier n'a pas de ligne de titres, DataLab
    le détecte et génère des noms de colonnes plausibles d'après leur contenu
    (`Date 1`, `Valeur 2`, `Texte 3`…).
  - **Secteur d'activité** : un dictionnaire de mots-clés (RH, ventes, finance,
    santé, éducation, immobilier, logistique, marketing…) reconnaît le
    domaine probable à partir des noms de colonnes, et suggère les
    **colonnes clés** à privilégier — pré-sélectionnées dans le clustering et
    la régression. 100 % local, aucune donnée envoyée.
  - **Analyse IA optionnelle** : un bouton « Activer l'analyse IA » envoie un
    échantillon de lignes à Claude pour une compréhension plus fine (secteur,
    colonnes clés, suggestions de noms de colonnes) — désactivé par défaut,
    nécessite une clé API côté serveur (voir plus bas).
- **Nettoyage & apurement** :
  - suppression des espaces superflus,
  - harmonisation des marqueurs de vide (`NA`, `N/A`, `null`, `-`, `?`…),
  - typage numérique intelligent (`1 200 000`, `45 %`, `12 €` → nombres),
  - suppression des doublons,
  - traitement des valeurs manquantes (moyenne, médiane, mode, 0, constante,
    ou suppression des lignes),
  - détection et traitement des valeurs atypiques (outliers) par écart
    interquartile (IQR) : plafonnement (winsorisation) ou suppression.
- **Analyse exploratoire** : statistiques descriptives, histogrammes de
  distribution, fréquences des variables catégorielles, matrice de corrélations
  de Pearson.
- **Machine learning** (calculé en pur JavaScript, dans le navigateur) :
  - **Clustering k-means** : regroupe les lignes en k groupes homogènes à
    partir des colonnes numériques choisies (variables centrées-réduites,
    initialisation k-means++, plusieurs redémarrages), avec nuage de points,
    profil moyen par groupe et courbe du coude pour choisir k.
  - **Régression linéaire** (simple ou multiple, moindres carrés ordinaires) :
    modélise une variable numérique à partir d'une ou plusieurs autres,
    avec équation, R² / R² ajusté / RMSE / MAE, coefficients standardisés et
    graphique observé/prédit.
- **Observations** générées automatiquement en français.
- **Exports** : Excel (données nettoyées + profil + corrélations + observations),
  PDF et Word (rapport complet). Pour un classeur multi-feuilles, l'export
  **regroupe toutes les feuilles déjà nettoyées en un seul fichier** : un
  onglet de données par feuille dans l'Excel, une section par feuille dans le
  PDF et le Word.

## Module « Documents » : structuration et contrôle de documents

Accessible par l'onglet **Documents** (`/documents`). On y charge un ou
plusieurs documents administratifs — **Word (.docx), PDF texte, Excel** — de
n'importe quelle direction : rapports d'activités, rapports d'étude, de bilan
ou d'inspection, stratégies, **CDMT** et budgets-programmes, **cahiers des
charges**, **termes de référence**, **matrices d'indicateurs** (CAP, PTA,
plans d'action). Tout est analysé dans le navigateur, sans IA ni serveur.

- **Structuration** : plan reconstitué (titres stylés, ou déduits d'une
  numérotation « II-1-2 », de capitales, d'intertitres de PDF), tableaux lus
  intelligemment (cellules fusionnées, en-têtes sur plusieurs lignes, lignes
  de total, colonnes d'effectifs et de pourcentages, tableaux saisis avec des
  tabulations), indicateurs extraits en un tableau commun à toutes les
  directions, type de document et direction(s) concernée(s) reconnus.
- **Contrôles** (chaque anomalie est localisée, graduée — bloquante, majeure,
  mineure, info — et accompagnée d'une **correction proposée**) :
  - *calculs* : totaux de lignes et de colonnes, pourcentages recalculés à
    partir des effectifs, quantité × prix unitaire, tableaux décalés, vides,
    non remplis ou répétés ;
  - *cohérence* : chiffres du texte ↔ tableaux, effectifs contradictoires
    (« 850 » puis « 765 »), chiffre du titre introuvable, effectif de
    référence variable, devises et unités mélangées, montants du texte ≠
    total du tableau ;
  - *complétude* : sections attendues selon le type de document, textes à
    compléter (« [dates] », « … »), sections vides ou restées à l'état de
    notes, annexes annoncées mais absentes, document non daté ;
  - *indicateurs* : référence, cible, réalisé, taux de réalisation recalculé,
    valeurs impossibles (taux > 100 %), trimestres incohérents avec les dates,
    résultats non chiffrés, recommandations sans responsable ni échéance ;
  - *budget / CDMT* : dépassement de plafond, dotations nulles ou négatives,
    variations annuelles > 50 %, totaux annuels divergents entre tableaux ;
  - *sigles* : définitions contradictoires, écart avec le référentiel, sigles
    non définis, graphies concurrentes (« BAS/FCE » / « FCE/BAS ») ;
  - *rédaction* : coquilles (le document sert de dictionnaire), mots répétés,
    phrases inachevées, « % » oubliés, renvois Word cassés, exigences vagues
    d'un cahier des charges (« rapide », « si possible »…) ;
  - *entre documents* : phrases recopiées d'un rapport à l'autre, sigles
    définis différemment selon les documents.
- **CDMT** (canevas de la lettre circulaire du Ministère du Budget, commun à
  tous les ministères — seuls les libellés des programmes, actions et
  indicateurs changent) :
  - *structure* : rubriques du canevas (message du Ministre, résumé exécutif,
    présentation générale, programmes, conclusion, 4 annexes) et, pour chaque
    programme, ses 5 rubriques (objectifs, actions prioritaires, indicateurs,
    coût par nature et source de financement, intervenants) ; tableaux
    attendus (synthèse des coûts, emploi par nature, ressources par source,
    intervenants) ;
  - *cadrage financier* : sous-totaux hiérarchiques (programme = somme des
    natures ou des actions, nature = somme de ses lignes, total = somme des
    programmes), cumul « 2026-2028 » = somme des trois années, montant de
    chaque programme identique dans tous les tableaux, enveloppe globale et
    montants de programmes cités dans le texte (message, résumé, conclusion)
    comparés au tableau de synthèse, unité des tableaux, période couverte,
    projections à taux uniforme ;
  - *cadre de performance* : lecture des tableaux « années en colonnes »
    (N-1 = référence, N à N+2 = cibles), indicateurs de programme sans valeurs,
    références « ND », cibles recopiées ou en rupture, même indicateur
    différent d'un tableau à l'autre, numérotation ;
  - *cohérence* : responsable de chaque action identique dans les tableaux, le
    plan d'actions et les intervenants ; intitulés des programmes.
- **Loi de finances en vigueur** (LF 2026, tous les ministères) : le
  référentiel `lib/documents/lf-data.ts` est tiré du PDF de la loi (45
  sections budgétaires, 11 ministères en budget-programme, 209 imputations,
  sources de financement, BAS). Chaque document est rattaché à la **section**
  de son ministère (code 01 à 99, reconnu d'après l'intitulé du ministère,
  son sigle ou « section 34 » ; modifiable à la main dans la synthèse), puis :
  - *cadrage* : total de l'année de la loi (colonne « 2026 ») comparé aux
    crédits votés de la section (bloquant au-delà de 1 % d'écart), montant de
    chaque programme et de chacun de ses titres comparé à l'annexe « programmes
    par nature économique », colonne « LFR 2025 » comparée à la LFR votée
    (total et titres) ; pour les sections sans budget-programme, comparaison
    par titre ;
  - *nomenclature* : programmes de la LF absents du document ou inconnus,
    intitulés et rang officiels (21001 pilotage et soutien, puis 22001,
    22002…), numéro de titre incompatible avec son libellé (« 4 Dépenses
    d'investissement »), codes d'imputation inexistants (« 3-0-1-10-00 ») ou
    dont le libellé correspond à un autre code (« 3-3-6-11-00 Frais de
    mission » → article 3-6-2) ;
  - un tableau « Rapprochement avec la LF » (document / loi / écart) figure
    dans la structure du document et dans l'export Excel.
  La loi de finances chargée dans DataLab est reconnue comme texte de référence
  (elle n'est pas contrôlée). **Nouvelle loi de finances** (LFI ou LFR) :
  `node scripts/lf-referentiel.mjs chemin/loi-de-finances.pdf` régénère
  `lib/documents/lf-data.ts` (nécessite `pdftotext`, fourni avec Poppler ou
  Git pour Windows), puis relancer le build.
- **Avis** sur chaque document : « non validable en l'état » (anomalie
  bloquante), « validable sous réserve » (anomalies majeures) ou « conforme
  aux contrôles automatiques ». Il tient compte des décisions du relecteur et
  figure dans les rapports d'audit.
- **Relecture** : chaque proposition se marque « corrigée » ou « ignorée »
  (faux positif) ; rien n'est modifié automatiquement.
- **Exports** : rapport d'audit **Word** et **PDF**, classeur **Excel**
  structuré (anomalies avec statut, plan, tableaux extraits, indicateurs
  consolidés de toutes les directions).

Le référentiel (`lib/documents/referentiel.ts`) rassemble ce qui est propre à
l'administration : types de documents et sections attendues, familles de
directions et leurs indicateurs usuels, sigles officiels, sources de
financement. C'est là qu'on l'adapte (nouvelle direction, nouveau modèle de
document, nouveau sigle) — aucune autre partie du code n'est à modifier.

Limites : les PDF scannés ne sont pas lus (pas d'OCR) et les tableaux d'un PDF
sont lus comme du texte — préférer la version Word ou Excel pour contrôler les
chiffres. Les contrôles sont des règles : ils ne comprennent pas le sens du
texte (une incohérence de raisonnement ne sera pas vue) et peuvent produire
des faux positifs, que le relecteur écarte d'un clic.

## Stack technique

- [Next.js 14](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [SheetJS](https://sheetjs.com/) (lecture/écriture Excel), [PapaParse](https://www.papaparse.com/) (CSV)
- [Recharts](https://recharts.org/) (graphiques)
- [jsPDF](https://github.com/parallax/jsPDF) + jspdf-autotable (PDF), [docx](https://docx.js.org/) (Word)
- `lib/ml.ts` : clustering k-means et régression OLS implémentés à la main
  (algèbre linéaire minimale, sans dépendance), pour rester 100 % navigateur.
- Module Documents : [JSZip](https://stuk.github.io/jszip/) + un lecteur XML
  maison pour les .docx, [pdf.js](https://mozilla.github.io/pdf.js/)
  (`pdfjs-dist`, version « legacy », `isEvalSupported: false`) pour les PDF.
  Le worker pdf.js est copié dans `public/` par `scripts/copy-pdf-worker.mjs`
  avant `npm run dev` et `npm run build` (automatique) : il est servi par
  l'application elle-même, sans CDN.
- Aucune base de données. Une unique route serveur optionnelle
  (`app/api/context`) proxy l'API Claude pour l'analyse IA — elle n'est
  appelée que si l'utilisateur active ce mode ; tout le reste s'exécute dans
  le navigateur.

## Démarrer en local

```bash
npm install
npm run dev
# ouvrir http://localhost:3000
```

Un fichier d'exemple volontairement « sale » (doublons, valeurs manquantes,
formats mélangés, valeurs aberrantes) est fourni : `exemples/exemple_donnees.csv`.

Pour activer l'analyse IA optionnelle en local, copie `.env.local.example`
vers `.env.local` et renseigne ta clé :

```bash
cp .env.local.example .env.local
# puis édite .env.local et remplis ANTHROPIC_API_KEY=sk-ant-...
```

Sans cette clé, l'application fonctionne normalement : seul le bouton
« Activer l'analyse IA » renvoie une erreur explicite, tout le reste
(nettoyage, détection de secteur heuristique, ML, exports) reste disponible.

Autres commandes :

```bash
npm run build   # build de production
npm run start   # servir le build
npm run lint    # linter
```

## Déploiement sur Vercel

Le projet est un Next.js standard : Vercel le détecte automatiquement, aucune
configuration particulière n'est nécessaire.

### Option A — via GitHub (recommandé)

1. Crée un dépôt Git et pousse ce dossier :
   ```bash
   git init
   git add .
   git commit -m "DataLab — plateforme d'analyse de données"
   git branch -M main
   git remote add origin https://github.com/<ton-compte>/datalab.git
   git push -u origin main
   ```
2. Sur [vercel.com](https://vercel.com), clique **Add New… → Project**, importe le
   dépôt GitHub.
3. Vercel détecte **Next.js** tout seul :
   - Framework Preset : `Next.js`
   - Build Command : `next build` (par défaut)
   - Output : géré automatiquement
   - Aucune variable d'environnement requise pour les fonctionnalités de
     base. Pour activer l'analyse IA optionnelle, ajoute une variable
     d'environnement **`ANTHROPIC_API_KEY`** (Project Settings → Environment
     Variables) avec ta clé API Anthropic — jamais exposée au navigateur,
     utilisée uniquement par la route serveur `app/api/context`.
4. Clique **Deploy**. En ~1 minute, l'app est en ligne sur une URL
   `https://<projet>.vercel.app`.

Chaque `git push` sur `main` redéploiera automatiquement.

### Option B — via la CLI Vercel

```bash
npm i -g vercel
vercel          # première fois : répond aux questions, garde les valeurs par défaut
vercel --prod   # déploiement en production
```

> Note : le déploiement nécessite de te connecter à **ton** compte Vercel
> (`vercel login`). Il ne peut pas être fait à ta place.

## Structure du projet

```
app/
  layout.tsx        # métadonnées + layout racine
  page.tsx          # orchestrateur (upload → par feuille : nettoyage → analyse → export groupé)
  globals.css       # thème (clair/sombre) et styles
  api/
    context/route.ts # route serveur optionnelle : proxy vers l'API Claude
components/
  FileUpload.tsx    # zone de chargement (renvoie toutes les feuilles du fichier)
  SheetTabs.tsx     # navigation entre les feuilles d'un classeur multi-feuilles
  ContextPanel.tsx  # secteur détecté, colonnes clés, bouton d'analyse IA
  DataTable.tsx     # aperçu tabulaire
  ProfileView.tsx   # profil du jeu de données
  CleaningPanel.tsx # options de nettoyage
  Charts.tsx        # graphiques (Recharts)
  MLPanel.tsx       # UI clustering k-means & régression linéaire
  ExportBar.tsx     # boutons d'export (regroupe les feuilles nettoyées)
lib/
  types.ts          # types partagés (dont SheetInput / WorkbookInput / SheetState / ContextResult)
  parse.ts          # lecture CSV / Excel (toutes feuilles)
  headers.ts        # détection / génération des en-têtes manquants
  sectors.ts        # dictionnaire de secteurs & détection heuristique locale
  context-ai.ts     # appel client vers /api/context (analyse IA optionnelle)
  stats.ts          # inférence de type + fonctions statistiques
  profile.ts        # profilage des colonnes
  clean.ts          # pipeline de nettoyage / apurement
  analyze.ts        # EDA, corrélations, observations
  ml.ts             # clustering k-means & régression linéaire (OLS)
  save-file.ts      # déclenchement robuste du téléchargement (file-saver)
  export-xlsx.ts    # export Excel (multi-feuilles)
  export-pdf.ts     # export PDF (multi-feuilles)
  export-docx.ts    # export Word (multi-feuilles)
  documents/        # module de contrôle de documents
    types.ts        # modèle de document, anomalies, indicateurs
    extract.ts      # point d'entrée navigateur (choix de l'extracteur)
    extract-docx.ts # Word : titres, listes, tableaux fusionnés, images
    extract-pdf.ts  # PDF texte : lignes, paragraphes, intertitres
    extract-sheet.ts# Excel : une feuille = un tableau, en-têtes fusionnés recomposés
    xml.ts, text.ts, numbers.ts  # lecture XML, texte, nombres « à la française »
    structure.ts    # plan, sections, légendes, lecture des tableaux
    classify.ts     # type de document et directions concernées
    referentiel.ts  # à adapter : types, sections attendues, directions, sigles
    lf.ts           # loi de finances : sections, programmes, nomenclature, rattachement
    lf-data.ts      # généré par scripts/lf-referentiel.mjs (ne pas modifier à la main)
    analyze.ts      # orchestration des contrôles
    rules/          # une famille de contrôles par fichier
    export.ts       # rapport d'audit Word / PDF, Excel structuré
components/documents/ # chargement, synthèse, anomalies, structure, exports
app/documents/page.tsx # page du module
scripts/copy-pdf-worker.mjs # copie du worker pdf.js dans public/
scripts/lf-referentiel.mjs  # PDF de la loi de finances → lib/documents/lf-data.ts
exemples/
  exemple_donnees.csv
```

## Limites connues / pistes d'évolution

- Le traitement se fait en mémoire dans le navigateur : très confortable
  jusqu'à quelques centaines de milliers de lignes. Au-delà, prévoir un
  découpage ou un traitement par lots (Web Worker). Le clustering k-means
  s'échantillonne automatiquement au-delà de 20 000 lignes complètes pour
  rester réactif.
- Le clustering et la régression couvrent l'essentiel des besoins courants,
  mais pas la classification supervisée (catégories à prédire) ni des modèles
  plus avancés (arbres, forêts aléatoires, réseaux de neurones). Si ce besoin
  apparaît, la bonne architecture est d'ajouter un backend Python (FastAPI +
  scikit-learn) hébergé séparément (Render/Railway) et de garder ce frontend
  sur Vercel.
- Les dates sont détectées mais traitées comme du texte dans l'analyse ; une
  gestion temporelle dédiée (séries, saisonnalité) serait une évolution utile.
- La détection de secteur heuristique repose sur un dictionnaire de mots-clés
  fixe (`lib/sectors.ts`) : elle couvre les cas courants mais peut se tromper
  sur des noms de colonnes atypiques ou dans une langue non prévue — c'est
  précisément pour ces cas que l'analyse IA optionnelle existe.
- Les suggestions de noms de colonnes de l'IA sont affichées à titre
  informatif mais ne renomment pas automatiquement les colonnes ; les
  appliquer resterait une évolution manuelle à faire dans l'interface.
