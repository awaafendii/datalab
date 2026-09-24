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

## Stack technique

- [Next.js 14](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [SheetJS](https://sheetjs.com/) (lecture/écriture Excel), [PapaParse](https://www.papaparse.com/) (CSV)
- [Recharts](https://recharts.org/) (graphiques)
- [jsPDF](https://github.com/parallax/jsPDF) + jspdf-autotable (PDF), [docx](https://docx.js.org/) (Word)
- `lib/ml.ts` : clustering k-means et régression OLS implémentés à la main
  (algèbre linéaire minimale, sans dépendance), pour rester 100 % navigateur.
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
