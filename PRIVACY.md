# Politique de confidentialité — Orateur

*Dernière mise à jour : 17 août 2026*

Orateur ne collecte, ne stocke et ne transmet **aucune donnée personnelle**.
Il n'y a ni compte, ni analytics, ni traceur, ni serveur appartenant à
l'extension. Rien de ce que vous lisez n'est enregistré.

## Ce que l'extension lit

Pour extraire l'article d'une page ou récupérer votre sélection, l'extension a
besoin d'accéder au contenu des pages que vous visitez (permission « accès à
tous les sites »). Cette lecture se fait **entièrement dans votre navigateur**
et n'est jamais enregistrée ni envoyée nulle part de sa propre initiative.

## Les trois seules requêtes réseau

### 1. L'envoi vers Orateur — uniquement sur votre action

Quand — et seulement quand — vous cliquez sur l'icône de l'extension, sur la
bulle de sélection, ou sur « Lire avec Orateur » dans le menu contextuel, un
onglet s'ouvre sur `https://orateur.digitalekim.net` avec le contenu à lire.

Le contenu voyage dans le *fragment* de l'URL (la partie après `#`), qui par
construction n'est **jamais envoyé au serveur** : il reste dans votre
navigateur et n'est lu que par la page web d'Orateur. Seule l'adresse de la
page d'origine peut être transmise au serveur, quand vous demandez à Orateur de
la récupérer lui-même.

Aucun envoi n'a lieu tant que vous ne déclenchez pas explicitement l'une de ces
actions.

### 2. Les modèles de synthèse vocale — uniquement si vous les activez

L'extension propose deux moteurs de lecture :

- **le moteur du navigateur** (choix par défaut) — aucune requête réseau, aucun
  téléchargement, tout est déjà dans votre système ;
- **Supertonic**, une voix neuronale de meilleure qualité, que vous devez
  activer vous-même dans les réglages de la pastille de lecture.

Si vous activez Supertonic, l'extension télécharge une fois pour toutes ses
modèles depuis `https://huggingface.co` (dépôt public `Supertone/supertonic-3`)
et les conserve dans le stockage privé de l'extension (OPFS). Ce téléchargement
ne transporte aucune information vous concernant : c'est un téléchargement de
fichiers publics, identique pour tout le monde.

**La synthèse elle-même est entièrement locale.** Le texte que vous écoutez ne
quitte jamais votre machine : il n'est envoyé ni à Hugging Face, ni à Orateur,
ni à personne.

### 3. Rien d'autre

L'extension n'émet aucune autre requête réseau.

## Ce qui est stocké sur votre machine

- Vos préférences de lecture (moteur, vitesse, voix), via l'API `storage` du
  navigateur. Elles servent aussi à ce que les onglets se coordonnent : un seul
  peut parler à la fois.
- Les modèles Supertonic dans l'OPFS de l'extension, si vous avez activé ce
  moteur. C'est la raison de la permission `unlimitedStorage`.

Ces données restent locales et disparaissent quand vous désinstallez
l'extension. Vous pouvez aussi les supprimer à tout moment en effaçant les
données de site de l'extension dans les réglages de votre navigateur.

## Permissions et pourquoi elles sont demandées

| Permission | Raison |
|---|---|
| Accès à tous les sites (`<all_urls>`) | Faire apparaître la bulle de sélection et la pastille de lecture sur n'importe quelle page, et y extraire l'article. Aucune page n'est lue tant que vous ne le demandez pas. |
| `activeTab` | Agir sur l'onglet courant après un clic sur l'icône ou le menu contextuel. |
| `contextMenus` | Ajouter les entrées « Lire avec Orateur » et « Lire cette page ». |
| `scripting` | Injecter l'extracteur d'article à la demande. |
| `storage` | Retenir vos préférences de lecture et coordonner les onglets. |
| `unlimitedStorage` | Empêcher le navigateur d'évincer les modèles Supertonic du cache. |
| `offscreen` | Faire tourner la synthèse vocale, qui a besoin d'un `<audio>` absent du service worker. |

## Contact

Une question, un doute, un problème :
<https://github.com/ekimkael/orateur-extension/issues>
