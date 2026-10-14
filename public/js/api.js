/* Accès au serveur local (même origine). */
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(msg, status, data, offline) { super(msg); this.status = status || 0; this.data = data || {}; this.offline = !!offline; }
  }

  const API = {
    onUnauthorized: null,

    async req(method, url, body, opts) {
      opts = opts || {};
      const headers = { 'X-EDL': '1' };
      let payload;
      if (body instanceof Blob) { payload = body; headers['Content-Type'] = body.type || 'application/octet-stream'; }
      else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
      let res;
      try {
        res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
      } catch (e) {
        throw new ApiError('Serveur injoignable (vérifiez le réseau / que le PC est allumé).', 0, null, true);
      }
      if (opts.raw && res.ok) return res;
      let data = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) { try { data = await res.json(); } catch (e) { data = null; } }
      if (!res.ok) {
        const err = new ApiError((data && data.error) || `Erreur ${res.status}`, res.status, data);
        if (res.status === 401 && !opts.noAuthHook && typeof API.onUnauthorized === 'function') API.onUnauthorized(err);
        throw err;
      }
      return data;
    },
    get(url, opts) { return API.req('GET', url, undefined, opts); },
    post(url, body, opts) { return API.req('POST', url, body === undefined ? {} : body, opts); },
    put(url, body, opts) { return API.req('PUT', url, body, opts); },
    del(url, opts) { return API.req('DELETE', url, undefined, opts); },

    photoUrl(dossierId, photoId, thumb) {
      return `/api/dossiers/${encodeURIComponent(dossierId)}/photos/${encodeURIComponent(photoId)}${thumb ? '?thumb=1' : ''}`;
    },
    async photoDataUrl(dossierId, photoId) {
      const res = await API.req('GET', API.photoUrl(dossierId, photoId, false), undefined, { raw: true });
      const blob = await res.blob();
      return U.blobToDataUrlAs(blob, 'photo.jpg');
    },

    dataUrlToBlob(dataUrl) {
      const s = String(dataUrl);
      const i = s.indexOf(',');
      const mime = (/^data:([^;,]+)/.exec(s) || [])[1] || 'application/octet-stream';
      const bin = atob(s.slice(i + 1));
      const out = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return new Blob([out], { type: mime });
    },

    ApiError
  };

  window.API = API;
})();
