# Orateur — extension navigateur

Envoie l'article de la page courante, ou n'importe quel texte sélectionné,
vers Orateur pour l'écouter.

## Fonctionnalités

- **Icône de la barre d'outils** : extrait l'article de la page active
  (via [Readability](https://github.com/mozilla/readability)) et l'ouvre
  dans Orateur.
- **Menu contextuel « Lire avec Orateur »** : envoie le texte sélectionné,
  même hors d'un article.
- **Bulle flottante** : apparaît au survol d'une sélection, pour lancer la
  lecture sans passer par le menu.

Compatible Chrome (MV3) et Firefox (MV2), via [WXT](https://wxt.dev).

## Développement

```bash
npm install
npm run dev          # Chrome
npm run dev:firefox  # Firefox
npm test             # tests unitaires (lib/*.test.ts)
```

Voir [docs/selection-reader.md](docs/selection-reader.md) pour le
fonctionnement détaillé de la sélection et de la bulle flottante.
