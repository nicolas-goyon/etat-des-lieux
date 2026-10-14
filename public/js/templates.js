/* Modèles : états possibles, pièces types, compteurs et clés par défaut. */
(function () {
  'use strict';

  const ETATS = ['Neuf', 'Bon état', "État d'usage", 'Mauvais état'];
  const ETAT_CLASS = { 'Neuf': 'e-neuf', 'Bon état': 'e-bon', "État d'usage": 'e-usage', 'Mauvais état': 'e-mauvais' };
  const FONCTIONNE = [['oui', 'Oui'], ['non', 'Non'], ['na', 'N/A']];
  const FONCTIONNE_LABEL = { oui: 'Oui', non: 'Non', na: '—' };

  const ELEMENTS_BASE = [
    'Sol', 'Plafond', 'Murs', 'Plinthes', 'Porte(s)', 'Fenêtre(s) / volets',
    'Prises & interrupteurs', 'Éclairage', 'Chauffage / radiateur'
  ];

  /* Pour chaque type de pièce :
       elements    → lignes « Éléments de la pièce » (toujours créées)
       equipements → lignes « Meubles & équipements » (toujours créées)
       meubles     → lignes « Meubles & équipements » créées seulement si logement meublé */
  const TYPES_PIECE = {
    standard:  { nom: 'Pièce', elements: ELEMENTS_BASE, equipements: [], meubles: [] },
    entree:    { nom: 'Entrée', elements: [...ELEMENTS_BASE, 'Interphone / sonnette', 'Placard'], equipements: [],
                 meubles: ['Portemanteau', 'Meuble à chaussures'] },
    sejour:    { nom: 'Séjour', elements: ELEMENTS_BASE, equipements: [],
                 meubles: ['Canapé', 'Table basse', 'Table à manger', 'Chaises', 'Meuble TV', 'Télévision',
                           'Étagères / bibliothèque', 'Luminaires', 'Rideaux / voilages'] },
    cuisine:   { nom: 'Cuisine', elements: [...ELEMENTS_BASE, 'Ventilation (VMC)'],
                 equipements: ['Évier & robinetterie', 'Plan de travail', 'Meubles hauts & bas', 'Plaques de cuisson',
                               'Four', 'Hotte', 'Réfrigérateur / congélateur', 'Lave-vaisselle', 'Micro-ondes'],
                 meubles: ['Table', 'Chaises', 'Vaisselle & ustensiles'] },
    chambre:   { nom: 'Chambre', elements: [...ELEMENTS_BASE, 'Placard / penderie'], equipements: [],
                 meubles: ['Lit & sommier', 'Matelas', 'Table(s) de chevet', 'Armoire / commode', 'Bureau',
                           'Chaise', 'Lampe(s)', 'Rideaux / voilages'] },
    sdb:       { nom: 'Salle de bain', elements: [...ELEMENTS_BASE, 'Ventilation (VMC)'],
                 equipements: ['Baignoire / douche', 'Paroi / rideau de douche', 'Lavabo & meuble', 'Robinetterie',
                               'Miroir', 'Chauffe-eau', 'Sèche-serviettes', 'Lave-linge'], meubles: [] },
    wc:        { nom: 'WC', elements: [...ELEMENTS_BASE, 'Ventilation (VMC)'],
                 equipements: ['Cuvette & abattant', 'Chasse d\'eau', 'Lave-mains'], meubles: [] },
    bureau:    { nom: 'Bureau', elements: ELEMENTS_BASE, equipements: [],
                 meubles: ['Bureau', 'Chaise', 'Étagères', 'Lampe'] },
    couloir:   { nom: 'Couloir / dégagement', elements: [...ELEMENTS_BASE, 'Placard'], equipements: [], meubles: [] },
    cave:      { nom: 'Cave / cellier', elements: ['Sol', 'Murs', 'Plafond', 'Porte', 'Éclairage'], equipements: [], meubles: [] },
    exterieur: { nom: 'Balcon / extérieur', elements: ['Sol', 'Garde-corps / rambarde', 'Murs / façade', 'Éclairage', 'Store / volet'],
                 equipements: [], meubles: ['Mobilier de jardin'] },
    parking:   { nom: 'Parking / garage', elements: ['Sol', 'Porte / accès', 'Éclairage', 'Marquage / numéro'], equipements: [], meubles: [] },
    vide:      { nom: 'Pièce', elements: [], equipements: [], meubles: [] }
  };

  const PIECES_DEFAUT = ['entree', 'sejour', 'cuisine', 'chambre', 'sdb', 'wc'];

  function makeLine(nom, cat) {
    return { id: U.uid(), nom: nom || '', cat: cat === 'meuble' ? 'meuble' : 'element',
             etat: '', fonctionne: 'na', remarques: '', photos: [] };
  }

  function makeRoom(typeKey, nom, meuble) {
    const t = TYPES_PIECE[typeKey] || TYPES_PIECE.standard;
    const lignes = [
      ...t.elements.map(n => makeLine(n, 'element')),
      ...t.equipements.map(n => makeLine(n, 'meuble')),
      ...(meuble ? t.meubles.map(n => makeLine(n, 'meuble')) : [])
    ];
    return { id: U.uid(), nom: nom || t.nom, type: typeKey, remarques: '', lignes };
  }

  function makeMeter(type, labels) {
    return { id: U.uid(), type, numero: '', index: (labels || ['Index']).map(l => ({ label: l, value: '' })),
             remarques: '', photos: [] };
  }

  function defaultMeters() {
    return [
      makeMeter('Électricité', ['Index HP (kWh)', 'Index HC (kWh)']),
      makeMeter('Gaz', ['Index (m³)']),
      makeMeter('Eau froide', ['Index (m³)']),
      makeMeter('Eau chaude', ['Index (m³)'])
    ];
  }

  function makeKey(type, nombre) {
    return { id: U.uid(), type: type || '', nombre: nombre || '' };
  }

  function defaultKeys() {
    return [makeKey("Clé porte d'entrée"), makeKey('Clé boîte aux lettres'), makeKey('Badge / bip immeuble')];
  }

  function makeDossier(opts) {
    opts = opts || {};
    const meuble = !!opts.meuble;
    const now = new Date().toISOString();
    return {
      id: U.uid(), version: 1, createdAt: now, updatedAt: now,
      type: opts.type === 'sortie' ? 'sortie' : 'entree',
      adresse: opts.adresse || '', complement: '', date: opts.date || U.todayISO(),
      bailleur: '', locataire: '', meuble, remarques: '',
      compteurs: defaultMeters(), cles: defaultKeys(),
      pieces: PIECES_DEFAUT.map(k => makeRoom(k, null, meuble)),
      server: { rev: 0, savedAt: null, dirty: true, edits: 0 }
    };
  }

  /* Complète un dossier importé / ancien pour éviter les champs manquants. */
  function normalize(d) {
    d.version = d.version || 1;
    d.id = d.id || U.uid();
    d.type = d.type === 'sortie' ? 'sortie' : 'entree';
    ['adresse', 'complement', 'date', 'bailleur', 'locataire', 'remarques'].forEach(k => { if (typeof d[k] !== 'string') d[k] = d[k] == null ? '' : String(d[k]); });
    d.meuble = !!d.meuble;
    d.createdAt = d.createdAt || new Date().toISOString();
    d.updatedAt = d.updatedAt || d.createdAt;
    if (!Array.isArray(d.compteurs)) d.compteurs = [];
    d.compteurs.forEach(m => { m.id = m.id || U.uid(); m.type = m.type || ''; m.numero = m.numero || '';
      if (!Array.isArray(m.index)) m.index = []; m.index.forEach(ix => { ix.label = ix.label || ''; ix.value = ix.value == null ? '' : String(ix.value); });
      m.remarques = m.remarques || ''; if (!Array.isArray(m.photos)) m.photos = []; });
    if (!Array.isArray(d.cles)) d.cles = [];
    d.cles.forEach(k => { k.id = k.id || U.uid(); k.type = k.type || ''; k.nombre = k.nombre == null ? '' : String(k.nombre); });
    if (!Array.isArray(d.pieces)) d.pieces = [];
    d.pieces.forEach(p => { p.id = p.id || U.uid(); p.nom = p.nom || 'Pièce'; p.remarques = p.remarques || '';
      if (!Array.isArray(p.lignes)) p.lignes = [];
      p.lignes.forEach(l => { l.id = l.id || U.uid(); l.nom = l.nom || ''; l.cat = l.cat === 'meuble' ? 'meuble' : 'element';
        l.etat = ETATS.includes(l.etat) ? l.etat : ''; l.fonctionne = ['oui', 'non', 'na'].includes(l.fonctionne) ? l.fonctionne : 'na';
        l.remarques = l.remarques || ''; if (!Array.isArray(l.photos)) l.photos = []; }); });
    delete d.signatures; // fonction retirée (v1.2)
    delete d.github;
    if (!d.server || typeof d.server !== 'object') d.server = { rev: 0, savedAt: null, dirty: true, edits: 0 };
    (d.pieces || []).forEach(p => p.lignes.forEach(l => l.photos.forEach(fixPhoto)));
    (d.compteurs || []).forEach(m => m.photos.forEach(fixPhoto));
    return d;
  }

  /* Photo : { id, name, w, h, addedAt, source?, up (déjà sur le PC), dataUrl? (en attente d'envoi), thumb? (cache local) } */
  function fixPhoto(p) {
    if (!p.id) p.id = U.uid();
    if (p.up == null) p.up = !p.dataUrl;
    delete p.remote; delete p.file;
  }

  function countPhotos(d) {
    let n = 0;
    (d.pieces || []).forEach(p => (p.lignes || []).forEach(l => { n += (l.photos || []).length; }));
    (d.compteurs || []).forEach(m => { n += (m.photos || []).length; });
    return n;
  }

  function summary(d) {
    return {
      id: d.id, adresse: d.adresse || '', complement: d.complement || '', type: d.type, date: d.date || '',
      updatedAt: d.updatedAt, nbPieces: (d.pieces || []).length, nbPhotos: countPhotos(d),
      rev: (d.server && d.server.rev) || 0, savedAt: (d.server && d.server.savedAt) || null, dirty: !!(d.server && d.server.dirty)
    };
  }

  window.EDL_TEMPLATES = {
    ETATS, ETAT_CLASS, FONCTIONNE, FONCTIONNE_LABEL, TYPES_PIECE, PIECES_DEFAUT,
    makeLine, makeRoom, makeMeter, makeKey, makeDossier, normalize, countPhotos, summary
  };
})();
