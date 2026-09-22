import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataLab — Analyse automatique de données",
  description:
    "Chargez un fichier CSV ou Excel, nettoyez et apurez automatiquement vos données, explorez-les et exportez le tout en XLSX, PDF ou Word. Traitement 100% dans votre navigateur, avec une détection de secteur d'activité et une analyse IA optionnelle.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
