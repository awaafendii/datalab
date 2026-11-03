import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules";

export const metadata: Metadata = {
  title: "DataLab — Contrôle de documents",
  description:
    "Structuration et contrôle automatique de documents administratifs (rapports, stratégies, CDMT, cahiers des charges, TdR, matrices d'indicateurs) : calculs, cohérence, complétude, indicateurs et rédaction. Traitement 100 % dans votre navigateur.",
};

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  // Module désactivé dans lib/modules.ts : page rendue inaccessible (le code
  // reste en place). Réactiver en repassant `documents` à true.
  if (!isModuleEnabled("documents")) redirect("/");
  return children;
}
