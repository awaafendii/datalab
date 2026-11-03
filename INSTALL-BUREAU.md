# DataLab — Application de bureau (Windows)

DataLab peut être installé comme un vrai logiciel Windows (icône Bureau + menu
Démarrer), sans navigateur ni lien externe. L'application embarque son propre
serveur et fonctionne **hors-ligne**.

## Installer l'application (utilisateur final)

1. Récupérer le fichier **`dist\DataLab Setup 1.0.0.exe`**.
2. Double-cliquer dessus.
3. Au 1ᵉʳ lancement, Windows SmartScreen peut afficher « éditeur inconnu »
   (l'exécutable n'est pas signé par un certificat payant). Cliquer sur
   **« Informations complémentaires » → « Exécuter quand même »**.
4. Choisir le dossier d'installation → un raccourci **DataLab** est créé sur le
   Bureau et dans le menu Démarrer.
5. Double-clic sur l'icône DataLab → l'application s'ouvre dans sa propre
   fenêtre.

> Version portable (sans installation) : le dossier `dist\win-unpacked\` ;
> lancer `DataLab.exe`.

## Analyse IA (optionnelle)

Sans clé, DataLab fonctionne normalement en mode heuristique local. Pour activer
le bouton « Activer l'analyse IA », définir une **variable d'environnement
Windows** `ANTHROPIC_API_KEY` (la clé n'est jamais embarquée dans l'installeur) :

```
setx ANTHROPIC_API_KEY "votre_cle_ici"
```

Puis relancer l'application. L'app transmet cette variable à son serveur interne.

## Reconstruire l'installeur (développeur)

Prérequis : Node.js installé, dépendances présentes (`node_modules`).

```bash
npm run dist
```

Ce script :
1. `next build` (avec `output: "standalone"` dans `next.config.mjs`) ;
2. `node scripts/build-desktop.mjs` — copie `.next/static` et `public/` dans
   `.next/standalone` ;
3. `electron-builder --win` — produit `dist\DataLab Setup <version>.exe`.

### Structure ajoutée pour le bureau

| Fichier | Rôle |
|---|---|
| `electron/main.js` | Point d'entrée Electron : démarre le serveur Next standalone sur un port local libre, puis ouvre la fenêtre native. |
| `scripts/build-desktop.mjs` | Assemble la sortie standalone (copie statique + public). |
| `build/icon.ico` | Icône de l'application. |
| `package.json` → `build` | Configuration electron-builder (cible NSIS, raccourci Bureau). |

### Dépannage réseau (téléchargements volumineux)

- **Binaire Electron** (`npm install` qui bloque / `ECONNRESET`) : télécharger
  manuellement `electron-v<version>-win32-x64.zip` + `SHASUMS256.txt` depuis la
  release GitHub `electron/electron`, vérifier le SHA-256, extraire le contenu
  dans `node_modules/electron/dist/`, puis écrire `electron.exe` dans
  `node_modules/electron/path.txt`.
- **winCodeSign** (erreur « Cannot create symbolic link » sous Windows) :
  l'archive contient des liens symboliques macOS inutiles au build Windows.
  Contournement : copier l'extraction partielle vers le dossier de cache
  `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\` et créer
  des fichiers vides `darwin\10.12\lib\libcrypto.dylib` et `libssl.dylib`.
  Alternative propre : activer le **Mode développeur Windows** (autorise la
  création de liens symboliques sans privilège administrateur).

## Notes

- Les documents sources (`.docx`, `.pdf`, `.xlsx` à la racine) **ne sont jamais
  embarqués** dans l'installeur (le champ `files` ne retient que `electron/` et
  l'icône ; le serveur est ajouté via `extraResources`).
- L'installeur n'étant pas signé, chaque poste affichera l'avertissement
  SmartScreen au 1ᵉʳ lancement. Une signature officielle nécessiterait un
  certificat de signature de code (payant).
