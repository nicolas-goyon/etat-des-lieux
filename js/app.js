/* Application « État des lieux » – interface et logique. */
(function () {
  'use strict';

  const APP_VERSION = '1.2.0';
  const T = window.EDL_TEMPLATES;
  const CFG = window.EDL_CONFIG || {};
  const $ = sel => document.querySelector(sel);
  const root = () => document.getElementById('app');

  const App = {
    authed: false,
    dossiers: [],
    dossier: null,
    tab: 'general',
    photoTarget: null,
    saveState: ''
  };

  // =====================================================================
  //  Authentification (code d'accès, empreinte SHA-256)
  // =====================================================================
  function expectedHash() {
    return (U.local.get('edl.codeHash') || CFG.ACCESS_CODE_HASH || '').toLowerCase();
  }
  function checkAuth() {
    if (!expectedHash()) return true; // aucun code configuré
    return U.session.get('edl.auth') === '1' || U.local.get('edl.auth') === expectedHash();
  }
  function logout() {
    U.session.remove('edl.auth');
    U.local.remove('edl.auth');
    App.authed = false;
    App.dossier = null;
    Modal.closeAll();
    render();
  }

  // =====================================================================
  //  Modales génériques
  // =====================================================================
  const Modal = {
    open(html, opts) {
      opts = opts || {};
      const r = $('#modal-root');
      const el = document.createElement('div');
      el.className = 'modal-backdrop' + (opts.full ? ' full' : '');
      el.innerHTML = `<div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
      r.appendChild(el);
      el.addEventListener('click', e => { if (e.target === el && !opts.sticky) Modal.close(el); });
      document.body.classList.add('modal-open');
      return el;
    },
    close(el) {
      const r = $('#modal-root');
      if (!el) el = r.lastElementChild;
      if (el && el.parentNode === r) el.remove();
      if (!r.children.length) document.body.classList.remove('modal-open');
    },
    closeAll() { $('#modal-root').innerHTML = ''; document.body.classList.remove('modal-open'); },
    alert(msg, title) {
      return new Promise(res => {
        const el = Modal.open(`<h3>${U.esc(title || 'Information')}</h3><p class="pre">${U.esc(msg)}</p>
          <div class="modal-actions"><button class="btn primary" data-m="ok">OK</button></div>`, { sticky: true });
        el.addEventListener('click', e => { if (e.target.closest('[data-m="ok"]')) { Modal.close(el); res(); } });
      });
    },
    confirm(msg, o) {
      o = o || {};
      return new Promise(res => {
        const el = Modal.open(`<h3>${U.esc(o.title || 'Confirmation')}</h3><p class="pre">${U.esc(msg)}</p>
          <div class="modal-actions"><button class="btn" data-m="cancel">${U.esc(o.cancel || 'Annuler')}</button>
          <button class="btn ${o.danger ? 'danger' : 'primary'}" data-m="ok">${U.esc(o.ok || 'Confirmer')}</button></div>`, { sticky: true });
        el.addEventListener('click', e => {
          const b = e.target.closest('[data-m]'); if (!b) return;
          Modal.close(el); res(b.dataset.m === 'ok');
        });
      });
    },
    prompt(title, value, o) {
      o = o || {};
      return new Promise(res => {
        const el = Modal.open(`<h3>${U.esc(title)}</h3><form>
          <input class="input" name="v" value="${U.esc(value || '')}" placeholder="${U.esc(o.placeholder || '')}" autocomplete="off">
          <div class="modal-actions"><button type="button" class="btn" data-m="cancel">Annuler</button>
          <button type="submit" class="btn primary">${U.esc(o.ok || 'OK')}</button></div></form>`, { sticky: true });
        const f = el.querySelector('form');
        f.addEventListener('submit', e => { e.preventDefault(); const v = f.elements.v.value; Modal.close(el); res(v); });
        el.addEventListener('click', e => { if (e.target.closest('[data-m="cancel"]')) { Modal.close(el); res(null); } });
        setTimeout(() => { f.elements.v.focus(); f.elements.v.select(); }, 60);
      });
    },
    progress(title) {
      const el = Modal.open(`<h3>${U.esc(title)}</h3><div class="spinner"></div><p class="progress-text muted">Veuillez patienter…</p>`, { sticky: true, cls: 'progress-modal' });
      return {
        update(t) { const p = el.querySelector('.progress-text'); if (p) p.textContent = t; },
        close() { Modal.close(el); }
      };
    }
  };

  // =====================================================================
  //  Vues
  // =====================================================================
  function appTitle() { return CFG.APP_TITLE || 'État des lieux'; }

  const ICON_DISPLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="14" height="11" rx="1.5"/><rect x="17" y="8" width="5" height="11" rx="1.2"/><path d="M6 19h6M9 15v4"/></svg>';
  function displayBtn(extra) {
    return `<button class="icon-btn ${extra || ''}" data-action="display" title="Affichage" aria-label="Choisir l'affichage">${ICON_DISPLAY}</button>`;
  }

  // ----- Téléphone appareil photo -----
  const Host = () => window.Remote && window.Remote.Host;
  const REMOTE_STATE_TXT = { off: 'Non connecté', starting: 'Préparation…', ready: 'En attente du téléphone', connected: 'Téléphone connecté', error: 'Erreur' };
  function remoteBtn() {
    const st = Host() ? Host().state : 'off';
    return `<button class="remote-btn st-${st}" data-action="remote" title="Utiliser un téléphone comme appareil photo" aria-label="Téléphone appareil photo">
      <span class="rb-ico" aria-hidden="true">📱</span><span class="rb-txt">${st === 'connected' ? 'Téléphone connecté' : 'Téléphone'}</span><i class="rb-dot" aria-hidden="true"></i></button>`;
  }
  function updateRemoteBtn() {
    document.querySelectorAll('.remote-btn').forEach(b => {
      const tmp = document.createElement('div'); tmp.innerHTML = remoteBtn();
      b.replaceWith(tmp.firstElementChild);
    });
  }

  /* Progression d'une pièce : lignes ayant un état / total. */
  function roomProgress(p) {
    const total = p.lignes.length;
    const done = p.lignes.filter(l => l.etat).length;
    return { done, total, full: total > 0 && done === total };
  }
  function tabBadge(k) {
    if (!k.startsWith('piece:') || !App.dossier) return '';
    const p = App.dossier.pieces.find(x => x.id === k.slice(6));
    if (!p) return '';
    const r = roomProgress(p);
    return `<span class="tab-badge ${r.full ? 'full' : ''}">${r.done}/${r.total}</span>`;
  }
  function updateTabBadges() {
    document.querySelectorAll('#tabs .tab[data-tab]').forEach(t => {
      const old = t.querySelector('.tab-badge');
      const html = tabBadge(t.dataset.tab);
      if (!html) return;
      const tmp = document.createElement('span'); tmp.innerHTML = html;
      if (old) old.replaceWith(tmp.firstChild); else t.appendChild(tmp.firstChild);
    });
  }

  function loginView() {
    return `
<div class="screen login">
  <div class="login-display">${displayBtn('on-light')}</div>
  <div class="card login-card">
    <div class="brand"><span class="brand-icon" aria-hidden="true">🏠</span>
      <h1>${U.esc(appTitle())}</h1>
      <p class="muted">Entrez le code d'accès pour continuer.</p></div>
    <form data-form="login" autocomplete="off">
      <label class="field"><span>Code d'accès</span>
        <input class="input" type="password" name="code" autocomplete="current-password" required autofocus></label>
      <label class="check"><input type="checkbox" name="remember"> Rester connecté sur cet appareil</label>
      <p class="error" hidden>Code incorrect.</p>
      <button class="btn primary block" type="submit">Entrer</button>
    </form>
  </div>
</div>`;
  }

  function syncBadge(d) {
    if (d.lastSync && !d.dirty) return `<span class="badge ok">GitHub ✓</span>`;
    if (d.lastSync && d.dirty) return `<span class="badge warn">modifié</span>`;
    return `<span class="badge">local</span>`;
  }

  function homeView() {
    const list = App.dossiers;
    return `
<header class="topbar">
  <div class="title"><strong>${U.esc(appTitle())}</strong><small>${list.length} dossier${list.length > 1 ? 's' : ''}</small></div>
  ${displayBtn()}
  <button class="icon-btn" data-action="settings" title="Paramètres" aria-label="Paramètres">⚙</button>
</header>
<main class="content">
  <div class="actions-row"><button class="btn primary block" data-action="new-dossier">+ Nouvel état des lieux</button></div>
  <div class="actions-row two">
    <button class="btn" data-action="import-json">Importer un JSON</button>
    <button class="btn" data-action="load-github">Charger depuis GitHub</button>
  </div>
  ${list.length ? `<ul class="dossier-list">${list.map(d => `
    <li class="dossier-item" data-action="open-dossier" data-id="${U.esc(d.id)}">
      <div class="di-main"><strong>${U.esc(d.adresse || 'Sans adresse')}${d.complement ? ' – ' + U.esc(d.complement) : ''}</strong>
        <small>${d.type === 'sortie' ? 'Sortie' : 'Entrée'} · ${U.fmtDate(d.date)} · ${d.nbPieces} pièce${d.nbPieces > 1 ? 's' : ''} · ${d.nbPhotos} photo${d.nbPhotos > 1 ? 's' : ''}</small>
        <small class="muted">Modifié le ${U.fmtDateTime(d.updatedAt)}</small></div>
      <div class="di-side">${syncBadge(d)}<span class="chev">›</span></div>
    </li>`).join('')}</ul>`
    : `<p class="empty">Aucun dossier pour l'instant.<br>Créez votre premier état des lieux.</p>`}
</main>`;
  }

  function dossierView() {
    const d = App.dossier;
    const tabs = [['general', 'Général'], ['compteurs', 'Compteurs'], ...d.pieces.map(p => ['piece:' + p.id, p.nom || 'Pièce'])];
    return `
<header class="topbar">
  <button class="icon-btn" data-action="home" title="Retour à la liste" aria-label="Retour">‹</button>
  <div class="title"><strong>${U.esc(d.adresse || 'Nouvel état des lieux')}</strong>
    <small>${d.type === 'sortie' ? 'État des lieux de sortie' : "État des lieux d'entrée"} · ${U.fmtDate(d.date)}</small></div>
  ${remoteBtn()}
  ${displayBtn()}
  <button class="icon-btn" data-action="menu" title="Menu" aria-label="Menu">⋮</button>
</header>
<nav class="tabs" id="tabs" aria-label="Sections et pièces">
  ${tabs.map(([k, l]) => `<button class="tab ${App.tab === k ? 'on' : ''}" data-tab="${U.esc(k)}"><span class="tab-label">${U.esc(l)}</span>${tabBadge(k)}</button>`).join('')}
  <button class="tab add" data-action="add-room">+ Pièce</button>
</nav>
<main class="content" id="tab-content">${tabContent()}</main>
<footer class="bottombar">
  <span class="save-state" id="save-state">${U.esc(App.saveState)}</span>
  <div class="bb-actions">
    <button class="btn small" data-action="export-pdf">📄 PDF</button>
    <button class="btn small primary" data-action="github-save">☁ GitHub</button>
  </div>
</footer>`;
  }

  function currentRoom() {
    if (!App.dossier || !App.tab.startsWith('piece:')) return null;
    return App.dossier.pieces.find(p => p.id === App.tab.slice(6)) || null;
  }

  function tabContent() {
    if (App.tab === 'compteurs') return metersTab();
    if (App.tab.startsWith('piece:')) {
      const r = currentRoom();
      if (r) return roomTab(r);
      App.tab = 'general';
    }
    return generalTab();
  }

  function generalTab() {
    const d = App.dossier;
    return `
<div class="general-grid">
<section class="card form" data-scope="dossier">
  <h3>Informations</h3>
  <label class="field"><span>Type</span>
    <select class="input" data-field="type">
      <option value="entree" ${d.type !== 'sortie' ? 'selected' : ''}>État des lieux d'entrée</option>
      <option value="sortie" ${d.type === 'sortie' ? 'selected' : ''}>État des lieux de sortie</option>
    </select></label>
  <label class="field"><span>Adresse du logement</span><input class="input" data-field="adresse" value="${U.esc(d.adresse)}" placeholder="12 rue des Lilas, 75000 Paris"></label>
  <label class="field"><span>Complément (étage, porte, lot…)</span><input class="input" data-field="complement" value="${U.esc(d.complement)}"></label>
  <label class="field"><span>Date</span><input class="input" type="date" data-field="date" value="${U.esc(d.date)}"></label>
  <label class="field"><span>Bailleur / mandataire</span><input class="input" data-field="bailleur" value="${U.esc(d.bailleur)}"></label>
  <label class="field"><span>Locataire(s)</span><input class="input" data-field="locataire" value="${U.esc(d.locataire)}"></label>
  <label class="check"><input type="checkbox" data-field="meuble" ${d.meuble ? 'checked' : ''}> Logement meublé</label>
  <label class="field"><span>Remarques générales</span><textarea class="input" rows="3" data-field="remarques" placeholder="Observations générales, documents remis, etc.">${U.esc(d.remarques)}</textarea></label>
</section>
<section class="card">
  <h3>Clés remises</h3>
  <div class="keys">${d.cles.map(k => `
    <div class="key-row" data-key="${U.esc(k.id)}">
      <input class="input" data-field="type" value="${U.esc(k.type)}" placeholder="Type de clé">
      <input class="input nb" data-field="nombre" inputmode="numeric" value="${U.esc(k.nombre)}" placeholder="Nb">
      <button class="icon-btn danger" data-action="key-delete" title="Supprimer">✕</button>
    </div>`).join('')}</div>
  <button class="btn small" data-action="key-add">+ Ajouter une clé</button>
</section>
</div>`;
  }

  function photosHtml(photos) {
    return `<div class="photos">${(photos || []).map((p, i) => `
      <button type="button" class="thumb" data-action="view-photo" data-index="${i}" title="Voir la photo">
        ${p.thumb || p.dataUrl ? `<img src="${p.thumb || p.dataUrl}" alt="photo ${i + 1}" loading="lazy">` : '<span class="muted small">non chargée</span>'}</button>`).join('')}
      <button type="button" class="thumb add" data-action="add-photos"><span class="cam" aria-hidden="true">📷</span><span>Photos</span></button>
    </div>`;
  }

  function metersTab() {
    const d = App.dossier;
    return `
<div class="section-head"><h2>Compteurs</h2></div>
<div class="lines">${d.compteurs.map(m => `
<article class="card line" data-meter="${U.esc(m.id)}">
  <div class="line-head">
    <input class="input line-name" data-field="type" value="${U.esc(m.type)}" placeholder="Type de compteur">
    <div class="line-tools">
      <button class="icon-btn" data-action="meter-up" title="Monter">↑</button>
      <button class="icon-btn" data-action="meter-down" title="Descendre">↓</button>
      <button class="icon-btn danger" data-action="meter-delete" title="Supprimer">✕</button>
    </div>
  </div>
  <label class="field"><span>N° de compteur / PDL / PCE</span><input class="input" data-field="numero" value="${U.esc(m.numero)}"></label>
  <div class="indexes">${m.index.map((ix, i) => `
    <div class="idx-row">
      <input class="input" data-field="index.${i}.label" value="${U.esc(ix.label)}" placeholder="Libellé (ex. Index HP)">
      <input class="input nb" data-field="index.${i}.value" inputmode="decimal" value="${U.esc(ix.value)}" placeholder="Relevé">
      <button class="icon-btn danger" data-action="meter-index-delete" data-index="${i}" title="Supprimer l'index">✕</button>
    </div>`).join('')}
    <button class="btn small" data-action="meter-index-add">+ Ajouter un index</button>
  </div>
  <textarea class="input" rows="2" data-field="remarques" placeholder="Remarques (emplacement, plombage, état…)">${U.esc(m.remarques)}</textarea>
  ${photosHtml(m.photos)}
</article>`).join('')}</div>
<button class="btn block" data-action="meter-add">+ Ajouter un compteur</button>`;
  }

  function lineHtml(l) {
    return `
<article class="card line" data-line="${U.esc(l.id)}">
  <div class="line-head">
    <input class="input line-name" data-field="nom" value="${U.esc(l.nom)}" placeholder="Nom de l'élément">
    <div class="line-tools">
      <button class="icon-btn" data-action="line-up" title="Monter">↑</button>
      <button class="icon-btn" data-action="line-down" title="Descendre">↓</button>
      <button class="icon-btn danger" data-action="line-delete" title="Supprimer">✕</button>
    </div>
  </div>
  <div class="row row-etat"><span class="lbl">État</span>
    <div class="seg etat">${T.ETATS.map(e => `<button type="button" class="${T.ETAT_CLASS[e]} ${l.etat === e ? 'on' : ''}" data-action="set-etat" data-value="${U.esc(e)}">${U.esc(e)}</button>`).join('')}</div>
  </div>
  <div class="row row-fonct"><span class="lbl">Fonctionne</span>
    <div class="seg fonct">${T.FONCTIONNE.map(([v, lab]) => `<button type="button" class="f-${v} ${l.fonctionne === v ? 'on' : ''}" data-action="set-fonctionne" data-value="${v}">${lab}</button>`).join('')}</div>
  </div>
  <textarea class="input" rows="2" data-field="remarques" placeholder="Remarques, défauts constatés, nombre…">${U.esc(l.remarques)}</textarea>
  ${photosHtml(l.photos)}
</article>`;
  }

  function roomTab(room) {
    const els = room.lignes.filter(l => l.cat !== 'meuble');
    const meubles = room.lignes.filter(l => l.cat === 'meuble');
    return `
<div class="section-head">
  <h2>${U.esc(room.nom)}</h2>
  <div class="room-actions">
    <button class="btn small" data-action="room-rename">✎ Renommer</button>
    <button class="btn small" data-action="room-left" title="Déplacer vers la gauche">←</button>
    <button class="btn small" data-action="room-right" title="Déplacer vers la droite">→</button>
    <button class="btn small" data-action="room-dup">Dupliquer</button>
    <button class="btn small" data-action="room-all-good" title="Mettre « Bon état » sur toutes les lignes sans état">Tout « Bon état »</button>
    <button class="btn small danger" data-action="room-delete">Supprimer</button>
  </div>
</div>
<section>
  <h3 class="sub">Éléments de la pièce <small>sol, plafond, murs, menuiseries…</small></h3>
  <div class="lines">${els.map(lineHtml).join('')}</div>
  <button class="btn block" data-action="line-add" data-cat="element">+ Ajouter un élément</button>
</section>
<section>
  <h3 class="sub">Meubles & équipements <small>état et fonctionnement</small></h3>
  <div class="lines">${meubles.map(lineHtml).join('')}</div>
  <button class="btn block" data-action="line-add" data-cat="meuble">+ Ajouter un meuble / équipement</button>
</section>
<section class="card" data-scope="room">
  <h3>Remarques sur la pièce</h3>
  <textarea class="input" rows="3" data-field="remarques" placeholder="Observations générales sur la pièce">${U.esc(room.remarques)}</textarea>
</section>`;
  }

  // =====================================================================
  //  Rendu
  // =====================================================================
  function render() {
    const r = root();
    if (!App.authed) r.innerHTML = loginView();
    else if (!App.dossier) r.innerHTML = homeView();
    else r.innerHTML = dossierView();
    afterRender();
  }

  function renderTabOnly() {
    const c = $('#tab-content');
    if (!c) { render(); return; }
    c.innerHTML = tabContent();
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === App.tab));
    updateTabBadges();
    afterRender();
  }

  function afterRender() {
    const active = document.querySelector('#tabs .tab.on');
    if (active && active.parentElement) {
      const nav = active.parentElement;
      try {
        if (nav.scrollWidth > nav.clientWidth + 2) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
        else if (nav.scrollHeight > nav.clientHeight + 2) {
          const top = active.offsetTop, bottom = top + active.offsetHeight;
          if (top < nav.scrollTop || bottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = top - nav.clientHeight / 2;
        }
      } catch (e) { /* ignore */ }
    }
    const auto = document.querySelector('[autofocus]');
    if (auto && !('ontouchstart' in window)) setTimeout(() => auto.focus(), 30);
  }

  function updateHeader() {
    const d = App.dossier; if (!d) return;
    const t = document.querySelector('.topbar .title');
    if (!t) return;
    t.querySelector('strong').textContent = d.adresse || 'Nouvel état des lieux';
    t.querySelector('small').textContent = `${d.type === 'sortie' ? 'État des lieux de sortie' : "État des lieux d'entrée"} · ${U.fmtDate(d.date)}`;
  }

  function setSaveState(txt) {
    App.saveState = txt;
    const el = $('#save-state');
    if (el) el.textContent = txt;
  }

  // =====================================================================
  //  Persistance locale
  // =====================================================================
  async function save() {
    const d = App.dossier;
    if (!d) return;
    d.updatedAt = new Date().toISOString();
    d.github = d.github || {};
    d.github.dirty = true;
    try {
      await Store.put(d);
      setSaveState(`Enregistré sur l'appareil · ${U.timeNow()}${d.github.lastSync ? ' · non envoyé sur GitHub' : ''}`);
    } catch (e) {
      console.error(e);
      setSaveState("Erreur d'enregistrement local");
      U.toast("Impossible d'enregistrer localement : " + e.message, 5000);
    }
  }
  const scheduleSave = U.debounce(save, 500);

  async function refreshList() {
    try { App.dossiers = await Store.list(); }
    catch (e) { console.error(e); App.dossiers = []; U.toast('Stockage local indisponible : ' + e.message, 5000); }
  }

  async function openDossier(id) {
    const d = await Store.get(id);
    if (!d) { U.toast('Dossier introuvable'); return; }
    App.dossier = d;
    if (Host() && Host().isConnected()) setTimeout(() => Host().sendWelcome(), 0);
    App.tab = 'general';
    App.saveState = d.github && d.github.lastSync && !d.github.dirty
      ? `Synchronisé GitHub · ${U.fmtDateTime(d.github.lastSync)}` : "Enregistré sur l'appareil";
    window.scrollTo(0, 0);
    render();
  }

  async function goHome() {
    if (App.dossier) await save();
    App.dossier = null;
    await refreshList();
    render();
  }

  // =====================================================================
  //  Résolution du contexte (quel objet modifie un champ / un bouton)
  // =====================================================================
  function resolveTarget(el) {
    const d = App.dossier; if (!d) return null;
    const lineEl = el.closest('[data-line]');
    if (lineEl) { const r = currentRoom(); return r ? r.lignes.find(l => l.id === lineEl.dataset.line) : null; }
    const meterEl = el.closest('[data-meter]');
    if (meterEl) return d.compteurs.find(m => m.id === meterEl.dataset.meter) || null;
    const keyEl = el.closest('[data-key]');
    if (keyEl) return d.cles.find(k => k.id === keyEl.dataset.key) || null;
    const scope = el.closest('[data-scope]');
    if (scope && scope.dataset.scope === 'room') return currentRoom();
    return d;
  }

  function onFieldInput(e) {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f || !App.dossier) return;
    const target = resolveTarget(el);
    if (!target) return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    U.setPath(target, f, val);
    if (target === App.dossier && (f === 'adresse' || f === 'type' || f === 'date')) updateHeader();
    if (el.classList.contains('line-name') && el.closest('[data-line]') === null) { /* compteur : rien de plus */ }
    scheduleSave();
  }

  // =====================================================================
  //  Actions
  // =====================================================================
  async function onClick(e) {
    const btn = e.target.closest('[data-action],[data-tab]');
    if (!btn || !root().contains(btn)) return;
    if (btn.dataset.tab) { App.tab = btn.dataset.tab; window.scrollTo(0, 0); renderTabOnly(); return; }
    const a = btn.dataset.action;
    const d = App.dossier;
    const room = currentRoom();

    switch (a) {
      // ----- accueil -----
      case 'settings': openSettings(); break;
      case 'display': openDisplay(); break;
      case 'remote': openRemoteModal(); break;
      case 'new-dossier': newDossierDialog(); break;
      case 'import-json': $('#json-input').click(); break;
      case 'load-github': loadFromGithubDialog(); break;
      case 'open-dossier': openDossier(btn.dataset.id); break;

      // ----- dossier -----
      case 'home': goHome(); break;
      case 'menu': openMenu(); break;
      case 'export-pdf': exportPdf(); break;
      case 'github-save': githubSave(); break;
      case 'add-room': addRoomDialog(); break;

      // ----- pièce -----
      case 'room-rename': {
        if (!room) break;
        const v = await Modal.prompt('Nom de la pièce', room.nom, { ok: 'Renommer' });
        if (v != null && v.trim()) { room.nom = v.trim(); await save(); render(); }
        break;
      }
      case 'room-left': case 'room-right': {
        if (!room) break;
        const i = d.pieces.indexOf(room), j = a === 'room-left' ? i - 1 : i + 1;
        if (j < 0 || j >= d.pieces.length) break;
        [d.pieces[i], d.pieces[j]] = [d.pieces[j], d.pieces[i]];
        await save(); render();
        break;
      }
      case 'room-dup': {
        if (!room) break;
        const copy = U.clone(room);
        copy.id = U.uid(); copy.nom = room.nom + ' (copie)';
        copy.lignes.forEach(l => { l.id = U.uid(); l.photos.forEach(p => { p.id = U.uid(); delete p.remote; }); });
        d.pieces.splice(d.pieces.indexOf(room) + 1, 0, copy);
        App.tab = 'piece:' + copy.id;
        await save(); render();
        break;
      }
      case 'room-all-good': {
        if (!room) break;
        let n = 0;
        room.lignes.forEach(l => { if (!l.etat) { l.etat = 'Bon état'; n++; } });
        await save(); renderTabOnly();
        U.toast(n ? `${n} ligne${n > 1 ? 's' : ''} passée${n > 1 ? 's' : ''} en « Bon état »` : 'Toutes les lignes ont déjà un état');
        break;
      }
      case 'room-delete': {
        if (!room) break;
        if (!(await Modal.confirm(`Supprimer la pièce « ${room.nom} » et toutes ses lignes/photos ?`, { ok: 'Supprimer', danger: true }))) break;
        d.pieces.splice(d.pieces.indexOf(room), 1);
        App.tab = 'general';
        await save(); render();
        break;
      }

      // ----- lignes -----
      case 'line-add': {
        if (!room) break;
        const l = T.makeLine('', btn.dataset.cat);
        room.lignes.push(l);
        await save(); renderTabOnly();
        const inp = document.querySelector(`[data-line="${l.id}"] .line-name`);
        if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        break;
      }
      case 'line-up': case 'line-down': {
        const l = resolveTarget(btn); if (!l || !room) break;
        const arr = room.lignes, i = arr.indexOf(l);
        const dir = a === 'line-up' ? -1 : 1;
        let j = i + dir;
        while (j >= 0 && j < arr.length && arr[j].cat !== l.cat) j += dir;
        if (j < 0 || j >= arr.length) break;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        await save(); renderTabOnly();
        break;
      }
      case 'line-delete': {
        const l = resolveTarget(btn); if (!l || !room) break;
        if ((l.photos.length || l.remarques) && !(await Modal.confirm(`Supprimer la ligne « ${l.nom || 'sans nom'} » (${l.photos.length} photo${l.photos.length > 1 ? 's' : ''}) ?`, { ok: 'Supprimer', danger: true }))) break;
        room.lignes.splice(room.lignes.indexOf(l), 1);
        await save(); renderTabOnly();
        break;
      }
      case 'set-etat': {
        const l = resolveTarget(btn); if (!l) break;
        const v = btn.dataset.value;
        l.etat = l.etat === v ? '' : v;
        btn.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === l.etat));
        updateTabBadges();
        scheduleSave();
        break;
      }
      case 'set-fonctionne': {
        const l = resolveTarget(btn); if (!l) break;
        l.fonctionne = btn.dataset.value;
        btn.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === l.fonctionne));
        scheduleSave();
        break;
      }

      // ----- photos -----
      case 'add-photos': {
        const holder = resolveTarget(btn);
        if (!holder || !Array.isArray(holder.photos)) break;
        if (Host() && Host().isConnected()) { requestFromPhone(holder, photoLabel(btn, holder)); break; }
        App.photoTarget = holder;
        $('#photo-input').click();
        break;
      }
      case 'view-photo': {
        const holder = resolveTarget(btn);
        if (!holder || !holder.photos) break;
        openPhotoViewer(holder, Number(btn.dataset.index) || 0);
        break;
      }

      // ----- compteurs -----
      case 'meter-add': {
        d.compteurs.push(T.makeMeter('Autre compteur', ['Index']));
        await save(); renderTabOnly();
        const last = document.querySelector(`[data-meter="${d.compteurs[d.compteurs.length - 1].id}"] .line-name`);
        if (last) { last.focus(); last.select(); last.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        break;
      }
      case 'meter-up': case 'meter-down': {
        const m = resolveTarget(btn); if (!m) break;
        const i = d.compteurs.indexOf(m), j = a === 'meter-up' ? i - 1 : i + 1;
        if (j < 0 || j >= d.compteurs.length) break;
        [d.compteurs[i], d.compteurs[j]] = [d.compteurs[j], d.compteurs[i]];
        await save(); renderTabOnly();
        break;
      }
      case 'meter-delete': {
        const m = resolveTarget(btn); if (!m) break;
        if (!(await Modal.confirm(`Supprimer le compteur « ${m.type || 'sans nom'} » ?`, { ok: 'Supprimer', danger: true }))) break;
        d.compteurs.splice(d.compteurs.indexOf(m), 1);
        await save(); renderTabOnly();
        break;
      }
      case 'meter-index-add': {
        const m = resolveTarget(btn); if (!m) break;
        m.index.push({ label: 'Index', value: '' });
        await save(); renderTabOnly();
        break;
      }
      case 'meter-index-delete': {
        const m = resolveTarget(btn); if (!m) break;
        m.index.splice(Number(btn.dataset.index), 1);
        await save(); renderTabOnly();
        break;
      }

      // ----- clés -----
      case 'key-add': {
        d.cles.push(T.makeKey('', ''));
        await save(); renderTabOnly();
        const rows = document.querySelectorAll('.key-row');
        const last = rows[rows.length - 1]; if (last) last.querySelector('input').focus();
        break;
      }
      case 'key-delete': {
        const k = resolveTarget(btn); if (!k) break;
        d.cles.splice(d.cles.indexOf(k), 1);
        await save(); renderTabOnly();
        break;
      }
      default: break;
    }
  }

  // =====================================================================
  //  Photos
  // =====================================================================
  async function onPhotosChosen(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const holder = App.photoTarget;
    App.photoTarget = null;
    if (!files.length || !holder) return;
    const prog = Modal.progress('Ajout des photos');
    let n = 0, ok = 0;
    for (const f of files) {
      n++;
      prog.update(`Photo ${n} / ${files.length}…`);
      try {
        const full = await U.resizeImage(f, 1600, 0.82);
        const th = await U.resizeImage(full.dataUrl, 320, 0.7);
        holder.photos.push({ id: U.uid(), name: f.name || '', dataUrl: full.dataUrl, thumb: th.dataUrl, w: full.w, h: full.h, addedAt: new Date().toISOString() });
        ok++;
      } catch (err) {
        console.error(err);
        U.toast(`Photo ignorée : ${f.name || ''}`, 4000);
      }
    }
    prog.close();
    await save();
    renderTabOnly();
    if (ok) U.toast(`${ok} photo${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}`);
  }

  function openPhotoViewer(holder, index) {
    const el = Modal.open(`
<div class="pv">
  <div class="pv-top"><span class="pv-count"></span><button class="icon-btn light" data-pv="close" aria-label="Fermer">✕</button></div>
  <div class="pv-body"><img class="pv-img" alt=""></div>
  <div class="pv-bottom">
    <button class="btn light" data-pv="prev" aria-label="Précédente">‹</button>
    <button class="btn danger" data-pv="del">Supprimer</button>
    <button class="btn light" data-pv="next" aria-label="Suivante">›</button>
  </div>
</div>`, { full: true, cls: 'photo-viewer', sticky: true });
    const draw = () => {
      const p = holder.photos[index];
      if (!p) { Modal.close(el); return; }
      el.querySelector('.pv-img').src = p.dataUrl || p.thumb || '';
      el.querySelector('.pv-count').textContent = `${index + 1} / ${holder.photos.length}${p.name ? ' · ' + p.name : ''}`;
    };
    // balayage gauche / droite (tactile) et flèches du clavier
    const body = el.querySelector('.pv-body');
    let sx = null, sy = null;
    body.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
    body.addEventListener('pointerup', e => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && holder.photos.length > 1) {
        index = dx < 0 ? (index + 1) % holder.photos.length : (index - 1 + holder.photos.length) % holder.photos.length;
        draw();
      }
    });
    body.addEventListener('pointercancel', () => { sx = null; });
    const onKey = e => {
      if (!document.body.contains(el)) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'ArrowRight') { index = (index + 1) % holder.photos.length; draw(); }
      else if (e.key === 'ArrowLeft') { index = (index - 1 + holder.photos.length) % holder.photos.length; draw(); }
      else if (e.key === 'Escape') { Modal.close(el); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-pv]'); if (!b) return;
      const k = b.dataset.pv;
      if (k === 'close') Modal.close(el);
      else if (k === 'prev') { index = (index - 1 + holder.photos.length) % holder.photos.length; draw(); }
      else if (k === 'next') { index = (index + 1) % holder.photos.length; draw(); }
      else if (k === 'del') {
        if (!(await Modal.confirm('Supprimer cette photo ?', { ok: 'Supprimer', danger: true }))) return;
        holder.photos.splice(index, 1);
        await save();
        renderTabOnly();
        if (!holder.photos.length) Modal.close(el);
        else { index = Math.min(index, holder.photos.length - 1); draw(); }
      }
    });
    draw();
  }


  // =====================================================================
  //  Téléphone utilisé comme appareil photo
  // =====================================================================
  function photoLabel(btn, holder) {
    if (btn.closest('[data-meter]')) return `Compteur › ${holder.type || 'compteur'}`;
    const r = currentRoom();
    return `${r ? r.nom : 'Pièce'} › ${holder.nom || 'élément'}`;
  }

  function isLocalAddress() {
    return location.protocol === 'file:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  }

  function openRemoteModal() {
    const H = Host();
    if (!H) { Modal.alert('Module téléphone indisponible.'); return; }
    H.start();
    const el = Modal.open('<div class="remote-body"></div>', { cls: 'remote-modal' });
    const body = el.querySelector('.remote-body');
    let closing = false;
    const draw = () => {
      const st = H.state;
      let html = `<h3>📱 Téléphone comme appareil photo</h3>`;
      if (st === 'starting' || st === 'off') {
        html += `<div class="spinner"></div><p class="center muted">Préparation de la connexion…</p>`;
      } else if (st === 'error') {
        html += `<p class="hint err">${U.esc(H.error || 'Erreur de connexion')}</p>
          <div class="modal-actions"><button class="btn" data-r="close">Fermer</button><button class="btn primary" data-r="retry">Réessayer</button></div>`;
      } else if (st === 'connected') {
        html += `<div class="remote-ok"><div class="rp-big">✅</div><p><strong>Téléphone connecté.</strong></p>
          <p class="muted">Touchez <strong>📷 Photos</strong> sur une ligne : la demande s'affiche sur le téléphone, et les photos arrivent ici automatiquement.</p></div>
          <div class="modal-actions between"><button class="btn danger" data-r="stop">Déconnecter le téléphone</button><button class="btn primary" data-r="close">OK</button></div>`;
      } else {
        const link = H.link();
        let qr = '';
        try { const q = qrcode(0, 'M'); q.addData(link); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
        catch (e) { qr = '<p class="hint err">QR code impossible à générer.</p>'; }
        html += `<div class="remote-qr-wrap">
            <div class="remote-qr" aria-label="QR code à scanner avec le téléphone">${qr}</div>
            <ol class="remote-steps">
              <li>Ouvrez l'appareil photo du téléphone et visez ce QR code.</li>
              <li>Touchez le lien proposé : une page « Appareil photo » s'ouvre sur le téléphone.</li>
              <li>Ensuite, chaque <strong>📷 Photos</strong> touché ici déclenche la prise de vue sur le téléphone.</li>
            </ol>
          </div>
          ${isLocalAddress() ? `<p class="hint err">Cette page est ouverte depuis une adresse locale (${U.esc(location.host || 'fichier')}) que le téléphone ne pourra pas ouvrir. Utilisez l'adresse GitHub Pages de l'application.</p>` : ''}
          <p class="muted small">Le téléphone et cet appareil doivent avoir accès à Internet. Les photos passent directement d'un appareil à l'autre (connexion chiffrée), sans être stockées sur un serveur. Pas besoin du code d'accès sur le téléphone : le QR code contient une clé à usage unique pour cette session.</p>
          <div class="remote-link"><input class="input" readonly value="${U.esc(link)}" aria-label="Lien de connexion"><button class="btn small" data-r="copy">Copier</button></div>
          <div class="modal-actions between"><button class="btn" data-r="stop">Arrêter</button><span class="remote-wait"><span class="dot-pulse"></span> En attente du téléphone…</span><button class="btn" data-r="close">Fermer</button></div>`;
      }
      body.innerHTML = html;
    };
    draw();
    const off = H.onChange(st => {
      if (!document.body.contains(el)) { off(); return; }
      draw();
      if (st === 'connected' && !closing) {
        closing = true;
        U.toast('📱 Téléphone connecté');
        setTimeout(() => { if (document.body.contains(el)) { Modal.close(el); off(); } }, 1600);
      }
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const a = b.dataset.r;
      if (a === 'close') { Modal.close(el); off(); }
      else if (a === 'retry') { H.destroyPeer(); H.start(); }
      else if (a === 'stop') { H.stop(); Modal.close(el); off(); U.toast('Téléphone déconnecté'); }
      else if (a === 'copy') {
        const inp = body.querySelector('.remote-link input');
        try { await navigator.clipboard.writeText(inp.value); U.toast('Lien copié'); }
        catch (err) { inp.select(); try { document.execCommand('copy'); U.toast('Lien copié'); } catch (e2) { /* ignore */ } }
      }
    });
  }

  /* Demande une ou plusieurs photos au téléphone pour une ligne / un compteur. */
  function requestFromPhone(holder, label) {
    const H = Host();
    const req = H.request(holder, label);
    const pend = H.pending.get(req);
    pend.dossierId = App.dossier && App.dossier.id;
    const el = Modal.open(`<div class="wait-phone">
  <div class="wp-ico" aria-hidden="true">📱</div>
  <h3>Prenez la photo avec le téléphone</h3>
  <p class="wp-label">${U.esc(label)}</p>
  <p class="wp-count muted"><span class="dot-pulse"></span> En attente des photos…</p>
  <div class="photos wp-thumbs"></div>
  <div class="modal-actions between">
    <button class="btn" data-w="local">Utiliser cet appareil</button>
    <button class="btn primary" data-w="done">Terminer</button>
  </div></div>`, { sticky: true, cls: 'wait-modal' });
    const count = el.querySelector('.wp-count');
    const thumbs = el.querySelector('.wp-thumbs');
    let n = 0;
    const close = () => { Modal.close(el); App.remoteWait = null; offState(); };
    App.remoteWait = {
      req,
      added(photo) {
        n++;
        count.textContent = `${n} photo${n > 1 ? 's' : ''} reçue${n > 1 ? 's' : ''} – vous pouvez en prendre d'autres.`;
        const d = document.createElement('div'); d.className = 'thumb';
        d.innerHTML = `<img src="${photo.thumb || photo.dataUrl}" alt="">`;
        thumbs.appendChild(d);
      },
      done() { close(); if (n) U.toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} depuis le téléphone`); }
    };
    const offState = H.onChange(st => {
      if (!document.body.contains(el)) { offState(); return; }
      if (st !== 'connected') count.innerHTML = '<span class="hint err">Téléphone déconnecté. Il se reconnecte automatiquement s\'il reste sur la page « Appareil photo » ; sinon, utilisez cet appareil.</span>';
      else count.textContent = n ? `${n} photo(s) reçue(s).` : 'Téléphone reconnecté – en attente des photos…';
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-w]'); if (!b) return;
      H.cancel(req);
      if (b.dataset.w === 'local') {
        close();
        App.photoTarget = holder;
        $('#photo-input').click();
      } else {
        close();
        if (n) U.toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`);
      }
    });
  }

  /* Réception d'une photo envoyée par le téléphone. */
  async function onPhonePhoto(pend, msg) {
    if (!App.dossier || pend.dossierId !== App.dossier.id) throw new Error('dossier fermé');
    if (typeof msg.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(msg.dataUrl)) throw new Error('format invalide');
    let w = msg.w, h = msg.h, thumb = null;
    try { const th = await U.resizeImage(msg.dataUrl, 320, 0.7); thumb = th.dataUrl; } catch (e) { /* vignette facultative */ }
    if (!w || !h) { try { const im = await U.loadImage(msg.dataUrl); w = im.naturalWidth; h = im.naturalHeight; } catch (e) { /* ignore */ } }
    const photo = { id: U.uid(), name: String(msg.name || '').slice(0, 120), dataUrl: msg.dataUrl, thumb: thumb || msg.dataUrl, w, h, addedAt: new Date().toISOString(), source: 'telephone' };
    pend.holder.photos.push(photo);
    pend.count = (pend.count || 0) + 1;
    await save();
    renderTabOnly();
    if (App.remoteWait && App.remoteWait.req === msg.req) App.remoteWait.added(photo);
    else U.toast('📱 Photo reçue : ' + pend.label);
    return pend.count;
  }

  function setupRemoteHost() {
    const H = Host();
    if (!H) return;
    H.handlers.photo = onPhonePhoto;
    H.handlers.done = (pend, req) => { if (App.remoteWait && App.remoteWait.req === req) App.remoteWait.done(); };
    H.onChange(st => {
      updateRemoteBtn();
      if (st === 'ready' && App.remoteWasConnected) { App.remoteWasConnected = false; U.toast('📱 Téléphone déconnecté', 3500); }
      if (st === 'connected') App.remoteWasConnected = true;
    });
  }

  // =====================================================================
  //  Choix de l'affichage
  // =====================================================================
  const MODE_ICONS = {
    auto: '<svg viewBox="0 0 48 36"><rect x="3" y="5" width="26" height="20" rx="2"/><rect x="33" y="9" width="12" height="22" rx="2"/><path d="M12 31h8"/></svg>',
    phone: '<svg viewBox="0 0 48 36"><rect x="17" y="2" width="14" height="32" rx="3"/><path d="M22 30h4"/></svg>',
    'tablet-portrait': '<svg viewBox="0 0 48 36"><rect x="12" y="1" width="24" height="34" rx="3"/><path d="M16 7h16M16 12h16M16 17h16"/></svg>',
    'tablet-landscape': '<svg viewBox="0 0 48 36"><rect x="2" y="5" width="44" height="27" rx="3"/><path d="M14 5v27M18 11h11M32 11h10M18 17h11M32 17h10"/></svg>',
    desktop: '<svg viewBox="0 0 48 36"><rect x="3" y="2" width="42" height="26" rx="2"/><path d="M15 2v26M18 33h12M24 28v5"/></svg>'
  };

  function openDisplay() {
    const draw = () => {
      const mode = Display.getMode(), text = Display.getText();
      const detected = Display.detect();
      return `<h3>Affichage</h3>
<p class="muted small">Choix mémorisé sur cet appareil. En automatique, la mise en page suit la taille de l'écran et l'orientation (détecté actuellement : <strong>${U.esc(Display.label(detected))}</strong>).</p>
<div class="mode-grid" role="radiogroup" aria-label="Mode d'affichage">
  ${Display.MODES.map(m => `<button type="button" class="mode-card ${mode === m.id ? 'on' : ''}" role="radio" aria-checked="${mode === m.id}" data-mode="${m.id}">
    <span class="mode-ico">${MODE_ICONS[m.id] || ''}</span>
    <span class="mode-txt"><strong>${U.esc(m.label)}</strong><small>${U.esc(m.desc)}</small></span></button>`).join('')}
</div>
<h4 class="mt">Taille du texte</h4>
<div class="seg text-size" role="radiogroup" aria-label="Taille du texte">
  ${Display.TEXTS.map(t => `<button type="button" class="${text === t.id ? 'on' : ''}" data-text="${t.id}" aria-checked="${text === t.id}" role="radio">${U.esc(t.label)}</button>`).join('')}
</div>
<div class="modal-actions"><button class="btn primary" data-m="close">Fermer</button></div>`;
    };
    const el = Modal.open(draw(), { cls: 'display-modal' });
    const modal = el.querySelector('.modal');
    el.addEventListener('click', e => {
      const m = e.target.closest('[data-mode]');
      const t = e.target.closest('[data-text]');
      if (m) { Display.setMode(m.dataset.mode); modal.innerHTML = draw(); return; }
      if (t) { Display.setText(t.dataset.text); modal.innerHTML = draw(); return; }
      if (e.target.closest('[data-m="close"]')) Modal.close(el);
    });
  }

  // =====================================================================
  //  Dialogues : nouveau dossier, nouvelle pièce, menu, paramètres
  // =====================================================================
  function newDossierDialog() {
    const el = Modal.open(`<h3>Nouvel état des lieux</h3>
<form>
  <label class="field"><span>Type</span><select class="input" name="type">
    <option value="entree">État des lieux d'entrée</option><option value="sortie">État des lieux de sortie</option></select></label>
  <label class="field"><span>Adresse du logement</span><input class="input" name="adresse" placeholder="12 rue des Lilas, 75000 Paris" required></label>
  <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${U.todayISO()}"></label>
  <label class="check"><input type="checkbox" name="meuble"> Logement meublé (pré-remplit les meubles types)</label>
  <p class="muted small">Pièces créées par défaut : Entrée, Séjour, Cuisine, Chambre, Salle de bain, WC. Vous pourrez les renommer, en ajouter ou en supprimer.</p>
  <div class="modal-actions"><button type="button" class="btn" data-m="cancel">Annuler</button><button type="submit" class="btn primary">Créer</button></div>
</form>`, { sticky: true });
    const f = el.querySelector('form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const d = T.makeDossier({ type: f.elements.type.value, adresse: f.elements.adresse.value.trim(), date: f.elements.date.value, meuble: f.elements.meuble.checked });
      Modal.close(el);
      await Store.put(d);
      await openDossier(d.id);
    });
    el.addEventListener('click', e => { if (e.target.closest('[data-m="cancel"]')) Modal.close(el); });
    setTimeout(() => f.elements.adresse.focus(), 60);
  }

  function addRoomDialog() {
    const d = App.dossier;
    const types = Object.entries(T.TYPES_PIECE);
    const el = Modal.open(`<h3>Ajouter une pièce</h3>
<form>
  <label class="field"><span>Type de pièce (modèle de lignes)</span><select class="input" name="type">
    ${types.map(([k, t]) => `<option value="${k}">${U.esc(t.nom)}${k === 'vide' ? ' – vide, sans lignes' : ''}${k === 'standard' ? ' – lignes de base' : ''}</option>`).join('')}
  </select></label>
  <label class="field"><span>Nom de la pièce</span><input class="input" name="nom" value="${U.esc(T.TYPES_PIECE.standard.nom)}" data-auto="1"></label>
  <label class="check"><input type="checkbox" name="meuble" ${d.meuble ? 'checked' : ''}> Pré-remplir les meubles types</label>
  <div class="modal-actions"><button type="button" class="btn" data-m="cancel">Annuler</button><button type="submit" class="btn primary">Ajouter</button></div>
</form>`, { sticky: true });
    const f = el.querySelector('form');
    f.elements.type.addEventListener('change', () => {
      if (f.elements.nom.dataset.auto || !f.elements.nom.value.trim()) {
        const base = T.TYPES_PIECE[f.elements.type.value].nom;
        const n = d.pieces.filter(p => p.nom === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+$').test(p.nom)).length;
        f.elements.nom.value = n ? `${base} ${n + 1}` : base;
        f.elements.nom.dataset.auto = '1';
      }
    });
    f.elements.nom.addEventListener('input', () => { delete f.elements.nom.dataset.auto; });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const room = T.makeRoom(f.elements.type.value, f.elements.nom.value.trim() || null, f.elements.meuble.checked);
      d.pieces.push(room);
      App.tab = 'piece:' + room.id;
      Modal.close(el);
      await save(); render();
    });
    el.addEventListener('click', e => { if (e.target.closest('[data-m="cancel"]')) Modal.close(el); });
    setTimeout(() => { f.elements.nom.focus(); f.elements.nom.select(); }, 60);
  }

  function openMenu() {
    const el = Modal.open(`<div class="sheet">
  <button class="sheet-item" data-m="pdf">📄 Exporter en PDF</button>
  <button class="sheet-item" data-m="gh">☁ Enregistrer sur GitHub</button>
  <button class="sheet-item" data-m="json">💾 Exporter en JSON (sauvegarde complète)</button>
  <button class="sheet-item" data-m="dup">📑 Dupliquer ce dossier</button>
  <button class="sheet-item" data-m="remote">📱 Téléphone comme appareil photo</button>
  <button class="sheet-item" data-m="display">🖥 Affichage (téléphone, tablette, PC)</button>
  <button class="sheet-item" data-m="settings">⚙ Paramètres</button>
  <button class="sheet-item danger" data-m="del">🗑 Supprimer ce dossier</button>
  <button class="sheet-item" data-m="cancel">Fermer</button>
</div>`, { cls: 'sheet-modal' });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      Modal.close(el);
      const fn = { pdf: exportPdf, gh: githubSave, json: exportJson, dup: duplicateDossier, display: openDisplay, remote: openRemoteModal, settings: openSettings, del: deleteDossier }[b.dataset.m];
      if (fn) fn();
    });
  }

  async function exportJson() {
    const d = App.dossier;
    await save();
    const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' });
    U.download(`EDL-${d.type === 'sortie' ? 'sortie' : 'entree'}-${U.slug(d.adresse)}-${d.date || ''}.json`, blob);
    U.toast('Fichier JSON généré');
  }

  async function duplicateDossier() {
    const d = App.dossier;
    await save();
    const copy = U.clone(d);
    copy.id = U.uid();
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    copy.github = { lastSync: null, dirty: true };
    copy.pieces.forEach(p => { p.id = U.uid(); p.lignes.forEach(l => { l.id = U.uid(); l.photos.forEach(ph => { ph.id = U.uid(); delete ph.remote; }); }); });
    copy.compteurs.forEach(m => { m.id = U.uid(); m.photos.forEach(ph => { ph.id = U.uid(); delete ph.remote; }); });
    copy.cles.forEach(k => { k.id = U.uid(); });
    const keepPhotos = await Modal.confirm('Conserver les photos dans la copie ?', { ok: 'Oui, garder les photos', cancel: 'Non, sans photos' });
    if (!keepPhotos) { copy.pieces.forEach(p => p.lignes.forEach(l => { l.photos = []; })); copy.compteurs.forEach(m => { m.photos = []; }); }
    await Store.put(copy);
    await openDossier(copy.id);
    U.toast('Dossier dupliqué');
  }

  async function deleteDossier() {
    const d = App.dossier;
    if (!(await Modal.confirm(`Supprimer définitivement ce dossier de cet appareil ?\n${d.adresse || ''}\n(La copie éventuellement enregistrée sur GitHub n'est pas supprimée.)`, { ok: 'Supprimer', danger: true }))) return;
    await Store.remove(d.id);
    App.dossier = null;
    await refreshList();
    render();
    U.toast('Dossier supprimé');
  }

  async function exportPdf() {
    const d = App.dossier;
    await save();
    const prog = Modal.progress('Génération du PDF');
    try {
      const copy = U.clone(d);
      const holders = [];
      copy.pieces.forEach(p => p.lignes.forEach(l => holders.push(l)));
      copy.compteurs.forEach(m => holders.push(m));
      const total = holders.reduce((s, h) => s + h.photos.length, 0);
      let n = 0;
      for (const h of holders) {
        for (const ph of h.photos) {
          n++;
          prog.update(`Préparation des photos ${n} / ${total}…`);
          if (!ph.dataUrl) continue;
          try { const r = await U.resizeImage(ph.dataUrl, 1000, 0.72); ph.dataUrl = r.dataUrl; ph.w = r.w; ph.h = r.h; }
          catch (e) { /* on garde l'originale */ }
        }
      }
      prog.update('Mise en page…');
      await U.sleep(30);
      const jsPDF = window.jspdf && window.jspdf.jsPDF;
      if (!jsPDF) throw new Error('Bibliothèque PDF non chargée');
      const doc = EdlPdf.build(copy, jsPDF);
      U.download(EdlPdf.fileName(d), doc.output('blob'));
      U.toast('PDF généré');
    } catch (e) {
      console.error(e);
      Modal.alert('Erreur lors de la génération du PDF : ' + e.message);
    } finally {
      prog.close();
    }
  }

  async function githubSave() {
    if (!GitHub.isConfigured()) {
      if (await Modal.confirm("GitHub n'est pas encore configuré (dépôt + jeton). Ouvrir les paramètres ?", { ok: 'Paramètres' })) openSettings();
      return;
    }
    await save();
    const d = App.dossier;
    const prog = Modal.progress('Enregistrement sur GitHub');
    try {
      await GitHub.saveDossier(d, t => prog.update(t));
      d.github.lastSync = new Date().toISOString();
      d.github.dirty = false;
      await Store.put(d);
      setSaveState(`Synchronisé GitHub · ${U.fmtDateTime(d.github.lastSync)}`);
      U.toast('Enregistré sur GitHub ✓');
    } catch (e) {
      console.error(e);
      Modal.alert("Échec de l'enregistrement sur GitHub :\n" + e.message, 'Erreur');
    } finally {
      prog.close();
    }
  }

  async function loadFromGithubDialog() {
    const prog = Modal.progress('Lecture du dépôt GitHub');
    let idx;
    try { idx = await GitHub.loadIndex(); }
    catch (e) {
      prog.close();
      Modal.alert("Impossible de lire l'index des dossiers :\n" + e.message + (GitHub.isConfigured() ? '' : "\n\nConfigurez le dépôt et le jeton dans Paramètres, ou ouvrez l'application depuis son adresse GitHub Pages."), 'Erreur');
      return;
    }
    prog.close();
    const list = idx.dossiers || [];
    const el = Modal.open(`<h3>Dossiers enregistrés sur GitHub</h3>
${list.length ? `<ul class="dossier-list compact">${list.map(d => `
  <li class="dossier-item" data-m="load" data-id="${U.esc(d.id)}">
    <div class="di-main"><strong>${U.esc(d.adresse || 'Sans adresse')}</strong>
      <small>${d.type === 'sortie' ? 'Sortie' : 'Entrée'} · ${U.fmtDate(d.date)} · ${d.nbPhotos || 0} photo${(d.nbPhotos || 0) > 1 ? 's' : ''} · maj ${U.fmtDateTime(d.updatedAt)}</small></div>
    <span class="chev">⤓</span></li>`).join('')}</ul>` : '<p class="empty">Aucun dossier trouvé dans le dépôt.</p>'}
<div class="modal-actions"><button class="btn" data-m="close">Fermer</button></div>`);
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'close') { Modal.close(el); return; }
      const id = b.dataset.id;
      if (App.dossiers.some(x => x.id === id) &&
          !(await Modal.confirm('Ce dossier existe déjà sur cet appareil. Remplacer la version locale par celle de GitHub ?', { ok: 'Remplacer', danger: true }))) return;
      Modal.close(el);
      const p = Modal.progress('Téléchargement du dossier');
      try {
        const d = await GitHub.loadDossier(id, t => p.update(t));
        d.github = { lastSync: new Date().toISOString(), dirty: false };
        await Store.put(d);
        await refreshList();
        render();
        U.toast('Dossier chargé depuis GitHub');
      } catch (err) {
        console.error(err);
        Modal.alert('Échec du chargement :\n' + err.message, 'Erreur');
      } finally { p.close(); }
    });
  }

  async function onJsonChosen(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await U.readFileAsText(f));
      if (!d || typeof d !== 'object' || !Array.isArray(d.pieces)) throw new Error('fichier non reconnu');
      T.normalize(d);
      if (App.dossiers.some(x => x.id === d.id) &&
          !(await Modal.confirm('Un dossier avec le même identifiant existe déjà. Le remplacer ?', { ok: 'Remplacer', cancel: 'Importer comme copie', danger: true }))) {
        d.id = U.uid();
      }
      const needsHydrate = [...d.pieces.flatMap(p => p.lignes), ...d.compteurs].some(h => h.photos.some(ph => !ph.dataUrl && ph.file));
      if (needsHydrate) {
        const p = Modal.progress('Téléchargement des photos');
        try { await GitHub.hydrate(d, t => p.update(t)); } finally { p.close(); }
      }
      d.github = { lastSync: null, dirty: true };
      await Store.put(d);
      await refreshList();
      render();
      U.toast('Dossier importé');
    } catch (err) {
      console.error(err);
      Modal.alert('Import impossible : ' + err.message, 'Erreur');
    }
  }

  function configJsText(hash) {
    return `// ============================================================
//  Configuration de l'application « État des lieux »
//  Ce fichier est lu au chargement de la page. Il peut être
//  modifié à la main ou depuis Paramètres > Code d'accès.
// ============================================================
window.EDL_CONFIG = {
  // Titre affiché dans l'application et dans l'onglet du navigateur.
  APP_TITLE: ${JSON.stringify(CFG.APP_TITLE || 'État des lieux')},

  // Empreinte SHA-256 (hexadécimale) du code d'accès.
  // Pour obtenir l'empreinte d'un nouveau code : Paramètres > Code d'accès
  // (l'application affiche la ligne à coller ici), ou dans un terminal :
  //   printf '%s' 'moncode' | sha256sum
  ACCESS_CODE_HASH: ${JSON.stringify(hash)},

  // Dossier du dépôt GitHub dans lequel les états des lieux sont enregistrés.
  DATA_DIR: ${JSON.stringify(CFG.DATA_DIR || 'data')},

  // Serveur de mise en relation pour « téléphone comme appareil photo ».
  // null = serveur public gratuit PeerJS. Exemple : { host: "mon-serveur.fr", port: 443, path: "/", secure: true }
  PEER_SERVER: ${JSON.stringify(CFG.PEER_SERVER || null)}
};
`;
  }

  function openSettings() {
    const c = GitHub.getConfig();
    const auto = GitHub.detectRepo();
    const el = Modal.open(`<h3>Paramètres</h3>
<form data-f="gh">
  <h4>Synchronisation GitHub</h4>
  <p class="muted small">Les dossiers (JSON + photos) sont enregistrés dans le dépôt, dossier <code>${U.esc(GitHub.dataDir())}/</code>, en un commit par enregistrement. Le jeton n'est stocké que dans ce navigateur.</p>
  <label class="field"><span>Propriétaire (owner)</span><input class="input" name="owner" value="${U.esc(c.owner || auto.owner || '')}" autocapitalize="off" autocomplete="off" placeholder="mon-compte"></label>
  <label class="field"><span>Dépôt (repo)</span><input class="input" name="repo" value="${U.esc(c.repo || auto.repo || '')}" autocapitalize="off" autocomplete="off" placeholder="etat-des-lieux"></label>
  <label class="field"><span>Branche</span><input class="input" name="branch" value="${U.esc(c.branch || 'main')}" autocapitalize="off" autocomplete="off"></label>
  <label class="field"><span>Jeton d'accès (fine-grained PAT, permission « Contents » en lecture/écriture)</span><input class="input" type="password" name="token" value="${U.esc(c.token || '')}" autocomplete="off" placeholder="github_pat_…"></label>
  <div class="modal-actions"><button type="button" class="btn" data-m="test">Tester</button><button type="submit" class="btn primary">Enregistrer</button></div>
  <p class="hint" data-m="ghmsg"></p>
</form>
<hr>
<form data-f="code">
  <h4>Code d'accès</h4>
  <p class="muted small">Le nouveau code s'applique immédiatement sur cet appareil. Pour les autres appareils, mettez à jour <code>config.js</code> dans le dépôt (bouton ci-dessous si GitHub est configuré, sinon copiez la ligne affichée).</p>
  <label class="field"><span>Nouveau code</span><input class="input" type="password" name="code" autocomplete="new-password" required></label>
  <label class="field"><span>Confirmer le code</span><input class="input" type="password" name="code2" autocomplete="new-password" required></label>
  <div class="modal-actions"><button type="submit" class="btn primary">Changer le code</button></div>
  <div class="hint" data-m="codemsg"></div>
</form>
<hr>
<h4>Affichage</h4>
<p class="muted small">Mode actuel : <strong>${U.esc(Display.getMode() === 'auto' ? 'Automatique (' + Display.label(Display.resolved()) + ')' : Display.label(Display.getMode()))}</strong></p>
<button class="btn" data-m="display">Changer l'affichage…</button>
<hr>
<div class="modal-actions between">
  <button class="btn" data-m="logout">Se déconnecter</button>
  <button class="btn" data-m="close">Fermer</button>
</div>
<p class="muted small center">${U.esc(appTitle())} · version ${APP_VERSION}</p>`, { cls: 'settings-modal' });

    const ghForm = el.querySelector('[data-f="gh"]');
    const ghMsg = el.querySelector('[data-m="ghmsg"]');
    const readGh = () => ({ owner: ghForm.elements.owner.value.trim(), repo: ghForm.elements.repo.value.trim(), branch: ghForm.elements.branch.value.trim() || 'main', token: ghForm.elements.token.value.trim() });
    ghForm.addEventListener('submit', e => {
      e.preventDefault();
      GitHub.setConfig(readGh());
      ghMsg.textContent = 'Paramètres GitHub enregistrés sur cet appareil.';
      ghMsg.className = 'hint ok';
    });
    el.querySelector('[data-m="test"]').addEventListener('click', async () => {
      GitHub.setConfig(readGh());
      ghMsg.textContent = 'Test en cours…'; ghMsg.className = 'hint';
      try {
        const r = await GitHub.test();
        ghMsg.textContent = `Connexion OK : ${r.full_name} (${r.private ? 'dépôt privé' : 'dépôt public'}), branche « ${readGh().branch} » trouvée.`;
        ghMsg.className = 'hint ok';
      } catch (err) {
        ghMsg.textContent = 'Échec : ' + err.message; ghMsg.className = 'hint err';
      }
    });

    const codeForm = el.querySelector('[data-f="code"]');
    const codeMsg = el.querySelector('[data-m="codemsg"]');
    codeForm.addEventListener('submit', async e => {
      e.preventDefault();
      const c1 = codeForm.elements.code.value, c2 = codeForm.elements.code2.value;
      if (c1.length < 4) { codeMsg.textContent = 'Le code doit contenir au moins 4 caractères.'; codeMsg.className = 'hint err'; return; }
      if (c1 !== c2) { codeMsg.textContent = 'Les deux codes ne correspondent pas.'; codeMsg.className = 'hint err'; return; }
      const hash = await sha256Hex(c1.trim());
      U.local.set('edl.codeHash', hash);
      if (U.local.get('edl.auth')) U.local.set('edl.auth', hash);
      codeForm.elements.code.value = ''; codeForm.elements.code2.value = '';
      codeMsg.className = 'hint ok';
      codeMsg.innerHTML = `Code modifié sur cet appareil. Ligne à placer dans <code>config.js</code> :<br>
        <code class="block">ACCESS_CODE_HASH: "${hash}",</code>
        ${GitHub.isConfigured() ? '<button type="button" class="btn small primary" data-m="pushcfg">Mettre à jour config.js sur GitHub</button>' : ''}`;
      const push = codeMsg.querySelector('[data-m="pushcfg"]');
      if (push) push.addEventListener('click', async () => {
        push.disabled = true; push.textContent = 'Envoi…';
        try {
          await GitHub.putTextFile('config.js', configJsText(hash), "Mise à jour du code d'accès");
          CFG.ACCESS_CODE_HASH = hash;
          push.textContent = 'config.js mis à jour ✓ (le site se republie en 1 à 2 minutes)';
        } catch (err) { push.disabled = false; push.textContent = 'Échec : ' + err.message; }
      });
    });

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-m="logout"],[data-m="close"],[data-m="display"]'); if (!b) return;
      if (b.dataset.m === 'logout') logout();
      else if (b.dataset.m === 'display') { Modal.close(el); openDisplay(); }
      else Modal.close(el);
    });
  }

  // =====================================================================
  //  Connexion
  // =====================================================================
  async function onSubmit(e) {
    const f = e.target;
    if (!f.dataset || f.dataset.form !== 'login') return;
    e.preventDefault();
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const h = await sha256Hex(f.elements.code.value.trim());
      if (h === expectedHash()) {
        U.session.set('edl.auth', '1');
        if (f.elements.remember.checked) U.local.set('edl.auth', h);
        App.authed = true;
        await refreshList();
        render();
      } else {
        f.querySelector('.error').hidden = false;
        f.elements.code.value = '';
        f.elements.code.focus();
      }
    } finally { btn.disabled = false; }
  }

  // =====================================================================
  //  Démarrage
  // =====================================================================
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker non enregistré :', err));
  }

  async function init() {
    document.title = appTitle();
    const r = root();
    // Page dédiée du téléphone (ouverte via le QR code) : pas de code d'accès,
    // elle ne donne accès à aucune donnée et sert uniquement à envoyer des photos.
    if (window.Remote && Remote.parsePhoneLink()) { Remote.runPhone(r); registerSW(); return; }
    setupRemoteHost();
    r.addEventListener('click', onClick);
    r.addEventListener('input', onFieldInput);
    r.addEventListener('change', onFieldInput);
    r.addEventListener('submit', onSubmit);
    r.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('line-name')) { e.preventDefault(); e.target.blur(); }
    });
    window.addEventListener('edl:layout', () => afterRender());
    $('#photo-input').addEventListener('change', onPhotosChosen);
    $('#json-input').addEventListener('change', onJsonChosen);
    App.authed = checkAuth();
    if (App.authed) await refreshList();
    render();
    registerSW();
  }

  window.EDL = { App, Modal, render, save, version: APP_VERSION };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
