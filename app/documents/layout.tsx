import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DataLab — Contrôle de documents",
  description:
    "Structuration et contrôle automatique de documents administratifs (rapports, stratégies, CDMT, cahiers des charges, TdR, matrices d'indicateurs) : calculs, cohérence, complétude, indicateurs et rédaction. Traitement 100 % dans votre navigateur.",
};

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
