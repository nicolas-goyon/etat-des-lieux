/* Petites fonctions utilitaires partagées. */
(function () {
  'use strict';
  const U = {};

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  U.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  U.todayISO = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  U.fmtDate = iso => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
  };

  U.fmtDateTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  U.timeNow = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  U.slug = s => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'dossier';

  U.clone = o => JSON.parse(JSON.stringify(o));

  U.setPath = (obj, path, val) => {
    const parts = String(path).split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      o = o[k];
    }
    o[parts[parts.length - 1]] = val;
  };

  U.getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  U.download = (name, blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };

  U.readFileAsDataUrl = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Lecture impossible'));
    r.readAsDataURL(file);
  });

  U.readFileAsText = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Lecture impossible'));
    r.readAsText(file);
  });

  U.loadImage = src => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image illisible'));
    img.src = src;
  });

  /* Redimensionne une image (File/Blob ou dataURL) : le navigateur applique
     lui-même l'orientation EXIF lors du décodage dans un <img>. */
  U.resizeImage = async (source, maxSide, quality) => {
    const isStr = typeof source === 'string';
    const url = isStr ? source : URL.createObjectURL(source);
    try {
      const img = await U.loadImage(url);
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      return { dataUrl: c.toDataURL('image/jpeg', quality), w: cw, h: ch };
    } finally {
      if (!isStr) URL.revokeObjectURL(url);
    }
  };

  U.dataUrlToB64 = d => String(d).slice(String(d).indexOf(',') + 1);

  U.utf8ToB64 = s => {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  };

  U.blobToDataUrl = U.readFileAsDataUrl;

  U.bytesToB64 = bytes => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  /* Blob → dataURL avec un type MIME fiable déduit de l'extension (certains serveurs
     renvoie un Content-Type générique). */
  U.blobToDataUrlAs = async (blob, pathOrName) => {
    const ext = String(pathOrName || '').split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    const buf = await blob.arrayBuffer();
    return `data:${mime};base64,${U.bytesToB64(new Uint8Array(buf))}`;
  };

  let toastTimer;
  U.toast = (msg, ms = 2600) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  };

  U.sleep = ms => new Promise(r => setTimeout(r, ms));

  /* Accès tolérant au stockage web (certains contextes privés lèvent une exception). */
  function safeStorage(getter) {
    const mem = {};
    const s = () => { try { return getter(); } catch (e) { return null; } };
    return {
      get(k) { const st = s(); try { return st ? st.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return mem[k] == null ? null : mem[k]; } },
      set(k, v) { const st = s(); try { if (st) { st.setItem(k, v); return; } } catch (e) { /* mémoire */ } mem[k] = String(v); },
      remove(k) { const st = s(); try { if (st) st.removeItem(k); } catch (e) { /* ignore */ } delete mem[k]; }
    };
  }
  U.local = safeStorage(() => window.localStorage);
  U.session = safeStorage(() => window.sessionStorage);

  window.U = U;
})();
