import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules";

export const metadata: Metadata = {
  title: "DataLab — Suivi d'exécution budgétaire",
  description:
    "Suivi d'exécution budgétaire : taux d'engagement et de paiement par programme, action ou titre, détection des dépassements et des sous-consommations, rapprochement avec les crédits votés de la loi de finances. Traitement 100 % dans votre navigateur.",
};

export default function ExecutionLayout({ children }: { children: React.ReactNode }) {
  // Module désactivé dans lib/modules.ts : page rendue inaccessible (le code
  // reste en place). Réactiver en repassant `execution` à true.
  if (!isModuleEnabled("execution")) redirect("/");
  return children;
}
