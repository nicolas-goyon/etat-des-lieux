# État des lieux – serveur local (Docker Desktop)

Application d'état des lieux (entrée / sortie) qui tourne **sur votre PC**, dans Docker. Le PC sert de serveur : vous l'utilisez directement, et une tablette ou un téléphone sur le même Wi-Fi s'y connectent avec un navigateur. **Rien ne passe par Internet** et toutes les données restent sur le PC.

```
  Tablette / PC tactile ──┐
                          ├── Wi-Fi ──►  PC (Docker)  ──►  dossier data\  (dossiers, photos, PDF)
  Téléphone (photos) ─────┘
```

## Fonctionnalités

- **Code d'accès** vérifié par le serveur (code initial dans `.env`, modifiable ensuite dans l'application).
- **Pièces en onglets**, modifiables : renommer, déplacer, dupliquer, supprimer, ajouter (modèles : chambre, cuisine, salle de bain, WC, bureau, cave, balcon, parking, pièce vide…).
- Pour chaque pièce : **éléments** (sol, plafond, murs, plinthes, portes, fenêtres, prises, éclairage, chauffage…) et **meubles & équipements**. Chaque ligne a un **état**, un champ **fonctionne oui/non**, des **remarques** et **plusieurs photos**. Vous pouvez ajouter vos propres lignes.
- **Compteurs** électricité (HP/HC), gaz, eau froide et eau chaude : numéro, relevés, remarques et photos.
- **Clés remises**, remarques générales, remarques par pièce.
- **Export PDF** : le PDF est téléchargé et une copie est **archivée sur le PC**.
- **Téléphone comme appareil photo** pour le PC ou la tablette, après jumelage par QR code.
- **Affichage** au choix : téléphone, tablette verticale, tablette horizontale / PC tactile, PC souris. On peut aussi agrandir le texte.
- **Enregistrement automatique** sur le PC. Si le Wi-Fi coupe, la saisie est gardée sur l'appareil et envoyée dès que la connexion revient.
- Plusieurs appareils peuvent ouvrir le même dossier. Si deux appareils le modifient en même temps, l'application le détecte et vous fait choisir la version à garder.

## Installation (une seule fois)

1. Installez **Docker Desktop** pour Windows : https://www.docker.com/products/docker-desktop/ (choisissez le moteur WSL 2, proposé par défaut).
2. Dans Docker Desktop, ouvrez **Settings → General** et cochez **« Start Docker Desktop when you sign in to your computer »**. C'est ce réglage qui relance automatiquement l'application après un redémarrage du PC.
3. Décompressez ce dossier à un endroit stable, par exemple `C:\EtatDesLieux`. Évitez un dossier OneDrive, dont la synchronisation pourrait gêner l'écriture des données.
4. Ouvrez le fichier **`.env`** avec le Bloc-notes et remplacez **`ACCESS_CODE=1234`** par votre propre code.
5. Double-cliquez sur **`demarrer.bat`**. Le script :
   - lance Docker Desktop s'il ne tourne pas ;
   - détecte l'adresse IP du PC sur le Wi-Fi, pour le QR code du téléphone ;
   - construit et démarre le serveur (la première fois prend 1 à 2 minutes) ;
   - affiche les adresses et ouvre le navigateur sur **http://localhost:8080**.

Si Windows demande l'autorisation réseau pour Docker, acceptez-la pour les **réseaux privés**.

## Utilisation au quotidien

- **Sur le PC** : http://localhost:8080
- **Sur la tablette** : l'adresse affichée par `demarrer.bat`, du type `http://192.168.1.20:8080`. La tablette doit être sur le même Wi-Fi que le PC. Ajoutez la page à l'écran d'accueil pour l'ouvrir comme une application.
- Après un redémarrage du PC, l'application redémarre toute seule avec Docker Desktop. Relancez `demarrer.bat` seulement si vous changez de réseau Wi-Fi, car l'adresse du PC change aussi.
- **`arreter.bat`** arrête le serveur. Les données sont conservées.

### Dans un logement sans Wi-Fi

Activez le **partage de connexion** du téléphone, puis connectez-y le PC (et la tablette si vous en utilisez une). Lancez ensuite `demarrer.bat`, qui détecte la nouvelle adresse du PC. Les échanges restent locaux et ne consomment presque pas de données mobiles.

### Téléphone comme appareil photo

1. Dans un dossier, touchez **📱 Téléphone** en haut de l'écran : un QR code s'affiche.
2. Le téléphone, connecté au **même Wi-Fi**, scanne le QR code et ouvre la page **« Appareil photo »**. Aucun code d'accès n'est demandé : le QR code contient une clé propre à cette session, qui permet seulement d'envoyer des photos.
3. Touchez **📷 Photos** sur une ligne du PC ou de la tablette. Le téléphone vibre et affiche « Photo demandée pour Séjour › Sol ». Prenez une ou plusieurs photos : elles arrivent directement sur la bonne ligne.
4. Pour finir, touchez **Terminé** sur le téléphone ou **Terminer** sur le PC. **Utiliser cet appareil** reprend l'appareil photo ou les fichiers du PC.

Si le téléphone n'arrive pas à ouvrir le lien, l'adresse du PC est sans doute mauvaise. Corrigez-la avec « Modifier l'adresse du PC » dans la fenêtre du QR code, ou relancez `demarrer.bat`.

## Données et sauvegardes

Toutes les données sont dans le dossier **`data`**, à côté de `docker-compose.yml`. Le chemin se change avec `DATA_PATH` dans `.env`. Ce dossier est monté dans le conteneur : il survit à l'arrêt du conteneur, de Docker et au redémarrage du PC.

```
data\
  dossiers\<id>\dossier.json          le dossier (texte, états, remarques…)
  dossiers\<id>\photos\*.jpg          les photos (et leurs vignettes *_t.jpg)
  dossiers\<id>\pdf\*.pdf             les PDF générés
  dossiers\<id>\historique\rev-*.json les 10 versions précédentes (filet de sécurité)
  corbeille\                          les dossiers supprimés, gardés 30 jours
  auth.json, secret.key               le code d'accès (chiffré) et la clé des sessions
```

- **`sauvegarder.bat`** crée `backups\edl-AAAAMMJJ-HHMM.zip`, une copie complète du dossier `data`. Copiez-la régulièrement sur une clé USB ou un disque externe.
- Pour **restaurer** une sauvegarde : lancez `arreter.bat`, remplacez le contenu de `data` par celui du zip, puis lancez `demarrer.bat`.
- Depuis l'application : **⋮ → Exporter en JSON** produit un fichier autonome, photos comprises. Il se réimporte avec « Importer un JSON » sur l'accueil.

## Fichier `.env`

| Variable | Rôle | Défaut |
|---|---|---|
| `ACCESS_CODE` | Code d'accès initial (4 caractères minimum). Si vous le **modifiez ici**, il redevient le code valable au démarrage suivant, ce qui sert en cas d'oubli. | `1234` |
| `APP_TITLE` | Nom affiché | `État des lieux` |
| `PORT` | Port du PC | `8080` |
| `PUBLIC_URL` | Adresse du PC sur le Wi-Fi, utilisée par le QR code. Laissez vide : `demarrer.bat` la détecte. | *(vide)* |
| `DATA_PATH` | Dossier des données sur le PC | `./data` |
| `SESSION_DAYS` | Durée de « Rester connecté » | `30` |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | Nombre d'essais de code autorisés, puis durée du blocage | `8` / `15` |
| `TRASH_DAYS` | Durée de conservation dans la corbeille | `30` |
| `HISTORY_KEEP` | Nombre de versions gardées par dossier | `10` |
| `MAX_UPLOAD_MB` | Taille maximale d'une photo | `25` |
| `HTTPS` | `true` = chiffrement du Wi-Fi local avec un certificat auto-signé (voir plus bas) | `false` |
| `TZ` | Fuseau horaire des journaux | `Europe/Paris` |

Après toute modification de `.env`, relancez `demarrer.bat`.

## Sécurité

- Le code d'accès est vérifié **par le serveur**. Il est stocké haché (scrypt) et n'est jamais envoyé aux navigateurs.
- Les sessions passent par un cookie protégé (HttpOnly, SameSite=Strict, signé). Changer le code déconnecte tous les autres appareils.
- Après 8 codes faux, l'adresse concernée est bloquée 15 minutes.
- Le serveur ajoute une protection contre les requêtes venant d'autres sites (CSRF) et des en-têtes de sécurité stricts (CSP, anti-iframe…).
- Les photos et les dossiers ne sont accessibles qu'après connexion.
- L'application est faite pour le **réseau local**. **N'ouvrez pas le port 8080 sur Internet** (pas de redirection de port sur la box).
- **`HTTPS=true`** chiffre aussi les échanges sur le Wi-Fi. Le certificat est auto-signé : chaque appareil affiche une fois un avertissement à accepter (« Paramètres avancés → Continuer »). Pour le Wi-Fi de la maison, `false` est en général suffisant. Pour un Wi-Fi partagé ou public, préférez `true`.

## Commandes utiles

Ouvrez un terminal dans le dossier de l'application :

```
docker compose ps              état du serveur
docker compose logs -f         journaux en direct
docker compose restart         redémarrage
docker compose up -d --build   reconstruit après une mise à jour des fichiers
```

**Mettre à jour l'application** : remplacez tous les fichiers **sauf `.env` et `data`**, puis lancez `demarrer.bat`.

## Dépannage

| Problème | Solution |
|---|---|
| `demarrer.bat` indique que Docker ne répond pas | Ouvrez Docker Desktop, attendez « Engine running », puis relancez le script. |
| La tablette ou le téléphone n'arrive pas à se connecter | Vérifiez que les appareils sont sur le même Wi-Fi. Mettez le Wi-Fi du PC en profil **Réseau privé** (Paramètres → Réseau et Internet → Wi-Fi → propriétés). Autorisez Docker Desktop dans le pare-feu Windows. Certaines box isolent les appareils sur le Wi-Fi invité : utilisez le Wi-Fi principal. |
| Le QR code contient une mauvaise adresse | Relancez `demarrer.bat`, ou utilisez « Modifier l'adresse du PC » dans la fenêtre du QR code. |
| Code d'accès oublié | Mettez un nouveau `ACCESS_CODE` dans `.env` et relancez `demarrer.bat`. |
| « Conflit de modifications » | Le même dossier a été modifié sur deux appareils. Choisissez la version à garder. Les versions précédentes restent dans `data\dossiers\<id>\historique`. |
| Le port 8080 est déjà utilisé | Changez `PORT` dans `.env` (par exemple 8090) et relancez. |

## Contenu

```
demarrer.bat / arreter.bat / sauvegarder.bat   scripts Windows (double-clic)
scripts\*.ps1                                  leur contenu (PowerShell)
.env / .env.example                            configuration
docker-compose.yml, Dockerfile                 déploiement Docker
server\server.js                               serveur Node.js (sans dépendance externe)
public\                                        application web (HTML / CSS / JS)
public\vendor\                                 jsPDF (MIT) et générateur de QR code (MIT, Kazuhiko Arase)
```
