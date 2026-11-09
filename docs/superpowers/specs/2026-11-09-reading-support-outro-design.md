# Fin de lecture : remerciement et appel au soutien — design

Date : 2026-11-09. Statut : brouillon, à valider.

## Intention

Orateur est gratuit et développé par une seule personne. L'app web remercie déjà l'auditeur en fin d'article et, un article sur trois, l'invite à soutenir le projet (`web/app/lib/reading-outro.ts`), avec un bouton « Soutenir sur Chariow » dans la bannière de fin (`web/app/components/article/end-banner.tsx`). L'extension s'arrête net : à la fin de l'article, la pastille revient au repos sans un mot.

Objectif : remercier à chaque fin d'article, inviter au don un article sur trois, et donner un lien cliquable au moment où l'invitation est entendue.

Hors périmètre : abonnements (rien n'existe encore dans l'extension ; voir « Plus tard ») ; page d'options ; lectures de sélection (bulle et menu contextuel) ; PDF.

## Textes retenus

| Où | FR | EN |
|---|---|---|
| Voix, à chaque fin d'article | Fin de l'article, merci d'avoir écouté. | End of the article, thank you for listening. |
| Voix, 1 article sur 3 (ajoutée après) | Orateur est développé par une seule personne. Si cette lecture vous a été utile, un petit don m'aide à continuer. Le lien est juste à côté. | Orateur is built by one person. If this reading was useful, a small donation helps me keep going. The link is right there. |
| Toast de la pastille, 1 article sur 3 | Merci d'avoir écouté · ♥ Soutenir | Thanks for listening · ♥ Support |

## Comportement attendu

1. Fin naturelle d'une lecture d'article (pas un ⏹, pas une erreur) : la voix enchaîne sur le remerciement, avec le même moteur et la même voix.
2. Un article terminé sur trois (le 1er, le 4e, le 7e…, compteur par navigateur), la phrase de soutien suit le remerciement, et la pastille passe en toast « Merci d'avoir écouté · ♥ Soutenir » pendant qu'elle est lue.
3. « ♥ Soutenir » ouvre la page de don Chariow dans un nouvel onglet (même URL que le web : `SUPPORT_URL` de `web/app/lib/feedback.ts`).
4. Le toast reste 8 s après la fin de la voix, avec les mêmes règles que le toast de masquage : pause au survol, au focus et onglet caché ; Échap le ferme ; `role="status"`. Puis la pastille revient au repos.
5. Pendant l'outro, ⏹ coupe la voix et ramène la pastille au repos. ▶ relance une lecture normale.
6. Langue de l'outro = langue de la lecture : FR si elle commence par `fr`, EN si `en`. Autre langue : pas de voix d'outro (une voix Supertonic espagnole ne doit pas lire du français), mais le toast s'affiche quand même, dans la langue de l'interface.
7. Le surligneur ne bouge pas et la progression (n / total) n'avance pas pendant l'outro : ce n'est pas un paragraphe de la page. La progression enregistrée est effacée comme aujourd'hui.
8. Télémétrie, sans propriété : `support_prompt_shown` à l'affichage du toast, `support_cta_clicked` au clic. Ajout dans `docs/analytics.md` et `PRIVACY.md`.

## Options comparées (comment faire parler l'outro)

| Option | Problème résolu ici | Coût |
|---|---|---|
| Code direct : `speechSynthesis.speak()` sur la page après `ended` | Une phrase lue, en quelques lignes. | Avec Supertonic ou Pocket, la voix change brutalement pour une voix système ; contourne le `Player` (AGENTS.md : les moteurs ne passent que par lui). |
| Ajouter l'outro comme dernier paragraphe de la lecture | Même moteur, même voix, zéro code de moteur. | Le compteur affiche un paragraphe de trop, le surligneur et la relecture depuis le DOM (`livePage`, pages traduites) cherchent un bloc qui n'existe pas, la position enregistrée peut pointer dessus. |
| Option `outro` dans le contrat `Player` : chaque moteur lit une phrase en plus après le dernier bloc | Un seul `ended`, voix identique, pas d'enchaînement côté session. | Trois moteurs à modifier (`system-player`, `local-player` et l'hôte TTS) et à tester, pour une phrase. |
| Séquence dans la session (retenue) : à `ended`, la session crée un second `Player` d'un seul paragraphe, titre vide, même `selection` | Même moteur et même voix via le contrat existant ; aucun moteur ne change. | Un état « outro » dans `lib/reading-session.ts` : ses `playing` ne déplacent ni le surligneur ni la position, son `ended` replie la pastille. Le modèle est déjà chargé, donc pas d'attente notable. |

Recommandation : séquence dans la session. Elle réutilise `createPlayer` tel quel, garde les moteurs intacts, et la règle « la session ignore les événements d'un player qui n'est pas le courant » couvre déjà les ⏹ et relances pendant l'outro.

## Conception

- **`lib/reading-outro.ts`** (nouveau, + test `node --test`) : `buildReadingOutro(lang, completedCount)` renvoie `{ speech: string, support: boolean }` (`speech` vide hors fr/en) ; `SUPPORT_CADENCE = 3` ; `SUPPORT_URL`, la même que le web. Le compteur vit dans `browser.storage.local` (`orateur:completed-articles`) ; stockage indisponible → compteur 0, donc l'invitation (même repli que le web).
- **`lib/reading-session.ts`** : à `ended` d'une lecture d'article, lit et incrémente le compteur, crée le player d'outro si `speech`, et appelle `view.showSupport()` si `support`. Les événements du player d'outro ne passent pas par `onPlayerEvent` de la lecture.
- **`lib/reader-messages.ts` / `entrypoints/background.ts`** : un champ explicite `outro: true` sur les lectures d'article et le repli texte de page, pour ne pas déduire « article » de `livePage`. Pas pour un post X (`announceTitle: false`) : un remerciement après un tweet serait plus long que lui.
- **`entrypoints/reader.content/pill.ts`** et **`styles.ts`** : `showSupport(onOpen)`, qui réutilise la mécanique du toast de masquage (`confirmHidden` : animation, minuteur, Échap, focus) en la factorisant si besoin, sans changer son comportement.
- Le lien est un vrai `<a target="_blank" rel="noopener noreferrer">` dans le toast : pas de `window.open`, pas de nouvelle permission.
- **`public/_locales/{en,fr}/messages.json`** : textes du toast et de l'outro, noms sans tiret.
- **`lib/telemetry.ts`**, **`docs/analytics.md`**, **`PRIVACY.md`** : les deux événements.
- **Tests** : `lib/reading-outro.test.ts` (cadence, langues, repli) ; `lib/reading-session.test.ts` (outro après `ended` seulement, pas après ⏹ ni erreur, pas pour une sélection, surligneur immobile) ; e2e : le toast apparaît à la 1re fin d'article et le lien pointe sur Chariow.

## Réglages (ajout du 2026-11-09)

Le soutien est aussi accessible hors lecture, dans la page de réglages :

- Une 7e section « Soutenir » dans le menu (`#soutien`, icône cœur). Titre « Soutenir Orateur » / « Support Orateur ». Description « Orateur est gratuit et développé par une seule personne. Si l'extension vous est utile, un don m'aide à continuer. » / « Orateur is free and built by one person. If the extension is useful to you, a donation helps me keep going. ». Bouton-lien `btn-primary` « ♥ Faire un don » / « ♥ Donate ».
- Un lien « ♥ Soutenir » / « ♥ Support » dans le pied de page, à côté de « Ouvrir Orateur », visible depuis toutes les sections.
- Les deux ouvrent `SUPPORT_URL` dans un nouvel onglet.
- `support_cta_clicked` gagne une propriété fermée `source` : `pill`, `options_section` ou `options_footer`. Sans elle, les clics des réglages fausseraient le taux de clic de l'outro.

## Plus tard (non construit)

- Abonnés : quand l'abonnement existera, `buildReadingOutro` recevra un booléen et ne proposera plus le don. Aucun code anticipé d'ici là.
- Si Chariow change, l'URL est dans l'extension : il faudra une nouvelle version. Alternative possible plus tard : pointer vers une page du site qui redirige.

## Vérification

`npm run compile`, `npm test`, `npm run zip && npm run zip:firefox && npm run test:packages`, suites e2e Chrome et Firefox. Écoute réelle dans Chrome et Firefox, voix système et Supertonic, page FR, page EN et page espagnole (toast sans voix).
