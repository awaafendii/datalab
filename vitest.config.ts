import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests unitaires du cœur logique (fonctions pures, sans DOM) : parsing des
// nombres « à la française », outils texte, référentiel loi de finances,
// utilitaires de contrôle. Lancés par `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
