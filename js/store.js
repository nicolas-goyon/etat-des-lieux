/* Stockage local des dossiers dans IndexedDB (photos comprises). */
(function () {
  'use strict';
  const DB_NAME = 'edl-db';
  const DB_VERSION = 1;
  const STORE = 'dossiers';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB indisponible')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('Ouverture IndexedDB impossible'));
      req.onblocked = () => rej(new Error('IndexedDB bloquée'));
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error || new Error('Transaction échouée'));
      tx.onabort = () => rej(tx.error || new Error('Transaction annulée'));
    }));
  }

  const Store = {
    async list() {
      const all = (await run('readonly', s => s.getAll())) || [];
      return all.map(EDL_TEMPLATES.summary)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    },
    async get(id) {
      const d = await run('readonly', s => s.get(id));
      return d ? EDL_TEMPLATES.normalize(d) : null;
    },
    put(d) { return run('readwrite', s => s.put(d)); },
    remove(id) { return run('readwrite', s => s.delete(id)); }
  };

  window.Store = Store;
})();
