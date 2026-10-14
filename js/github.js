/* Synchronisation avec un dépôt GitHub (API REST, jeton stocké localement).
   Les dossiers sont écrits dans  <DATA_DIR>/dossiers/<id>.json
   les photos dans              <DATA_DIR>/photos/<id>/<photoId>.jpg
   et un index dans             <DATA_DIR>/index.json
   Chaque enregistrement produit UN seul commit (API Git Data : blobs → tree → commit → ref). */
(function () {
  'use strict';
  const API = 'https://api.github.com';
  const KEY = 'edl.github';

  function getConfig() {
    try { return JSON.parse(U.local.get(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function setConfig(c) { U.local.set(KEY, JSON.stringify(c || {})); }
  function isConfigured() { const c = getConfig(); return !!(c.owner && c.repo && c.token); }
  function branch() { return (getConfig().branch || 'main').trim(); }
  function dataDir() {
    const cfg = window.EDL_CONFIG || {};
    return String(cfg.DATA_DIR || 'data').replace(/^\/+|\/+$/g, '') || 'data';
  }

  /* Déduit owner/repo depuis l'URL GitHub Pages (https://owner.github.io/repo/). */
  function detectRepo() {
    try {
      const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
      if (!m) return {};
      const seg = location.pathname.split('/').filter(Boolean);
      return { owner: m[1], repo: seg.length ? seg[0] : `${m[1]}.github.io` };
    } catch (e) { return {}; }
  }

  function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
  function repoPath() {
    const c = getConfig();
    return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
  }

  async function api(path, opts) {
    opts = opts || {};
    const c = getConfig();
    const headers = {
      'Authorization': 'Bearer ' + c.token,
      'Accept': opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); if (j && j.message) msg += ' – ' + j.message; } catch (e) { /* ignore */ }
      if (res.status === 401) msg += ' (jeton invalide ou expiré)';
      if (res.status === 403 || res.status === 404) msg += ' (vérifiez owner/repo et les droits « Contents : lecture/écriture » du jeton)';
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res;
  }

  async function test() {
    const repo = await (await api(repoPath())).json();
    await api(`${repoPath()}/branches/${encodeURIComponent(branch())}`);
    return repo;
  }

  /* Lecture d'un fichier : via l'API si un jeton est configuré, sinon en relatif
     depuis le site GitHub Pages lui-même (lecture publique, après publication). */
  async function readText(path) {
    if (isConfigured()) {
      try {
        const r = await api(`${repoPath()}/contents/${encPath(path)}?ref=${encodeURIComponent(branch())}`, { raw: true });
        return await r.text();
      } catch (e) { if (e.status === 404) return null; throw e; }
    }
    const r = await fetch(`./${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  }

  async function readBlob(path) {
    if (isConfigured()) {
      const r = await api(`${repoPath()}/contents/${encPath(path)}?ref=${encodeURIComponent(branch())}`, { raw: true });
      return await r.blob();
    }
    const r = await fetch(`./${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' pour ' + path);
    return await r.blob();
  }

  /* files : [{ path, text }] ou [{ path, base64 }]  →  un seul commit. */
  async function commitFiles(files, message, onProgress) {
    const say = t => { if (onProgress) onProgress(t); };
    const rp = repoPath();
    const br = branch();
    say('Lecture de la branche…');
    let ref;
    try {
      ref = await (await api(`${rp}/git/ref/heads/${encodeURIComponent(br)}`)).json();
    } catch (e) {
      if (e.status === 404 || e.status === 409) throw new Error(`Branche « ${br} » introuvable ou dépôt vide. Déployez d'abord l'application dans le dépôt.`);
      throw e;
    }
    const headSha = ref.object.sha;
    const commit = await (await api(`${rp}/git/commits/${headSha}`)).json();
    const baseTree = commit.tree.sha;

    const tree = [];
    const total = files.length;
    let done = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async f => {
        const body = f.base64 != null
          ? { content: f.base64, encoding: 'base64' }
          : { content: f.text, encoding: 'utf-8' };
        const blob = await (await api(`${rp}/git/blobs`, { method: 'POST', body: JSON.stringify(body) })).json();
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        done++;
        say(`Envoi des fichiers ${done}/${total}…`);
      }));
    }
    say('Création du commit…');
    const newTree = await (await api(`${rp}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) })).json();
    const newCommit = await (await api(`${rp}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }) })).json();
    await api(`${rp}/git/refs/heads/${encodeURIComponent(br)}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: false }) });
    return newCommit.sha;
  }

  function putTextFile(path, text, message, onProgress) {
    return commitFiles([{ path, text }], message || `Mise à jour de ${path}`, onProgress);
  }

  function allPhotoHolders(d) {
    const items = [];
    (d.pieces || []).forEach(p => (p.lignes || []).forEach(l => items.push(l)));
    (d.compteurs || []).forEach(m => items.push(m));
    return items;
  }

  /* Version « dépôt » du dossier : les photos sont référencées par fichier. */
  function toRepoJson(d, dir) {
    const copy = U.clone(d);
    allPhotoHolders(copy).forEach(it => {
      it.photos = (it.photos || []).map(ph => ({
        id: ph.id, name: ph.name || '', w: ph.w || null, h: ph.h || null, addedAt: ph.addedAt || null,
        file: `${dir}/photos/${d.id}/${ph.id}.jpg`
      }));
    });
    delete copy.signatures;
    delete copy.github;
    return copy;
  }

  async function saveDossier(d, onProgress) {
    if (!isConfigured()) throw new Error('GitHub non configuré');
    const say = t => { if (onProgress) onProgress(t); };
    const dir = dataDir();
    const files = [];
    const uploaded = [];

    allPhotoHolders(d).forEach(it => (it.photos || []).forEach(ph => {
      if (!ph.dataUrl) return;
      const path = `${dir}/photos/${d.id}/${ph.id}.jpg`;
      if (ph.remote !== path) {
        files.push({ path, base64: U.dataUrlToB64(ph.dataUrl) });
        uploaded.push([ph, path]);
      }
    }));

    files.push({ path: `${dir}/dossiers/${d.id}.json`, text: JSON.stringify(toRepoJson(d, dir), null, 1) });

    say("Lecture de l'index…");
    let index = { dossiers: [] };
    const txt = await readText(`${dir}/index.json`);
    if (txt) { try { index = JSON.parse(txt) || index; } catch (e) { index = { dossiers: [] }; } }
    if (!Array.isArray(index.dossiers)) index.dossiers = [];
    const s = EDL_TEMPLATES.summary(d);
    delete s.dirty; delete s.lastSync;
    s.file = `${dir}/dossiers/${d.id}.json`;
    index.dossiers = index.dossiers.filter(x => x && x.id !== d.id);
    index.dossiers.unshift(s);
    index.updatedAt = new Date().toISOString();
    files.push({ path: `${dir}/index.json`, text: JSON.stringify(index, null, 1) });

    const label = d.type === 'sortie' ? 'sortie' : 'entrée';
    await commitFiles(files, `EDL ${label} – ${d.adresse || d.id} (${d.date || ''})`, onProgress);
    uploaded.forEach(([ph, path]) => { ph.remote = path; });
    return true;
  }

  async function loadIndex() {
    const txt = await readText(`${dataDir()}/index.json`);
    if (!txt) return { dossiers: [] };
    const idx = JSON.parse(txt);
    if (!Array.isArray(idx.dossiers)) idx.dossiers = [];
    return idx;
  }

  /* Recharge un dossier depuis le dépôt, photos comprises. */
  async function loadDossier(id, onProgress) {
    const say = t => { if (onProgress) onProgress(t); };
    const dir = dataDir();
    say('Lecture du dossier…');
    const txt = await readText(`${dir}/dossiers/${encodeURIComponent(id)}.json`);
    if (!txt) throw new Error('Dossier introuvable dans le dépôt');
    const d = EDL_TEMPLATES.normalize(JSON.parse(txt));
    await hydrate(d, say);
    return d;
  }

  /* Télécharge les photos référencées par fichier (après import JSON « dépôt » ou loadDossier). */
  async function hydrate(d, say) {
    say = say || (() => {});
    const jobs = [];
    allPhotoHolders(d).forEach(it => (it.photos || []).forEach(ph => {
      if (!ph.dataUrl && ph.file) jobs.push(async () => {
        const blob = await readBlob(ph.file);
        ph.dataUrl = await U.blobToDataUrlAs(blob, ph.file);
        try {
          const th = await U.resizeImage(ph.dataUrl, 320, 0.7);
          ph.thumb = th.dataUrl;
          if (!ph.w || !ph.h) { const full = await U.loadImage(ph.dataUrl); ph.w = full.naturalWidth; ph.h = full.naturalHeight; }
        } catch (e) { /* vignette facultative */ }
        ph.remote = ph.file;
        delete ph.file;
      });
    }));
    let done = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      await Promise.all(jobs.slice(i, i + CONCURRENCY).map(j => j().catch(e => { console.error(e); })));
      done = Math.min(jobs.length, i + CONCURRENCY);
      say(`Téléchargement des photos ${done}/${jobs.length}…`);
    }
    return d;
  }

  window.GitHub = {
    getConfig, setConfig, isConfigured, detectRepo, dataDir,
    test, readText, readBlob, commitFiles, putTextFile,
    saveDossier, loadIndex, loadDossier, hydrate, toRepoJson
  };
})();
