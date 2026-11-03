// Interrupteur central d'activation des modules de navigation.
//
// Désactiver un module le retire de la barre de navigation (components/AppNav.tsx)
// ET rend sa page inaccessible (redirection vers l'accueil depuis le layout du
// module). AUCUN code n'est supprimé : pour réactiver un module, repasser sa
// valeur à `true` ci-dessous — rien d'autre à faire.

export const MODULE_ENABLED = {
  /** Espace « Données » (analyse de données tabulaires) — route `/`. */
  data: true,
  /** Module « Documents » / contrôles CDMT — route `/documents`. Désactivé. */
  documents: false,
  /** Module « Suivi d'exécution budgétaire » — route `/execution`. Désactivé. */
  execution: false,
} as const;

export type ModuleKey = keyof typeof MODULE_ENABLED;

/** Indique si un module est actif (donc visible et accessible). */
export function isModuleEnabled(key: ModuleKey): boolean {
  return MODULE_ENABLED[key];
}
