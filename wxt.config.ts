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
    // La bulle de sélection et la pastille de lecture doivent être présentes
    // avant le geste de l'utilisateur : leurs content scripts déclarent
    // `<all_urls>`, et c'est cela — pas cette liste — qui vaut l'avertissement
    // d'accès à tous les sites.
    //
    // Un match de content script n'autorise pourtant pas le background à
    // injecter l'extracteur : il faut une permission d'hôte. `activeTab` ne la
    // couvre qu'après un clic sur l'icône ou le menu contextuel — le clic sur
    // la pastille, lui, n'est pas un geste au sens du navigateur. D'où
    // `<all_urls>` explicite, sans avertissement supplémentaire puisqu'il est
    // déjà affiché. `activeTab` reste utile quand l'utilisateur restreint
    // l'accès aux sites à « au clic » : la permission d'hôte saute, pas lui.
    //
    // `scripting` n'existe qu'en MV3 ; MV2 passe par tabs.executeScript et loge
    // ses permissions d'hôte dans la même liste.
    permissions: [
      'contextMenus',
      'activeTab',
      // Le moteur de synthèse est partagé par tout le navigateur, alors qu'il y
      // a une pastille par onglet : `storage` sert de canal entre elles pour
      // que celle qui perd la parole se replie. Permission silencieuse.
      'storage',
      ...(manifestVersion === 3 ? ['scripting'] : ['<all_urls>']),
    ],
    ...(manifestVersion === 3 && { host_permissions: ['<all_urls>'] }),
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
