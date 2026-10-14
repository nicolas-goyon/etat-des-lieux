# État des lieux – application web pour GitHub Pages

Application 100 % statique (HTML / CSS / JavaScript, sans build) pour réaliser un **état des lieux d'entrée ou de sortie** d'un appartement, directement sur téléphone, tablette ou ordinateur.

## Fonctionnalités

- **Code d'accès** à l'ouverture (empreinte SHA-256, modifiable depuis l'application).
- **Pièces en onglets** : Entrée, Séjour, Cuisine, Chambre, Salle de bain, WC par défaut. Chaque pièce peut être **renommée, déplacée, dupliquée, supprimée**, et vous pouvez en ajouter autant que nécessaire (modèles : chambre, cuisine, salle de bain, WC, bureau, couloir, cave, balcon, parking, pièce vide…).
- Pour chaque pièce, deux listes :
  - **Éléments de la pièce** : sol, plafond, murs, plinthes, portes, fenêtres/volets, prises, éclairage, chauffage…
  - **Meubles & équipements** : électroménager, mobilier (pré-rempli si « logement meublé »).
- Pour chaque ligne : **état** (Neuf / Bon état / État d'usage / Mauvais état), **fonctionne** (Oui / Non / N/A), **remarques**, **photos multiples**. Ajoutez vos propres lignes, renommez-les, réordonnez-les, supprimez-les.
- **Compteurs** électricité (HP/HC), gaz, eau froide, eau chaude : numéro, relevés (index multiples), remarques, photos. Compteurs ajoutables/supprimables.
- **Clés remises**, **remarques générales**, **remarques par pièce**.
- **Téléphone comme appareil photo** pour le PC ou la tablette : jumelage par QR code, puis chaque prise de photo est déclenchée sur le téléphone et la photo arrive directement sur la bonne ligne.
- **Export PDF** complet (tableaux par pièce, états en couleur, photos, compteurs).
- **Enregistrement automatique sur l'appareil** (IndexedDB) et **enregistrement sur GitHub** : les dossiers (JSON + photos) sont commités dans le dossier `data/` du dépôt qui héberge le site. Un autre appareil peut ensuite **charger le dossier depuis GitHub**.
- **Export / import JSON** (sauvegarde complète, photos incluses).
- Fonctionne **hors connexion** (PWA avec service worker) : utile dans un appartement sans réseau ; l'envoi sur GitHub se fait ensuite.

## Affichage : téléphone, tablette, PC tactile

Le bouton **Affichage** (icône écran + tablette, en haut à droite, présent aussi sur l'écran de connexion et dans ⋮ / Paramètres) permet de choisir :

| Mode | Mise en page |
|---|---|
| **Automatique** (par défaut) | Choisit selon la taille de l'écran, l'orientation et la présence d'un écran tactile ; bascule tout seul quand on tourne la tablette. |
| **Téléphone** | Une colonne, onglets de pièces défilants en haut, fenêtres qui montent du bas de l'écran. |
| **Tablette verticale** | Une colonne large ; chaque ligne est organisée en 2 zones (état + remarques à gauche, fonctionnement + photos à droite). |
| **Tablette horizontale / PC tactile** | Pièces dans une barre latérale à gauche (avec la progression « 3/18 lignes renseignées »), lignes sur 2 colonnes, grandes zones tactiles. |
| **PC (souris)** | Même disposition, plus compacte. |

On peut aussi régler la **taille du texte** (Normal / Grand / Très grand) : toute l'interface s'agrandit. Le choix est mémorisé sur l'appareil.

En mode tactile, tous les boutons font au moins 48 px, les champs ont une police de 16 px minimum (pas de zoom automatique sur iPhone/iPad), et les photos se font défiler d'un balayage du doigt.

## Téléphone comme appareil photo (PC / tablette)

Pratique quand on remplit l'état des lieux sur un PC tactile ou une tablette mais que le téléphone prend de meilleures photos.

1. Dans un dossier, touchez **📱 Téléphone** en haut de l'écran : un QR code s'affiche.
2. Scannez-le avec l'appareil photo du téléphone et ouvrez le lien : la page **« Appareil photo »** s'ouvre sur le téléphone (aucun code d'accès à saisir, le QR code contient une clé propre à la session). Le bouton devient vert : **Téléphone connecté**.
3. Sur le PC / la tablette, touchez **📷 Photos** sur une ligne ou un compteur : le téléphone vibre et affiche « Photo demandée pour Séjour › Sol » avec un grand bouton **Prendre une photo** (ou **Choisir dans la galerie**). On peut en prendre plusieurs à la suite ; chacune arrive aussitôt sur la ligne du PC.
4. **Terminé pour cette ligne** (sur le téléphone) ou **Terminer** (sur le PC) clôt la demande. **Utiliser cet appareil** reprend l'appareil photo / les fichiers du PC.
5. Pour arrêter : **📱 → Déconnecter le téléphone**. Si le téléphone se met en veille ou recharge la page, il se reconnecte tout seul.

Points à connaître :
- Les deux appareils doivent avoir **accès à Internet** (Wi-Fi ou 4G/5G, pas forcément le même réseau).
- Les photos passent **directement d'un appareil à l'autre** (WebRTC, chiffré) ; elles ne sont stockées sur aucun serveur. La mise en relation passe par le serveur public gratuit PeerJS (`0.peerjs.com`) ; vous pouvez héberger le vôtre et le déclarer dans `config.js` (`PEER_SERVER`).
- Le QR code ne fonctionne qu'avec l'adresse publique de l'application (GitHub Pages), pas avec une adresse locale du type `localhost`.
- Sur la page du téléphone, l'écran est maintenu allumé quand le navigateur le permet.

## Déploiement sur GitHub Pages (5 minutes)

1. Créez un dépôt GitHub (par ex. `etat-des-lieux`). **Recommandé : dépôt privé** (voir « Confidentialité » plus bas).
2. Copiez **tout le contenu** de ce zip à la racine du dépôt (y compris `.nojekyll` et le dossier `data/`), puis commitez sur la branche `main`.
3. Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`. Enregistrez.
4. Après 1 à 2 minutes, le site est disponible sur `https://<votre-compte>.github.io/<nom-du-depot>/`.
5. Ouvrez-le, entrez le code d'accès par défaut **`1234`**, puis **changez-le immédiatement** (voir ci-dessous).

> Sur téléphone, ajoutez le site à l'écran d'accueil (« Ajouter à l'écran d'accueil ») : il s'ouvre alors comme une application, plein écran et utilisable hors ligne.

## Changer le code d'accès

Le code n'est jamais stocké en clair : `config.js` contient son empreinte SHA-256.

- Dans l'application : **⋮ → Paramètres → Code d'accès**. Le nouveau code s'applique tout de suite sur l'appareil, et l'application affiche la ligne `ACCESS_CODE_HASH: "…"` à placer dans `config.js`.
  - Si la synchronisation GitHub est configurée, un bouton **« Mettre à jour config.js sur GitHub »** le fait pour vous (le site se republie en 1 à 2 minutes et le nouveau code vaut alors pour tous les appareils).
  - Sinon, modifiez `config.js` à la main dans le dépôt.
- En ligne de commande : `printf '%s' 'moncode' | sha256sum` donne l'empreinte à coller dans `config.js`.

## Activer l'enregistrement sur GitHub

L'application écrit dans le dépôt grâce à l'API GitHub, avec un jeton que **vous** créez et qui reste **uniquement dans le navigateur** (localStorage). Il n'est jamais commité.

1. GitHub → photo de profil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access* : **Only select repositories** → choisissez le dépôt du site.
3. *Permissions → Repository permissions* : **Contents : Read and write** (rien d'autre n'est nécessaire). Choisissez une durée d'expiration.
4. Copiez le jeton (`github_pat_…`).
5. Dans l'application : **⋮ → Paramètres → Synchronisation GitHub** : propriétaire, dépôt (pré-remplis automatiquement sur GitHub Pages), branche (`main`) et jeton. Cliquez **Tester**, puis **Enregistrer**.

Ensuite, le bouton **☁ GitHub** (ou ⋮ → Enregistrer sur GitHub) commite le dossier courant :

```
data/index.json                      ← liste des dossiers
data/dossiers/<id>.json              ← le dossier (références vers les photos)
data/photos/<id>/<photo>.jpg         ← les photos (JPEG ≤ 1600 px)
```

Chaque enregistrement = **un seul commit** (les photos déjà envoyées ne sont pas renvoyées). Sur un autre appareil, **Charger depuis GitHub** (écran d'accueil) liste les dossiers du dépôt et les télécharge, photos comprises. Sans jeton, cette lecture passe par le site GitHub Pages lui-même (une fois le site republié après le commit) ; avec un jeton, elle est immédiate et fonctionne aussi pour un dépôt privé.

Pour supprimer un dossier du dépôt : supprimez `data/dossiers/<id>.json`, le dossier `data/photos/<id>/` et l'entrée correspondante dans `data/index.json` (ou laissez-les : ils n'encombrent que le dépôt).

## Confidentialité et sécurité – à lire

- Le code d'accès est une protection **côté client** : il empêche une utilisation accidentelle ou par un curieux, mais quiconque a accès au dépôt (ou à son contenu publié) peut lire le code source et, si le dépôt est **public**, le dossier `data/` (adresses, photos de l'appartement) est **public aussi**.
- Pour des données réelles, utilisez un **dépôt privé**. GitHub Pages sur un dépôt privé nécessite un abonnement GitHub Pro/Team ; à défaut, vous pouvez garder l'application sur un dépôt public mais **ne pas utiliser l'enregistrement GitHub** (les dossiers restent sur l'appareil + export JSON/PDF), ou pointer la synchronisation vers un **second dépôt privé** (Paramètres → owner/repo), ce qui est possible même si le site est hébergé sur un dépôt public.
- Le jeton d'accès donne le droit d'écrire dans le dépôt choisi : ne le partagez pas, limitez-le à ce dépôt, donnez-lui une date d'expiration et révoquez-le en cas de doute. Il est stocké dans le navigateur ; « Se déconnecter » ne l'efface pas (effacez les données du site pour cela).

## Utilisation quotidienne

- **Nouvel état des lieux** : type (entrée/sortie), adresse, date, logement meublé ou non → les pièces et lignes types sont créées.
- Tout est **enregistré automatiquement sur l'appareil** à chaque saisie (indicateur en bas à gauche).
- **Photos** : bouton 📷 sur chaque ligne ou compteur ; plusieurs photos à la fois, directement depuis l'appareil photo ou la galerie. Touchez une vignette pour l'agrandir, naviguer ou la supprimer. Les photos sont réduites à 1600 px pour rester légères.
- **Tout « Bon état »** : dans une pièce, met « Bon état » sur toutes les lignes qui n'ont pas encore d'état, pour aller vite ; corrigez ensuite les exceptions.
- **PDF** : bouton 📄 PDF (bas de l'écran). **JSON** : ⋮ → Exporter en JSON ; réimportable depuis l'accueil (« Importer un JSON »), par exemple pour transférer un dossier d'un appareil à l'autre sans GitHub.
- **Dupliquer un dossier** : pratique pour préparer l'état des lieux de sortie à partir de celui d'entrée (⋮ → Dupliquer).

## Personnalisation

- `config.js` : titre, empreinte du code, dossier de données, serveur de mise en relation du téléphone.
- `js/templates.js` : lignes par défaut (`ELEMENTS_BASE`), pièces types (`TYPES_PIECE` : éléments, équipements, meubles), compteurs et clés par défaut, pièces créées pour un nouveau dossier (`PIECES_DEFAUT`).
- `css/style.css` : couleurs (`:root`).
- Après toute modification des fichiers de l'application, incrémentez `CACHE` dans `sw.js` (ex. `edl-v1.2.1`) pour que les appareils ayant déjà installé l'application récupèrent la nouvelle version.

## Structure

```
index.html              page unique
config.js               configuration (titre, code d'accès, dossier de données)
manifest.webmanifest    PWA
sw.js                   service worker (hors ligne)
css/style.css
js/app.js               interface et logique
js/display.js           mode d'affichage (auto / téléphone / tablette / PC) et taille du texte
js/remote.js            téléphone comme appareil photo (QR code, liaison PeerJS)
js/templates.js         modèles de pièces, lignes, compteurs
js/store.js             stockage local (IndexedDB)
js/github.js            enregistrement / chargement GitHub (API REST)
js/pdf.js               génération du PDF
js/util.js, js/sha256.js
vendor/jspdf.umd.min.js bibliothèque PDF (licence MIT, voir vendor/jspdf.LICENSE)
vendor/peerjs.min.js    liaison directe entre appareils (licence MIT, voir vendor/peerjs.LICENSE)
vendor/qrcode.js        générateur de QR code (licence MIT, Kazuhiko Arase)
icons/                  icônes de l'application
data/                   dossiers enregistrés par l'application (créé vide)
.nojekyll               désactive Jekyll sur GitHub Pages
```

## Compatibilité

Navigateurs récents (Chrome, Edge, Firefox, Safari iOS 15+ / macOS). Aucune dépendance en ligne : tout est servi depuis le dépôt ; seules la synchronisation (`api.github.com`) et la mise en relation avec le téléphone (`0.peerjs.com`) sortent du site.
