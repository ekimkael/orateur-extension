import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ browser, manifestVersion }) => ({
    name: 'Orateur',
    description:
      "Écoute l'article de la page courante ou n'importe quel texte sélectionné.",
    // `action` vide (sans popup) pour que le clic sur l'icône déclenche
    // onClicked. WXT le traduit en `browser_action` sur MV2.
    action: {},
    // activeTab plutôt que `tabs` : donne accès à tab.url/tab.title au clic
    // utilisateur sans l'avertissement "lire votre historique de navigation".
    // activeTab seul suffit à injecter l'extracteur dans l'onglet actif après un
    // clic. La bulle de sélection, elle, doit être présente avant le geste de
    // l'utilisateur : son content script déclare `<all_urls>`, et c'est lui —
    // pas cette liste — qui vaut l'avertissement d'accès à tous les sites.
    // `scripting` n'existe qu'en MV3 ; MV2 passe par tabs.executeScript.
    permissions: [
      'contextMenus',
      'activeTab',
      ...(manifestVersion === 3 ? ['scripting'] : []),
    ],
    // WXT ne retire pas cette clé du build Chrome, d'où la condition.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'orateur@ekimkael',
          // Obligatoire pour toute nouvelle extension Firefox depuis nov. 2025.
          // L'extension ne transmet rien : elle ouvre une URL dans un onglet.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
