# Audit des médias tech — 19 octobre 2026

18 nouveaux sites anglophones, en complément de The Verge, TechCrunch, Wired et
Ars Technica déjà visités. **14 articles accessibles, 4 sites bloqués.**
11 sites accessibles nécessitaient des corrections ; les autres conservent
leur contenu éditorial sans adaptation supplémentaire.

| Site | Article testé | Résultat |
| --- | --- | --- |
| Engadget | [Accessibilité sur Steam](https://www.engadget.com/gaming/steam-adds-more-accessibility-features-181606704.html) | HTTP 403 CloudFront ; contenu inaccessible, écran rejeté et repli vide. |
| ZDNET | [Part de marché du bureau Linux](https://www.zdnet.com/article/the-linux-desktop-finally-cracks-the-10-market-share-barrier/) | Corrigé : 34/34 blocs, chapeau récupéré ; renvois « Also », promotion Google et vidéo annexe retirés. |
| CNET | [Couleurs des naines blanches](https://www.cnet.com/science/space/white-dwarf-star-color-variability/) | Corrigé : 18/18 blocs ; chapeau et légende principale récupérés, vidéo annexe retirée. |
| Mashable | [Précommandes de l’iPhone Duo](https://mashable.com/tech/iphone-duo-sells-out-instantly) | Corrigé : 9/9 blocs, chapeau et légende préservés ; biographie, sept messages de tweets indisponibles et inscription newsletter retirés. Les citations disponibles restent lues. |
| VentureBeat | [Le modèle Beam de Reflection](https://venturebeat.com/technology/reflections-beam-aims-to-undercut-chinese-open-models-with-fewer-tokens-not-cheaper-tokens) | 64/64 blocs conservés. Note promotionnelle finale intégrée au texte par la rédaction conservée, faute de séparation fiable. |
| The Next Web | [Modèle de physique CERN/Mistral](https://thenextweb.com/news/cern-mistral-large-physics-model) | Corrigé : 12/12 blocs ; introduction et crédit de l’illustration récupérés, inscription newsletter retirée. |
| TechRadar | [Propulseurs du Tesla Roadster](https://www.techradar.com/vehicle-tech/hybrid-electric-vehicles/how-does-the-new-tesla-roadster-fly-and-is-it-dangerous-to-be-around-its-thrusters) | Corrigé : deux vrais intertitres conservés ; quiz et formulaires associés, promotion Google et biographie retirés. |
| Tom’s Hardware | [Peau souple de mesure 3D du MIT](https://www.tomshardware.com/virtual-reality/mit-engineers-build-soft-3d-shape-sensing-skin-for-gaming-and-vr-tracks-3d-movement-and-touch-with-sub-half-centimeter-error) | Corrigé : chapeau et sept paragraphes visibles écartés par `aria-hidden` récupérés ; interface vidéo et biographie exclues. Vérification sur la mise en page réelle requise pour cette exception. |
| PCMag | [GeForce RTX 5090 Founders Edition](https://www.pcmag.com/reviews/nvidia-geforce-rtx-5090-founders-edition) | HTTP 403, contrôle de sécurité ; aucun corps disponible. |
| PCWorld | [Nvidia et le jeu sur PC](https://www.pcworld.com/article/3260897/nvidia-is-no-longer-a-pc-gaming-company-get-used-to-it.html) | Corrigé : chapeau récupéré et mention de commission retirée ; corps et note éditoriale de newsletter conservés. |
| How-To Geek | [Storage Sense de Windows 11](https://www.howtogeek.com/i-stopped-manually-cleaning-up-windows-11-storage-after-turning-on-this-built-in-tool/) | Corrigé : biographie retirée, prose et intertitres conservés. |
| BleepingComputer | [Faille du pare-feu SiteGuard](https://www.bleepingcomputer.com/news/security/hackers-exploit-siteguard-waf-flaw-to-run-commands-as-system-root/) | HTTP 403, contrôle de sécurité ; aucun corps disponible. |
| The Register | [Modèles d’IA ouverts](https://www.theregister.com/ai-and-ml/2026/10/17/open-weight-models-win-hearts-minds-and-wallets/5303704) | 13/13 paragraphes conservés. Rubrique et marque finale du média conservées. |
| Android Authority | [Réglages Samsung One UI](https://www.androidauthority.com/one-ui-settings-always-turn-off-samsung-galaxy-phone-3721814/) | Deux articles bloqués HTTP 403 Cloudflare ; écrans rejetés, repli vide. |
| Android Central | [Diagnostics de connexion d’Android 17](https://www.androidcentral.com/apps-software/android-os/android-17-will-soon-fix-calls-wi-fi-and-connectivity-itself-for-you) | Corrigé : 12/12 blocs, carte auteur et rôle ajoutés après la conclusion retirés. |
| 9to5Mac | [Gamme iPhone de 2027](https://9to5mac.com/2026/10/18/new-revamped-iphone-lineup-coming-in-2027/) | 30/30 blocs conservés. Liste commerciale d’accessoires intégrée au corps conservée ; aucun marqueur fiable ne la sépare du texte éditorial. |
| MacRumors | [Batterie de l’iPhone Duo](https://www.macrumors.com/2026/10/18/iphone-duo-battery-capacity/) | Corrigé : les 3 paragraphes restent seuls ; cartes d’autres articles et liens de navigation retirés. Sortie de 1 939 à 623 caractères. |
| XDA Developers | [Règles Linux sur le code assisté par IA](https://www.xda-developers.com/linus-calls-banning-ai-generated-code-utterly-stupid-as-linux-submissions-no-longer-need-llm-disclosure/) | Corrigé : 18/18 blocs, résumé et citations conservés ; biographie de l’en-tête retirée. |

## Cas de visibilité

Sur Tom’s Hardware, les sept paragraphes portaient `aria-hidden="true"` tout en
étant lisibles à l’écran. La correction se limite aux paragraphes `.kiosq-b`
du corps de ce domaine : elle exige une boîte de mise en page réelle et des
styles visibles sur le paragraphe et tous ses ancêtres. Une barrière active,
une absence de mise en page, une opacité nulle ou un filtre empêchent cette
récupération. Le DOM d’origine reste inchangé.

Sur TechRadar, un titre social différent du titre visible faisait supprimer un
intertitre par Readability. Le vrai titre est déplacé dans la copie du corps et
le titre social de cette copie est aligné sur lui ; les niveaux des intertitres
restent intacts.

## Validation

12 régressions synthétiques ajoutées : `lib/extract-tech-news-sites.test.ts`,
`lib/extract-hardware-security-sites.test.ts`,
`lib/extract-mobile-enterprise-sites.test.ts`. La suite complète de **328 tests**,
le typage et le build Chrome passent. Comparaison des paragraphes, légendes,
listes, citations, début et fin sur les captures réelles.

Rejeu compilé sur 63 captures des trois premières séries ; les 44 sorties des
deux audits précédents sont inchangées. Tom’s Hardware a aussi été chargé à
nouveau dans Chrome avec le content script compilé : 10/10 blocs attendus,
mise en page visible confirmée et DOM d’origine intact. Le contrôle hors ligne
de ce site tient compte de sa dépendance à la mise en page réelle.

Ces résultats portent sur les articles indiqués. Les quatre sites bloqués
restent à vérifier avec leur vrai contenu ; tous les formats du même média ne
sont pas couverts par un seul article.
