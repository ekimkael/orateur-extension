import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'wxt';

/**
 * Sert le runtime WASM d'onnxruntime-web depuis l'origine de l'extension.
 *
 * Trois fichiers, et pas seulement le `.wasm` : ORT réclame aussi le `.mjs` de
 * glue (qui est le worker faisant tourner l'inférence), demandé par un nom
 * codé en dur que le bundler ne peut pas voir. Et `ort.bundle.min.mjs` est
 * copié pour être importé comme module autonome : son `import.meta.url` résout
 * alors dans `/ort/`, d'où ORT lance ses workers proxy et pthread.
 *
 * Recopié depuis `web/vite.config.ts` — trois dépôts séparés, pas de workspace
 * pour partager ça.
 *
 * Appelé au chargement de cette config, et non depuis un `buildStart` Vite :
 * `wxt prepare` charge la config mais ne lance aucun build, or c'est lui qui
 * génère le type `PublicPath` en listant le contenu réel de `public/`. Copier
 * plus tard laissait `/ort/*` hors de ce type, et `browser.runtime.getURL()`
 * ne typait qu'après un premier build — donc jamais sur un checkout neuf.
 */
function copyOrtAssets() {
  const files = [
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort.bundle.min.mjs',
  ];
  const here = dirname(fileURLToPath(import.meta.url));
  const from = join(here, 'node_modules', 'onnxruntime-web', 'dist');
  const to = join(here, 'public', 'ort');
  mkdirSync(to, { recursive: true });
  for (const file of files) copyFileSync(join(from, file), join(to, file));
}

copyOrtAssets();

// See https://wxt.dev/api/config.html
export default defineConfig({
  // `web-ext` ne cherche que `/Applications/Firefox.app` par défaut : sans
  // Firefox stable installé (seule une édition Developer/Nightly présente),
  // `npm run dev:firefox` échoue avec un `ENOENT` opaque. `FIREFOX_BIN` laisse
  // chacun pointer sur son propre binaire sans committer un chemin personnel.
  webExt: process.env.FIREFOX_BIN ? { binaries: { firefox: process.env.FIREFOX_BIN } } : undefined,
  // L'archive des sources exigée par AMO. WXT en retire déjà les fichiers
  // cachés (`.output`, `.wxt`, `.claude`…), `node_modules` et les tests ;
  // ces trois-là ne sont ni cachés ni utiles au relecteur — `public/ort/` est
  // de toute façon recopié depuis node_modules au chargement de cette config,
  // donc l'envoyer ferait relire 26 Mo de WASM vendored pour rien.
  zip: {
    excludeSources: ['public/ort/**', 'scratchpad/**', 'plans/**'],
  },
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
      // Supertonic met ~400 Mo de modèles ONNX dans l'OPFS de l'extension :
      // sans ça le quota par origine peut les faire évincer. Silencieuse.
      'unlimitedStorage',
      ...(manifestVersion === 3
        ? [
            'scripting',
            // Le moteur a besoin d'une page : un service worker n'a ni DOM, ni
            // <audio>. Firefox MV2 a déjà une page de fond, d'où la condition.
            'offscreen',
          ]
        : ['<all_urls>']),
    ],
    ...(manifestVersion === 3 && {
      host_permissions: ['<all_urls>'],
      // L'isolation cross-origin débloque le WASM multi-thread, qui divise le
      // temps d'inférence par le nombre de threads. Ces deux clés valent pour
      // toutes les pages de l'extension, document offscreen compris — mais pas
      // pour le service worker, où l'isolation n'est pas implémentée.
      cross_origin_opener_policy: { value: 'same-origin' },
      cross_origin_embedder_policy: { value: 'require-corp' },
      // Une CSP personnalisée REMPLACE celle par défaut : elle doit être
      // complète. `wasm-unsafe-eval` autorise l'instanciation WASM ; à noter
      // que `unsafe-eval` reste interdit, donc pas de `new Function` — d'où
      // l'import dynamique direct d'ORT plutôt que le contournement du web app.
      content_security_policy: {
        extension_pages:
          "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self'",
      },
    }),
    // Pas de CSP déclarée en MV2 : Firefox n'exige `wasm-unsafe-eval` qu'en
    // MV3, la CSP par défaut MV2 laisse passer le WASM (vérifié par le spike
    // de phase 0). Et en déclarer une casserait `wxt dev` : WXT écrit toujours
    // `content_security_policy.extension_pages`, un objet, là où MV2 attend une
    // chaîne. La persistance de la page de fond, elle, se déclare dans
    // `defineBackground` — WXT génère la clé `background` et écraserait ce
    // qu'on mettrait ici.
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
