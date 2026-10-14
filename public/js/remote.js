/* Téléphone utilisé comme appareil photo pour le PC / la tablette.
   Tout passe par le serveur local (le PC), sur le réseau Wi-Fi : aucun service Internet.
   - Le PC / la tablette (« hôte ») ouvre un jumelage et affiche un QR code.
   - Le téléphone ouvre la page « Appareil photo » (#remote=<jeton>), reçoit les
     demandes en direct (Server-Sent Events) et envoie les photos au serveur, qui les
     range directement dans le dossier et prévient l'hôte. */
(function () {
  'use strict';

  const SS_KEY = 'edl.remote.token';
  let unloading = false;
  window.addEventListener('pagehide', () => { unloading = true; });
  window.addEventListener('beforeunload', () => { unloading = true; });
  window.addEventListener('pageshow', () => { unloading = false; });

  function randomId(n) {
    const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, x => abc[x % abc.length]).join('');
  }

  // ===================================================================
  //  CÔTÉ PC / TABLETTE
  // ===================================================================
  const Host = {
    state: 'off', error: '', token: null, es: null, phones: 0, publicUrl: null,
    listeners: new Set(), handlers: { photo: null, done: null },
    pending: new Map(), // req → { label, dossierId, target, count }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    set(state, error) { this.state = state; this.error = error || ''; this.listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); },
    isConnected() { return this.state === 'connected'; },
    /* Reprend automatiquement un jumelage en cours après un rechargement de la page. */
    resume() { let t = null; try { t = sessionStorage.getItem(SS_KEY); } catch (e) { /* ignore */ } if (t) this.start(); },

    link(base) { return `${String(base || '').replace(/\/+$/, '')}/#remote=${this.token}`; },

    async start(title) {
      if (this.token && this.es && this.es.readyState !== 2) return;
      this.set('starting');
      let saved = null;
      try { saved = sessionStorage.getItem(SS_KEY); } catch (e) { /* ignore */ }
      try {
        const r = await API.post('/api/remote/start', { token: this.token || saved || undefined, title: title || '' });
        if (r.token !== (this.token || saved)) { try { sessionStorage.removeItem(SS_KEY + '.last'); } catch (e) { /* ignore */ } }
        this.token = r.token;
        this.publicUrl = r.publicUrl || null;
        try { sessionStorage.setItem(SS_KEY, r.token); } catch (e) { /* ignore */ }
        this.openEvents();
        this.set(r.phones > 0 ? 'connected' : 'ready');
      } catch (e) {
        this.set('error', e.message);
      }
    },

    openEvents() {
      if (this.es) { try { this.es.close(); } catch (e) { /* ignore */ } }
      let last = 0;
      try { last = Number(sessionStorage.getItem(SS_KEY + '.last') || 0); } catch (e) { /* ignore */ }
      // « last » : rejoue les événements (photos) arrivés pendant un rechargement de la page
      const es = new EventSource(`/api/remote/host-events?token=${encodeURIComponent(this.token)}&last=${last}`);
      this.es = es;
      const data = ev => {
        if (ev.lastEventId) { try { sessionStorage.setItem(SS_KEY + '.last', ev.lastEventId); } catch (e) { /* ignore */ } }
        try { return JSON.parse(ev.data); } catch (e) { return {}; }
      };
      es.addEventListener('phone', ev => {
        this.phones = data(ev).phones || 0;
        this.set(this.phones > 0 ? 'connected' : 'ready');
      });
      es.addEventListener('photo', ev => { if (this.handlers.photo) this.handlers.photo(data(ev)); });
      es.addEventListener('done', ev => { const d = data(ev); if (this.handlers.done) this.handlers.done(d.req); });
      es.onerror = () => {
        if (es !== this.es || unloading) return;
        if (es.readyState === 2) {
          // flux fermé par le serveur (redémarrage…) : on tente de reprendre le même jumelage
          this.es = null;
          if (this.state === 'connected') this.set('ready');
          setTimeout(() => this.reconnect(), 2000);
        } else if (this.state === 'connected') {
          this.set('ready');
        }
      };
    },

    async reconnect() {
      if (!this.token || unloading) return;
      const old = this.token;
      try {
        const r = await API.post('/api/remote/start', { token: old });
        this.token = r.token;
        try { sessionStorage.setItem(SS_KEY, r.token); } catch (e) { /* ignore */ }
        if (r.token !== old) {
          try { sessionStorage.removeItem(SS_KEY + '.last'); } catch (e) { /* ignore */ }
          this.openEvents();
          this.set('error', 'Le serveur a redémarré : faites rescanner le QR code par le téléphone.');
        } else {
          this.openEvents();
          this.set(r.phones > 0 ? 'connected' : 'ready');
        }
      } catch (e) {
        setTimeout(() => this.reconnect(), 5000);
      }
    },

    async request(label, dossierId, target, title) {
      const req = randomId(12);
      this.pending.set(req, { label, dossierId, target, count: 0 });
      await API.post('/api/remote/request', { token: this.token, req, label, dossierId, target, title });
      return req;
    },
    cancel(req) { if (this.token) API.post('/api/remote/cancel', { token: this.token, req }).catch(() => {}); },
    setTitle(title) { if (this.token) API.post('/api/remote/title', { token: this.token, title }).catch(() => {}); },
    async stop() {
      const t = this.token;
      if (this.es) { try { this.es.close(); } catch (e) { /* ignore */ } }
      this.es = null; this.token = null; this.phones = 0;
      try { sessionStorage.removeItem(SS_KEY); sessionStorage.removeItem(SS_KEY + '.last'); } catch (e) { /* ignore */ }
      this.set('off');
      if (t) await API.post('/api/remote/stop', { token: t }).catch(() => {});
    }
  };

  // ===================================================================
  //  CÔTÉ TÉLÉPHONE (page « Appareil photo »)
  // ===================================================================
  function parsePhoneLink() {
    const m = /^#remote=([A-Za-z0-9_-]{16,64})/.exec(location.hash || '');
    return m ? { token: m[1] } : null;
  }

  function runPhone(root) {
    const link = parsePhoneLink();
    const base = `/api/remote/p/${link ? link.token : 'x'}`;
    const st = { state: 'connecting', title: '', appTitle: '', req: null, label: '', sent: [], es: null, ended: false };
    document.documentElement.setAttribute('data-layout', 'phone');
    document.documentElement.setAttribute('data-touch', '1');
    document.body.classList.add('phone-remote');
    const esc = U.esc;
    const statusTxt = () => ({
      connecting: 'Connexion…', connected: 'Connecté', lost: 'Connexion perdue – nouvelle tentative…',
      invalid: 'Lien invalide ou expiré', ended: 'Session terminée par le PC'
    }[st.state] || st.state);

    function view() {
      document.title = 'Appareil photo – ' + (st.appTitle || 'État des lieux');
      const ok = st.state === 'connected';
      let body;
      if (st.state === 'invalid' || st.state === 'ended') {
        body = `<div class="rp-idle"><div class="rp-big">⛔</div><p>${esc(statusTxt())}.</p>
          <p class="muted">Rescannez le QR code affiché sur le PC ou la tablette.</p></div>`;
      } else if (!ok) {
        body = `<div class="rp-idle"><div class="spinner"></div><p>${esc(statusTxt())}</p>
          <p class="muted small">Le téléphone doit être sur le même réseau Wi-Fi que le PC.</p></div>`;
      } else if (!st.req) {
        body = `<div class="rp-idle"><div class="rp-big">📷</div>
          <p><strong>Prêt.</strong></p>
          <p class="muted">Sur le PC ou la tablette, touchez <strong>📷 Photos</strong> sur une ligne : la demande s'affichera ici.</p></div>`;
      } else {
        const k = st.sent.filter(s => s.status === 'ok').length;
        body = `<div class="rp-request">
          <p class="muted small">Photo demandée pour</p>
          <h2 class="rp-label">${esc(st.label)}</h2>
          <label class="btn primary rp-shoot">📷 Prendre une photo
            <input type="file" accept="image/*" capture="environment" data-pick="camera" hidden></label>
          <label class="btn block rp-gallery">🖼 Choisir dans la galerie
            <input type="file" accept="image/*" multiple data-pick="gallery" hidden></label>
          <div class="rp-sent">${st.sent.map(s => `<div class="rp-thumb ${s.status}"><img src="${s.thumb}" alt=""><span>${s.status === 'ok' ? '✓' : s.status === 'err' ? '!' : '…'}</span></div>`).join('')}</div>
          <p class="muted small">${k ? `${k} photo${k > 1 ? 's' : ''} envoyée${k > 1 ? 's' : ''}. Vous pouvez en prendre d'autres.` : 'Vous pouvez prendre plusieurs photos.'}</p>
          <button class="btn block rp-done" data-act="done">✓ Terminé pour cette ligne</button>
        </div>`;
      }
      root.innerHTML = `
<header class="topbar"><div class="title"><strong>Appareil photo</strong><small>${esc(st.title || st.appTitle || 'État des lieux')}</small></div>
  <span class="rp-status ${ok ? 'on' : ''}">${esc(statusTxt())}</span></header>
<main class="content rp">${body}</main>`;
    }

    async function check() {
      try { await API.get(`${base}/check`); return true; }
      catch (e) { if (e.status === 404) { st.state = 'invalid'; st.ended = true; view(); } return false; }
    }

    function connect() {
      if (st.ended) return;
      const es = new EventSource(`${base}/events`);
      st.es = es;
      const data = ev => { try { return JSON.parse(ev.data); } catch (e) { return {}; } };
      es.onopen = () => { st.state = 'connected'; view(); };
      es.addEventListener('welcome', ev => { const d = data(ev); st.title = d.title || ''; st.appTitle = d.appTitle || st.appTitle; st.state = 'connected'; view(); });
      es.addEventListener('request', ev => {
        const d = data(ev);
        if (st.req !== d.req) { st.req = d.req; st.label = d.label || ''; st.sent = []; }
        try {
          const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
          if (active && navigator.vibrate) navigator.vibrate([120, 60, 120]);
        } catch (e) { /* ignore */ }
        view();
      });
      es.addEventListener('cancel', ev => { if (data(ev).req === st.req) { st.req = null; st.sent = []; view(); } });
      es.addEventListener('bye', () => { st.state = 'ended'; st.ended = true; st.req = null; es.close(); view(); });
      es.onerror = async () => {
        if (st.ended) return;
        if (es.readyState === 2) { // fermé définitivement
          if (await check()) setTimeout(connect, 2000);
          else if (!st.ended) setTimeout(connect, 4000);
        } else if (st.state !== 'lost') { st.state = 'lost'; view(); }
      };
    }

    async function sendFiles(files) {
      const req = st.req;
      for (const f of files) {
        const id = randomId(14);
        const item = { id, thumb: '', status: 'sending' };
        try {
          const full = await U.resizeImage(f, 1600, 0.82);
          const th = await U.resizeImage(full.dataUrl, 320, 0.7);
          item.thumb = th.dataUrl;
          st.sent.push(item); view();
          const q = `req=${encodeURIComponent(req)}&w=${full.w}&h=${full.h}&name=${encodeURIComponent((f.name || '').slice(0, 100))}`;
          await API.put(`${base}/photo/${id}?${q}&thumb=1`, API.dataUrlToBlob(th.dataUrl));
          await API.put(`${base}/photo/${id}?${q}&thumb=0`, API.dataUrlToBlob(full.dataUrl));
          item.status = 'ok';
        } catch (e) {
          console.error(e);
          item.status = 'err';
          if (!st.sent.includes(item)) st.sent.push(item);
          if (e.status === 410) { U.toast('Cette demande est terminée sur le PC.'); }
        }
        view();
      }
    }

    root.addEventListener('change', e => {
      const inp = e.target;
      if (!inp.dataset || !inp.dataset.pick) return;
      const files = Array.from(inp.files || []);
      inp.value = '';
      if (files.length && st.req) sendFiles(files);
    });
    root.addEventListener('click', e => {
      if (!e.target.closest('[data-act="done"]') || !st.req) return;
      API.post(`${base}/done`, { req: st.req }).catch(() => {});
      st.req = null; st.sent = []; view();
    });

    view();
    if (!link) { st.state = 'invalid'; st.ended = true; view(); return; }
    check().then(ok => { if (ok) connect(); });
  }

  window.Remote = { Host, runPhone, parsePhoneLink, randomId };
})();
