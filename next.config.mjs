import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sortie « standalone » : Next produit un serveur Node minimal et autonome
  // (.next/standalone/server.js + node_modules réduits) que l'application de
  // bureau Electron embarque et lance en interne. Sans incidence sur le
  // déploiement web habituel (Vercel ignore ce dossier).
  output: "standalone",
  webpack(config) {
    // Les modules WebGL de Plotly (regl-scatter2d…) appellent glslify avec
    // des shaders déjà compilés : la version navigateur, qui se contente
    // d'assembler les chaînes, suffit partout. Sans cet alias, la compilation
    // côté serveur embarquerait la version Node (accès disque, avertissement
    // « Critical dependency »).
    config.resolve.alias = {
      ...config.resolve.alias,
      glslify$: require.resolve("glslify/browser.js"),
      // ExcelJS (export Excel, chargé à la demande) : version navigateur
      // autonome, aussi côté serveur, pour ne pas compiler sa version Node
      // (flux, fichiers, archiveur).
      exceljs$: require.resolve("exceljs/dist/exceljs.min.js"),
    };
    return config;
  },
};

export default nextConfig;
