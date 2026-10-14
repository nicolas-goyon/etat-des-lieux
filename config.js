// ============================================================
//  Configuration de l'application « État des lieux »
//  Ce fichier est lu au chargement de la page. Il peut être
//  modifié à la main ou depuis Paramètres > Code d'accès.
// ============================================================
window.EDL_CONFIG = {
  // Titre affiché dans l'application et dans l'onglet du navigateur.
  APP_TITLE: "État des lieux",

  // Empreinte SHA-256 (hexadécimale) du code d'accès.
  // Code par défaut : 1234  →  changez-le dès le premier démarrage !
  // Pour obtenir l'empreinte d'un nouveau code : Paramètres > Code d'accès
  // (l'application affiche la ligne à coller ici), ou dans un terminal :
  //   printf '%s' 'moncode' | sha256sum
  ACCESS_CODE_HASH: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",

  // Dossier du dépôt GitHub dans lequel les états des lieux sont enregistrés.
  DATA_DIR: "data",

  // Serveur de mise en relation pour « téléphone comme appareil photo ».
  // null = serveur public gratuit PeerJS (0.peerjs.com). Il ne voit passer que
  // la mise en relation ; les photos vont directement d'un appareil à l'autre.
  // Pour votre propre serveur (npm « peer ») : { host: "mon-serveur.fr", port: 443, path: "/", secure: true }
  PEER_SERVER: null
};
