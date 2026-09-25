"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSearch, Table2 } from "lucide-react";

// Navigation entre les deux modules : analyse de données tabulaires et
// contrôle de documents.
export default function AppNav() {
  const path = usePathname() ?? "/";
  const docs = path.startsWith("/documents");
  return (
    <nav className="app-nav" aria-label="Modules">
      <Link href="/" className={docs ? "" : "active"}>
        <Table2 size={15} /> Données
      </Link>
      <Link href="/documents" className={docs ? "active" : ""}>
        <FileSearch size={15} /> Documents
      </Link>
    </nav>
  );
}
