import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Les modules WebGL de Plotly (regl-scatter2d…) appellent glslify avec
    // des shaders déjà compilés : la version navigateur, qui se contente
    // d'assembler les chaînes, suffit partout. Sans cet alias, la compilation
    // côté serveur embarquerait la version Node (accès disque, avertissement
    // « Critical dependency »).
    config.resolve.alias = {
      ...config.resolve.alias,
      glslify$: require.resolve("glslify/browser.js"),
    };
    return config;
  },
};

export default nextConfig;
