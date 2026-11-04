import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DataLab — Assistant IA",
  description:
    "Assistant d'analyse par chat : décrivez en langage naturel la transformation souhaitée (regrouper, calculer, filtrer, restructurer), DataLab l'exécute localement et produit un document final exportable.",
};

export default function AssistantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
