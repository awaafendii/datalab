# DataLab — Plateforme d'analyse de données

Chargez un fichier **CSV** ou **Excel**, nettoyez et apurez automatiquement vos
données, explorez-les (statistiques, graphiques, corrélations, observations
générées) puis exportez le tout en **XLSX**, **PDF** ou **Word**.

> ⚙️ 100 % côté navigateur : vos données ne quittent jamais votre machine, aucun
> serveur ne les reçoit. C'est aussi ce qui rend le déploiement sur Vercel
> instantané et gratuit — il n'y a pas de backend à héberger.

## Fonctionnalités

- **Chargement** CSV / XLS / XLSX (glisser-déposer ou parcourir).
- **Profilage automatique** : type de chaque colonne (numérique, texte, date,
  booléen), valeurs manquantes, valeurs uniques, min/max/moyenne/médiane, etc.
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
  PDF et Word (rapport complet).

## Stack technique

- [Next.js 14](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [SheetJS](https://sheetjs.com/) (lecture/écriture Excel), [PapaParse](https://www.papaparse.com/) (CSV)
- [Recharts](https://recharts.org/) (graphiques)
- [jsPDF](https://github.com/parallax/jsPDF) + jspdf-autotable (PDF), [docx](https://docx.js.org/) (Word)
- `lib/ml.ts` : clustering k-means et régression OLS implémentés à la main
  (algèbre linéaire minimale, sans dépendance), pour rester 100 % navigateur.
- Aucune base de données, aucune API : tout s'exécute dans le navigateur.

## Démarrer en local

```bash
npm install
npm run dev
# ouvrir http://localhost:3000
```

Un fichier d'exemple volontairement « sale » (doublons, valeurs manquantes,
formats mélangés, valeurs aberrantes) est fourni : `exemples/exemple_donnees.csv`.

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
   - Aucune variable d'environnement requise.
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
  page.tsx          # orchestrateur (upload → nettoyage → analyse → export)
  globals.css       # thème (clair/sombre) et styles
components/
  FileUpload.tsx    # zone de chargement
  DataTable.tsx     # aperçu tabulaire
  ProfileView.tsx   # profil du jeu de données
  CleaningPanel.tsx # options de nettoyage
  Charts.tsx        # graphiques (Recharts)
  MLPanel.tsx       # UI clustering k-means & régression linéaire
  ExportBar.tsx     # boutons d'export
lib/
  types.ts          # types partagés
  parse.ts          # lecture CSV / Excel
  stats.ts          # inférence de type + fonctions statistiques
  profile.ts        # profilage des colonnes
  clean.ts          # pipeline de nettoyage / apurement
  analyze.ts        # EDA, corrélations, observations
  ml.ts             # clustering k-means & régression linéaire (OLS)
  export-xlsx.ts    # export Excel
  export-pdf.ts     # export PDF
  export-docx.ts    # export Word
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
