/* Enregistrement automatique sur le serveur (le PC).
   Chaque modification est d'abord écrite sur l'appareil (IndexedDB), puis envoyée
   au serveur : d'abord les nouvelles photos, ensuite le dossier (JSON).
   Si le réseau coupe, les envois sont réessayés automatiquement. */
(function () {
  'use strict';

  const holders = d => {
    const out = [];
    (d.pieces || []).forEach(p => (p.lignes || []).forEach(l => { out.push(l); (l.defauts || []).forEach(df => out.push(df)); }));
    (d.compteurs || []).forEach(m => out.push(m));
    (d.cles || []).forEach(k => { if (!Array.isArray(k.photos)) k.photos = []; out.push(k); });
    return out;
  };

  /* Version envoyée au serveur : uniquement des références de photos. */
  function forServer(d) {
    const c = JSON.parse(JSON.stringify(d));
    holders(c).forEach(h => {
      h.photos = (h.photos || []).map(p => ({ id: p.id, name: p.name || '', w: p.w || null, h: p.h || null, addedAt: p.addedAt || null, source: p.source }));
    });
    delete c.server; delete c.github; delete c.signatures;
    return c;
  }

  /* Dossier reçu du serveur → version locale (photos marquées comme déjà envoyées). */
  function fromServer(remote, local) {
    const d = EDL_TEMPLATES.normalize(remote);
    const localThumbs = new Map();
    if (local) holders(local).forEach(h => (h.photos || []).forEach(p => { if (p.thumb) localThumbs.set(p.id, p.thumb); }));
    holders(d).forEach(h => (h.photos || []).forEach(p => {
      p.up = true;
      if (localThumbs.has(p.id)) p.thumb = localThumbs.get(p.id);
    }));
    d.server = { rev: remote.rev || 0, savedAt: remote.savedAt || null, dirty: false, edits: 0 };
    return d;
  }

  const Sync = {
    state: 'idle', detail: '', listeners: new Set(),
    onConflict: null, current: null,
    _running: null, _again: null, _timer: null, _retry: null,

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    set(state, detail) { this.state = state; this.detail = detail || ''; this.listeners.forEach(fn => { try { fn(state, detail); } catch (e) { console.error(e); } }); },

    schedule(d, delay) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.push(d), delay == null ? 1200 : delay);
    },

    /* Envoie immédiatement ce qui reste à envoyer ; renvoie true si tout est sur le serveur. */
    async flush(d) {
      clearTimeout(this._timer);
      await this.push(d);
      return !(d.server && d.server.dirty) && !holders(d).some(h => (h.photos || []).some(p => !p.up && p.dataUrl));
    },

    push(d) {
      if (!d) return Promise.resolve();
      if (this._running) { this._again = d; return this._running; }
      clearTimeout(this._retry);
      this._running = this._push(d).finally(() => {
        this._running = null;
        const again = this._again; this._again = null;
        if (again) this.push(again);
      });
      return this._running;
    },

    async _push(d) {
      d.server = d.server || { rev: 0, dirty: true, edits: 0 };
      const pending = [];
      holders(d).forEach(h => (h.photos || []).forEach(p => { if (!p.up && p.dataUrl) pending.push(p); }));
      if (!d.server.dirty && !pending.length) { this.set('saved', d.server.savedAt); return; }
      try {
        let i = 0;
        for (const p of pending) {
          i++;
          this.set('saving', pending.length > 1 ? `photo ${i}/${pending.length}` : 'photo');
          if (p.thumb && String(p.thumb).startsWith('data:')) await API.put(API.photoUrl(d.id, p.id, true), API.dataUrlToBlob(p.thumb));
          await API.put(API.photoUrl(d.id, p.id, false), API.dataUrlToBlob(p.dataUrl));
          p.up = true;
          delete p.dataUrl; // l'original est maintenant sur le PC ; la vignette reste en cache local
          await Store.put(d);
        }
        if (d.server.dirty || pending.length) {
          this.set('saving', '');
          const edits = d.server.edits || 0;
          const r = await API.put(`/api/dossiers/${encodeURIComponent(d.id)}`, { dossier: forServer(d), baseRev: d.server.rev || 0, force: !!d.server.force });
          d.server.rev = r.rev;
          d.server.savedAt = r.savedAt;
          d.server.force = false;
          if ((d.server.edits || 0) === edits) d.server.dirty = false;
          await Store.put(d);
        }
        this.set(d.server.dirty ? 'saving' : 'saved', d.server.savedAt);
        if (d.server.dirty) this.schedule(d, 300);
      } catch (e) {
        console.warn('Synchronisation :', e);
        if (e.status === 409) {
          // Conflit « apparent » : si la version du PC est identique à la nôtre, on s'aligne sans rien demander.
          if (await this._sameAsServer(d)) { this.set('saved', d.server.savedAt); return; }
          this.set('conflict', e.message);
          if (typeof this.onConflict === 'function') this.onConflict(d, e);
        } else if (e.status === 401) {
          this.set('auth', 'Reconnexion nécessaire');
        } else {
          this.set('offline', e.offline ? 'Serveur injoignable' : e.message);
          this._retry = setTimeout(() => this.push(this.current && this.current.id === d.id ? this.current : d), 8000);
        }
      }
    },

    async _sameAsServer(d) {
      try {
        const remote = (await API.get(`/api/dossiers/${encodeURIComponent(d.id)}`)).dossier;
        const strip = x => { const c = JSON.parse(JSON.stringify(x)); delete c.rev; delete c.savedAt; delete c.updatedAt; delete c.server; return JSON.stringify(c); };
        if (strip(forServer(d)) !== strip(remote)) return false;
        d.server.rev = remote.rev; d.server.savedAt = remote.savedAt; d.server.dirty = false;
        await Store.put(d);
        return true;
      } catch (e) { return false; }
    },

    forServer, fromServer, holders
  };

  window.Sync = Sync;
})();
