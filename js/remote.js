/* Téléphone utilisé comme appareil photo pour le PC / la tablette.
   - Le PC (hôte) ouvre une connexion PeerJS et affiche un QR code contenant
     l'adresse de l'application + un identifiant de session + une clé secrète.
   - Le téléphone scanne, ouvre la page dédiée (#remote=…), se connecte en direct
     (WebRTC, chiffré) et attend les demandes de photo.
   - Les photos passent directement d'un appareil à l'autre : rien n'est stocké
     sur un serveur. Le serveur PeerJS ne sert qu'à mettre les deux appareils en relation.
   Les deux appareils doivent avoir accès à Internet. */
(function () {
  'use strict';

  const SS_KEY = 'edl.remote';

  function PeerCtor() { return window.Peer || (window.peerjs && window.peerjs.Peer) || null; }

  function randomId(n) {
    const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
    const a = new Uint32Array(n);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, x => abc[x % abc.length]).join('');
  }

  function peerOptions() {
    const cfg = (window.EDL_CONFIG && window.EDL_CONFIG.PEER_SERVER) || null;
    const opts = { debug: 0 };
    if (cfg && typeof cfg === 'object') Object.assign(opts, cfg);
    return opts;
  }

  function appBaseUrl() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  // ===================================================================
  //  CÔTÉ PC / TABLETTE (hôte)
  // ===================================================================
  const Host = {
    peer: null, conn: null, state: 'off', error: '', id: null, key: null, phoneInfo: '',
    listeners: new Set(), handlers: { photo: null, done: null },
    pending: new Map(),      // req → { holder, label }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { this.listeners.forEach(fn => { try { fn(this.state); } catch (e) { console.error(e); } }); },
    set(state, error) { this.state = state; this.error = error || ''; this.emit(); },
    isConnected() { return this.state === 'connected' && this.conn && this.conn.open; },

    link() { return `${appBaseUrl()}#remote=${this.id}&k=${this.key}`; },

    start() {
      if (this.peer && !this.peer.destroyed) return;
      const Peer = PeerCtor();
      if (!Peer) { this.set('error', 'Bibliothèque de connexion non chargée.'); return; }
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch (e) { saved = null; }
      this.id = saved && saved.id || 'edl-' + randomId(22);
      this.key = saved && saved.key || randomId(20);
      try { sessionStorage.setItem(SS_KEY, JSON.stringify({ id: this.id, key: this.key })); } catch (e) { /* ignore */ }
      this.set('starting');
      const peer = new Peer(this.id, peerOptions());
      this.peer = peer;
      peer.on('open', () => { if (this.state !== 'connected') this.set('ready'); });
      peer.on('connection', conn => this.accept(conn));
      peer.on('disconnected', () => {
        // perte du serveur de mise en relation : la liaison directe éventuelle continue
        if (!peer.destroyed) setTimeout(() => { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch (e) { /* ignore */ } }, 2000);
      });
      peer.on('error', err => {
        const type = err && err.type;
        if (type === 'unavailable-id') {
          // identifiant encore réservé (rechargement rapide) : on en prend un nouveau
          try { sessionStorage.removeItem(SS_KEY); } catch (e) { /* ignore */ }
          this.destroyPeer();
          this.start();
          return;
        }
        if (type === 'peer-unavailable') return; // sans objet côté hôte
        if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          if (this.state !== 'connected') this.set('error', "Serveur de mise en relation injoignable. Vérifiez la connexion Internet de cet appareil.");
          return;
        }
        if (this.state !== 'connected') this.set('error', (err && err.message) || String(err));
      });
    },

    accept(conn) {
      const meta = conn.metadata || {};
      if (meta.k !== this.key) {
        conn.on('open', () => { try { conn.send({ t: 'refused' }); } catch (e) { /* ignore */ } setTimeout(() => conn.close(), 300); });
        return;
      }
      conn.on('open', () => {
        if (this.conn && this.conn !== conn) { try { this.conn.send({ t: 'replaced' }); this.conn.close(); } catch (e) { /* ignore */ } }
        this.conn = conn;
        this.phoneInfo = meta.ua || '';
        this.set('connected');
        this.sendWelcome();
        // une demande était peut-être en cours avant une coupure : on la renvoie
        const last = Array.from(this.pending.entries()).filter(([, v]) => v.active).pop();
        if (last) this.send({ t: 'request', req: last[0], label: last[1].label });
      });
      conn.on('data', msg => this.onData(conn, msg));
      conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.set(this.peer && !this.peer.destroyed ? 'ready' : 'off'); } });
      conn.on('error', () => { /* géré par close */ });
    },

    sendWelcome() {
      const d = window.EDL && window.EDL.App && window.EDL.App.dossier;
      this.send({ t: 'welcome', title: d ? (d.adresse || 'État des lieux') : 'Aucun dossier ouvert' });
    },

    send(msg) { if (this.conn && this.conn.open) { try { this.conn.send(msg); return true; } catch (e) { console.error(e); } } return false; },

    onData(conn, msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'photo') {
        const p = this.pending.get(msg.req);
        if (!p || !this.handlers.photo) { this.send({ t: 'ack', req: msg.req, id: msg.id, ok: false }); return; }
        Promise.resolve(this.handlers.photo(p, msg))
          .then(n => this.send({ t: 'ack', req: msg.req, id: msg.id, ok: true, n }))
          .catch(e => { console.error(e); this.send({ t: 'ack', req: msg.req, id: msg.id, ok: false }); });
      } else if (msg.t === 'done') {
        const p = this.pending.get(msg.req);
        if (p) p.active = false;
        if (p && this.handlers.done) this.handlers.done(p, msg.req);
      } else if (msg.t === 'ping') {
        this.send({ t: 'pong' });
      }
    },

    request(holder, label) {
      const req = randomId(10);
      this.pending.forEach(v => { v.active = false; });
      this.pending.set(req, { holder, label, active: true, count: 0 });
      this.send({ t: 'request', req, label });
      return req;
    },
    cancel(req) {
      const p = this.pending.get(req);
      if (p) p.active = false;
      this.send({ t: 'cancel', req });
    },

    destroyPeer() {
      if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
      this.peer = null; this.conn = null;
    },
    stop() {
      this.send({ t: 'bye' });
      this.destroyPeer();
      try { sessionStorage.removeItem(SS_KEY); } catch (e) { /* ignore */ }
      this.set('off');
    }
  };

  // ===================================================================
  //  CÔTÉ TÉLÉPHONE (page dédiée)
  // ===================================================================
  function parsePhoneLink() {
    const m = /^#remote=([A-Za-z0-9_-]+)&k=([A-Za-z0-9]+)/.exec(location.hash || '');
    return m ? { host: m[1], key: m[2] } : null;
  }

  function runPhone(root) {
    const link = parsePhoneLink();
    const st = { state: 'connecting', title: '', req: null, label: '', sent: [], peer: null, conn: null, retry: null, wake: null, ended: false };
    document.title = 'Appareil photo – ' + ((window.EDL_CONFIG && window.EDL_CONFIG.APP_TITLE) || 'État des lieux');
    document.documentElement.setAttribute('data-layout', 'phone');
    document.documentElement.setAttribute('data-touch', '1');
    document.body.classList.add('phone-remote');

    const esc = U.esc;
    const statusTxt = () => ({
      connecting: 'Connexion…', connected: 'Connecté', lost: 'Connexion perdue – nouvelle tentative…',
      refused: 'Lien invalide ou expiré', replaced: 'Un autre téléphone a pris le relais', ended: 'Session terminée par le PC'
    }[st.state] || st.state);

    function view() {
      const ok = st.state === 'connected';
      let body;
      if (st.state === 'refused' || st.state === 'replaced' || st.state === 'ended') {
        body = `<div class="rp-idle"><div class="rp-big">⛔</div><p>${esc(statusTxt())}.</p>
          <p class="muted">Rescannez le QR code affiché sur le PC ou la tablette.</p></div>`;
      } else if (!ok) {
        body = `<div class="rp-idle"><div class="spinner"></div><p>${esc(statusTxt())}</p>
          <p class="muted small">Le téléphone et le PC / la tablette doivent être connectés à Internet.</p></div>`;
      } else if (!st.req) {
        body = `<div class="rp-idle"><div class="rp-big">📷</div>
          <p><strong>Prêt.</strong></p>
          <p class="muted">Sur le PC ou la tablette, touchez <strong>📷 Photos</strong> sur une ligne : la demande s'affichera ici.</p></div>`;
      } else {
        body = `<div class="rp-request">
          <p class="muted small">Photo demandée pour</p>
          <h2 class="rp-label">${esc(st.label)}</h2>
          <label class="btn primary rp-shoot">📷 Prendre une photo
            <input type="file" accept="image/*" capture="environment" data-pick="camera" hidden></label>
          <label class="btn block rp-gallery">🖼 Choisir dans la galerie
            <input type="file" accept="image/*" multiple data-pick="gallery" hidden></label>
          <div class="rp-sent">${st.sent.map(s => `<div class="rp-thumb ${s.status}"><img src="${s.thumb}" alt=""><span>${s.status === 'ok' ? '✓' : s.status === 'err' ? '!' : '…'}</span></div>`).join('')}</div>
          <p class="muted small">${(() => { const k = st.sent.filter(s => s.status === 'ok').length; return k ? `${k} photo${k > 1 ? 's' : ''} envoyée${k > 1 ? 's' : ''}. Vous pouvez en prendre d'autres.` : 'Vous pouvez prendre plusieurs photos.'; })()}</p>
          <button class="btn block rp-done" data-act="done">✓ Terminé pour cette ligne</button>
        </div>`;
      }
      root.innerHTML = `
<header class="topbar"><div class="title"><strong>Appareil photo</strong><small>${esc(st.title || 'État des lieux')}</small></div>
  <span class="rp-status ${ok ? 'on' : ''}">${esc(statusTxt())}</span></header>
<main class="content rp">${body}</main>`;
    }

    function connect() {
      if (st.ended) return;
      const Peer = PeerCtor();
      if (!Peer) { st.state = 'Bibliothèque de connexion non chargée'; view(); return; }
      if (!st.peer || st.peer.destroyed) {
        st.peer = new Peer(peerOptions());
        st.peer.on('open', () => openConn());
        st.peer.on('error', err => {
          if (err && err.type === 'peer-unavailable') { st.state = 'lost'; view(); scheduleRetry(); return; }
          if (st.state !== 'connected') { st.state = 'lost'; view(); scheduleRetry(); }
        });
        st.peer.on('disconnected', () => { setTimeout(() => { try { if (st.peer && !st.peer.destroyed && st.peer.disconnected) st.peer.reconnect(); } catch (e) { /* ignore */ } }, 2000); });
      } else if (st.peer.open) openConn();
    }

    function openConn() {
      if (st.conn && st.conn.open) return;
      const conn = st.peer.connect(link.host, { reliable: true, metadata: { k: link.key, ua: navigator.userAgent.slice(0, 120) } });
      st.conn = conn;
      conn.on('open', () => { st.state = 'connected'; view(); keepAwake(); });
      conn.on('data', onData);
      conn.on('close', () => {
        if (st.conn !== conn) return;
        st.conn = null;
        if (['refused', 'replaced', 'ended'].includes(st.state)) return;
        st.state = 'lost'; view(); scheduleRetry();
      });
      conn.on('error', () => { /* close suit */ });
    }

    function scheduleRetry() {
      clearTimeout(st.retry);
      st.retry = setTimeout(connect, 3000);
    }

    function onData(msg) {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'welcome': st.title = msg.title || ''; view(); break;
        case 'request':
          if (st.req !== msg.req) { st.req = msg.req; st.label = msg.label || ''; st.sent = []; }
          try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* ignore */ }
          view(); break;
        case 'cancel': if (msg.req === st.req) { st.req = null; st.sent = []; view(); } break;
        case 'ack': {
          const s = st.sent.find(x => x.id === msg.id);
          if (s) { s.status = msg.ok ? 'ok' : 'err'; view(); }
          break;
        }
        case 'refused': st.state = 'refused'; st.ended = true; view(); break;
        case 'replaced': st.state = 'replaced'; st.ended = true; view(); break;
        case 'bye': st.state = 'ended'; st.ended = true; st.req = null; view(); break;
        default: break;
      }
    }

    async function keepAwake() {
      try { if (navigator.wakeLock && !st.wake) { st.wake = await navigator.wakeLock.request('screen'); st.wake.addEventListener('release', () => { st.wake = null; }); } } catch (e) { /* ignore */ }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { keepAwake(); if (!st.conn || !st.conn.open) connect(); }
    });

    async function sendFiles(files) {
      const req = st.req;
      for (const f of files) {
        const id = randomId(8);
        const item = { id, thumb: '', status: 'sending' };
        try {
          const full = await U.resizeImage(f, 1600, 0.82);
          const th = await U.resizeImage(full.dataUrl, 200, 0.6);
          item.thumb = th.dataUrl;
          st.sent.push(item); view();
          if (!st.conn || !st.conn.open) throw new Error('non connecté');
          st.conn.send({ t: 'photo', req, id, name: f.name || '', dataUrl: full.dataUrl, w: full.w, h: full.h });
        } catch (e) {
          console.error(e);
          item.status = 'err';
          if (!st.sent.includes(item)) st.sent.push(item);
          view();
        }
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
      const b = e.target.closest('[data-act="done"]');
      if (!b || !st.req) return;
      if (st.conn && st.conn.open) st.conn.send({ t: 'done', req: st.req });
      st.req = null; st.sent = []; view();
    });

    view();
    if (!link) { st.state = 'refused'; view(); return; }
    connect();
  }

  window.Remote = { Host, runPhone, parsePhoneLink, appBaseUrl, randomId };
})();
