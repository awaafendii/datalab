"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSearch, Table2, Wallet } from "lucide-react";
import { isModuleEnabled } from "@/lib/modules";

// Navigation entre les modules : analyse de données tabulaires, contrôle de
// documents et suivi d'exécution budgétaire. Les modules désactivés dans
// lib/modules.ts ne sont pas affichés (le code des pages reste en place).
export default function AppNav() {
  const path = usePathname() ?? "/";
  const isDocs = path.startsWith("/documents");
  const isExec = path.startsWith("/execution");
  const isData = !isDocs && !isExec;
  return (
    <nav className="app-nav" aria-label="Modules">
      <Link href="/" className={isData ? "active" : ""}>
        <Table2 size={15} /> Données
      </Link>
      {isModuleEnabled("documents") && (
        <Link href="/documents" className={isDocs ? "active" : ""}>
          <FileSearch size={15} /> Documents
        </Link>
      )}
      {isModuleEnabled("execution") && (
        <Link href="/execution" className={isExec ? "active" : ""}>
          <Wallet size={15} /> Exécution
        </Link>
      )}
    </nav>
  );
}
