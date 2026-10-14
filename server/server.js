/* =====================================================================
   État des lieux – serveur local (Node.js, aucune dépendance externe)
   - Sert l'application web (dossier public/)
   - Authentification par code d'accès (défini dans .env), sessions signées,
     limitation des tentatives
   - Stockage des dossiers (JSON), photos (JPEG) et PDF dans /data
     (volume Docker : les données survivent aux redémarrages)
   - Relais « téléphone comme appareil photo » sur le réseau local (SSE)
   ===================================================================== */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = '2.1.0';

// ---------------------------------------------------------------------
//  Configuration (variables d'environnement, voir .env)
// ---------------------------------------------------------------------
const env = process.env;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const bool = v => /^(1|true|yes|oui|on)$/i.test(String(v || '').trim());

const CONF = {
  port: num(env.INTERNAL_PORT, 8080),
  dataDir: path.resolve(env.DATA_DIR || '/data'),
  publicDir: path.resolve(env.PUBLIC_DIR || path.join(__dirname, 'public')),
  title: (env.APP_TITLE || 'État des lieux').trim(),
  accessCode: String(env.ACCESS_CODE || '').trim(),
  publicUrl: String(env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  sessionDays: num(env.SESSION_DAYS, 30),
  maxUploadMb: num(env.MAX_UPLOAD_MB, 25),
  maxAttempts: num(env.LOGIN_MAX_ATTEMPTS, 8),
  lockMinutes: num(env.LOGIN_LOCK_MINUTES, 15),
  trashDays: num(env.TRASH_DAYS, 30),
  historyKeep: num(env.HISTORY_KEEP, 10),
  https: bool(env.HTTPS),
  trustProxy: bool(env.TRUST_PROXY)
};

const DIRS = {
  dossiers: path.join(CONF.dataDir, 'dossiers'),
  trash: path.join(CONF.dataDir, 'corbeille'),
  certs: path.join(CONF.dataDir, 'certs')
};
const AUTH_FILE = path.join(CONF.dataDir, 'auth.json');
const SECRET_FILE = path.join(CONF.dataDir, 'secret.key');

const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!CONF.accessCode) {
  console.error('\n[ERREUR] La variable ACCESS_CODE est vide. Renseignez un code d\'accès dans le fichier .env puis relancez.\n');
  process.exit(1);
}
if (CONF.accessCode.length < 4) {
  console.error('\n[ERREUR] ACCESS_CODE doit contenir au moins 4 caractères.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------
//  Utilitaires fichiers
// ---------------------------------------------------------------------
async function ensureDir(d) { await fsp.mkdir(d, { recursive: true }); }

async function writeAtomic(file, data) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

async function exists(p) { try { await fsp.access(p); return true; } catch (e) { return false; } }

/* Verrou simple par clé : sérialise les écritures concurrentes sur un même dossier. */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn);
  // la file d'attente ne doit jamais porter d'erreur (sinon : rejet non géré → arrêt du serveur)
  const tail = next.then(() => {}, () => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return next;
}

const ID_RE = /^[A-Za-z0-9]{4,40}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

// ---------------------------------------------------------------------
//  Secret de signature et code d'accès
// ---------------------------------------------------------------------
let SECRET;
let AUTH; // { salt, hash, envFingerprint, version, source, updatedAt }

function scryptHash(code, salt) {
  return crypto.scryptSync(String(code), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function fingerprint(code) { return crypto.createHash('sha256').update('edl-env:' + code).digest('hex'); }

async function initSecurity() {
  await ensureDir(CONF.dataDir);
  try { SECRET = await fsp.readFile(SECRET_FILE); }
  catch (e) {
    SECRET = crypto.randomBytes(48);
    await writeAtomic(SECRET_FILE, SECRET);
    try { await fsp.chmod(SECRET_FILE, 0o600); } catch (err) { /* ignore */ }
  }
  const fp = fingerprint(CONF.accessCode);
  const cur = await readJson(AUTH_FILE, null);
  if (!cur || cur.envFingerprint !== fp) {
    // Premier démarrage, ou ACCESS_CODE modifié dans .env : le code du .env (ré)initialise l'accès.
    const salt = crypto.randomBytes(16).toString('hex');
    AUTH = { salt, hash: scryptHash(CONF.accessCode, salt), envFingerprint: fp,
             version: ((cur && cur.version) || 0) + 1, source: 'env', updatedAt: new Date().toISOString() };
    await writeAtomic(AUTH_FILE, JSON.stringify(AUTH, null, 1));
    log(cur ? 'Code d\'accès réinitialisé depuis .env (ACCESS_CODE modifié).' : 'Code d\'accès initialisé depuis .env.');
  } else {
    AUTH = cur;
  }
}

function verifyCode(code) {
  const h = Buffer.from(scryptHash(String(code || '').trim(), AUTH.salt), 'hex');
  const ref = Buffer.from(AUTH.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}

async function setCode(code) {
  const salt = crypto.randomBytes(16).toString('hex');
  AUTH = { ...AUTH, salt, hash: scryptHash(code, salt), version: AUTH.version + 1, source: 'app', updatedAt: new Date().toISOString() };
  await writeAtomic(AUTH_FILE, JSON.stringify(AUTH, null, 1));
}

// ---------------------------------------------------------------------
//  Sessions (jeton signé HMAC dans un cookie HttpOnly)
// ---------------------------------------------------------------------
const COOKIE = 'edl_session';
const b64u = b => Buffer.from(b).toString('base64url');

function signSession(remember) {
  const now = Date.now();
  const ttl = remember ? CONF.sessionDays * 864e5 : 864e5; // 1 jour sans « rester connecté »
  const payload = b64u(JSON.stringify({ v: AUTH.version, iat: now, exp: now + ttl, sid: crypto.randomBytes(9).toString('base64url') }));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, maxAge: remember ? Math.round(ttl / 1000) : null };
}

function readSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest();
  let got;
  try { got = Buffer.from(sig, 'base64url'); } catch (e) { return null; }
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (s.v !== AUTH.version || !s.exp || s.exp < Date.now()) return null;
    return s;
  } catch (e) { return null; }
}

function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, s) {
  const parts = [`${COOKIE}=${s.token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (s.maxAge) parts.push(`Max-Age=${s.maxAge}`);
  if (CONF.https) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${CONF.https ? '; Secure' : ''}`);
}

// ---------------------------------------------------------------------
//  Limitation des tentatives de connexion (par adresse IP)
// ---------------------------------------------------------------------
const attempts = new Map(); // ip → { fails, until }
function clientIp(req) {
  if (CONF.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function lockedFor(ip) {
  const a = attempts.get(ip);
  if (!a || !a.until) return 0;
  const left = a.until - Date.now();
  if (left <= 0) { attempts.delete(ip); return 0; }
  return left;
}
function registerFail(ip) {
  const a = attempts.get(ip) || { fails: 0, until: 0 };
  a.fails++;
  if (a.fails >= CONF.maxAttempts) { a.until = Date.now() + CONF.lockMinutes * 60e3; a.fails = 0; log(`Trop d'essais de code depuis ${ip} : blocage ${CONF.lockMinutes} min.`); }
  attempts.set(ip, a);
}

// ---------------------------------------------------------------------
//  HTTP : petits utilitaires
// ---------------------------------------------------------------------
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len && len > limitBytes) { reject(new HttpError(413, 'Fichier trop volumineux')); req.resume(); return; }
    const chunks = []; let size = 0; let done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limitBytes) { done = true; reject(new HttpError(413, 'Fichier trop volumineux')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}
async function readJsonBody(req, limitBytes) {
  const buf = await readBody(req, limitBytes || 8 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw new HttpError(400, 'JSON invalide'); }
}

const isJpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPdf = b => b.length > 4 && b.slice(0, 5).toString('latin1') === '%PDF-';

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}

// ---------------------------------------------------------------------
//  Dossiers
// ---------------------------------------------------------------------
const dossierDir = id => path.join(DIRS.dossiers, id);
const dossierFile = id => path.join(dossierDir(id), 'dossier.json');
const photosDir = id => path.join(dossierDir(id), 'photos');

function photoHolders(d) {
  const out = [];
  (d.pieces || []).forEach(p => (p.lignes || []).forEach(l => {
    out.push(l);
    (Array.isArray(l.defauts) ? l.defauts : []).forEach(df => { if (df && typeof df === 'object') out.push(df); });
  }));
  (d.compteurs || []).forEach(m => out.push(m));
  (Array.isArray(d.cles) ? d.cles : []).forEach(k => { if (k && typeof k === 'object') out.push(k); });
  return out;
}

/* Le serveur ne conserve que des références de photos (jamais de données d'image dans le JSON). */
function sanitizeDossier(d) {
  photoHolders(d).forEach(h => {
    if (!Array.isArray(h.photos)) { h.photos = []; return; }
    h.photos = h.photos.filter(p => p && ID_RE.test(String(p.id))).map(p => ({
      id: String(p.id), name: String(p.name || '').slice(0, 160), w: Number(p.w) || null, h: Number(p.h) || null,
      addedAt: p.addedAt || null, source: p.source || undefined
    }));
  });
  delete d.github; delete d.signatures; delete d.server;
  return d;
}

function summary(d) {
  let nbPhotos = 0;
  photoHolders(d).forEach(h => { nbPhotos += (h.photos || []).length; });
  return { id: d.id, adresse: d.adresse || '', complement: d.complement || '', type: d.type, date: d.date || '',
           updatedAt: d.updatedAt || null, savedAt: d.savedAt || null, rev: d.rev || 0,
           nbPieces: (d.pieces || []).length, nbPhotos };
}

async function listDossiers() {
  await ensureDir(DIRS.dossiers);
  const ids = (await fsp.readdir(DIRS.dossiers, { withFileTypes: true })).filter(e => e.isDirectory() && ID_RE.test(e.name)).map(e => e.name);
  const out = [];
  for (const id of ids) {
    const d = await readJson(dossierFile(id), null).catch(() => null);
    if (d) out.push(summary(d));
  }
  return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function saveDossier(id, body) {
  return withLock(id, async () => {
    const d = body && body.dossier;
    if (!d || typeof d !== 'object' || !Array.isArray(d.pieces)) throw new HttpError(400, 'Dossier invalide');
    if (d.id !== id) throw new HttpError(400, 'Identifiant incohérent');
    const cur = await readJson(dossierFile(id), null);
    const curRev = cur ? (cur.rev || 0) : 0;
    if (cur && !body.force && Number(body.baseRev || 0) !== curRev) {
      throw new HttpError(409, 'Ce dossier a été modifié depuis un autre appareil.', { rev: curRev, updatedAt: cur.updatedAt });
    }
    const clean = sanitizeDossier(JSON.parse(JSON.stringify(d)));
    clean.rev = curRev + 1;
    clean.savedAt = new Date().toISOString();
    if (cur) await keepHistory(id, cur);
    await writeAtomic(dossierFile(id), JSON.stringify(clean, null, 1));
    gcPhotos(id, clean).catch(e => log('Nettoyage photos :', e.message));
    return clean;
  });
}

/* Conserve les N dernières versions du JSON (filet de sécurité en cas d'erreur de saisie / d'écrasement). */
async function keepHistory(id, cur) {
  const dir = path.join(dossierDir(id), 'historique');
  await ensureDir(dir);
  await fsp.writeFile(path.join(dir, `rev-${String(cur.rev || 0).padStart(5, '0')}.json`), JSON.stringify(cur));
  const files = (await fsp.readdir(dir)).filter(f => /^rev-\d+\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - CONF.historyKeep))) await fsp.unlink(path.join(dir, f)).catch(() => {});
}

/* Supprime les fichiers photo qui ne sont plus référencés depuis plus de 24 h. */
async function gcPhotos(id, d) {
  const dir = photosDir(id);
  if (!(await exists(dir))) return;
  const used = new Set();
  photoHolders(d).forEach(h => (h.photos || []).forEach(p => used.add(p.id)));
  const limit = Date.now() - 24 * 3600e3;
  for (const f of await fsp.readdir(dir)) {
    const m = /^([A-Za-z0-9]+)(_t)?\.jpg$/.exec(f);
    if (!m || used.has(m[1])) continue;
    const st = await fsp.stat(path.join(dir, f)).catch(() => null);
    if (st && st.mtimeMs < limit) await fsp.unlink(path.join(dir, f)).catch(() => {});
  }
}

async function trashDossier(id) {
  return withLock(id, async () => {
    if (!(await exists(dossierDir(id)))) throw new HttpError(404, 'Dossier introuvable');
    await ensureDir(DIRS.trash);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.rename(dossierDir(id), path.join(DIRS.trash, `${id}--${stamp}`));
  });
}

async function purgeTrash() {
  if (!(await exists(DIRS.trash))) return;
  const limit = Date.now() - CONF.trashDays * 864e5;
  for (const e of await fsp.readdir(DIRS.trash, { withFileTypes: true })) {
    const p = path.join(DIRS.trash, e.name);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < limit) { await fsp.rm(p, { recursive: true, force: true }); log('Corbeille : suppression définitive de', e.name); }
  }
}

async function savePhoto(id, pid, thumb, buf) {
  if (!isJpeg(buf)) throw new HttpError(415, 'Seules les images JPEG sont acceptées');
  await ensureDir(photosDir(id));
  await writeAtomic(path.join(photosDir(id), `${pid}${thumb ? '_t' : ''}.jpg`), buf);
}

function safePdfName(n) {
  const base = String(n || 'etat-des-lieux.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'etat-des-lieux.pdf';
  return /\.pdf$/i.test(base) ? base : base + '.pdf';
}

// ---------------------------------------------------------------------
//  Relais « téléphone appareil photo » (Server-Sent Events)
// ---------------------------------------------------------------------
const pairings = new Map(); // token → pairing

function newPairing() {
  const token = crypto.randomBytes(24).toString('base64url');
  const p = { token, created: Date.now(), lastSeen: Date.now(), hosts: new Set(), phones: new Set(),
              current: null, reqs: new Map(), events: [], nextId: 1, title: '' };
  pairings.set(token, p);
  return p;
}

function sseOpen(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
                       'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* ignore */ } }, 20000);
  req.on('close', () => clearInterval(hb));
}
function sseSend(res, event, data, id) {
  try { res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* client parti */ }
}
/* Événements vers le PC : numérotés et conservés pour être rejoués après une coupure. */
function toHosts(p, event, data) {
  const id = p.nextId++;
  p.events.push({ id, event, data });
  if (p.events.length > 300) p.events.splice(0, p.events.length - 300);
  p.hosts.forEach(res => sseSend(res, event, data, id));
}
function toPhones(p, event, data) { p.phones.forEach(res => sseSend(res, event, data)); }
function phoneState(p) { return { phones: p.phones.size }; }

function getPairing(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  return pairings.get(token) || null;
}

setInterval(() => {
  const now = Date.now();
  pairings.forEach((p, t) => {
    if (p.hosts.size) p.lastSeen = now;
    if (now - p.lastSeen > 12 * 3600e3) { toPhones(p, 'bye', {}); p.phones.forEach(r => r.end()); pairings.delete(t); }
    p.reqs.forEach((r, k) => { if (now - r.ts > 6 * 3600e3) p.reqs.delete(k); });
  });
}, 60e3).unref();

// ---------------------------------------------------------------------
//  Routes
// ---------------------------------------------------------------------
const MB = 1024 * 1024;

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = clientIp(req);

  // Protection CSRF : toute requête qui modifie quelque chose doit porter l'en-tête X-EDL
  // (impossible à ajouter depuis un autre site sans autorisation CORS, que nous ne donnons pas).
  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-edl'] !== '1') throw new HttpError(403, 'Requête refusée');

  // ---------- public ----------
  if (p === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION });
  if (p === '/api/config' && m === 'GET') {
    return sendJson(res, 200, { title: CONF.title, version: VERSION, publicUrl: CONF.publicUrl || null,
      authenticated: !!readSession(req), defaultCode: AUTH.source === 'env' && CONF.accessCode === '1234' });
  }
  if (p === '/api/login' && m === 'POST') {
    const left = lockedFor(ip);
    if (left) throw new HttpError(429, `Trop de tentatives. Réessayez dans ${Math.ceil(left / 60000)} min.`);
    const body = await readJsonBody(req, 4096);
    if (verifyCode(body.code)) {
      attempts.delete(ip);
      setSessionCookie(res, signSession(!!body.remember));
      return sendJson(res, 200, { ok: true });
    }
    registerFail(ip);
    await new Promise(r => setTimeout(r, 600));
    const l2 = lockedFor(ip);
    if (l2) throw new HttpError(429, `Trop de tentatives. Réessayez dans ${Math.ceil(l2 / 60000)} min.`);
    throw new HttpError(401, 'Code incorrect');
  }
  if (p === '/api/logout' && m === 'POST') { clearSessionCookie(res); return sendJson(res, 200, { ok: true }); }

  // ---------- page « Appareil photo » du téléphone (accès par jeton de jumelage) ----------
  let r;
  if ((r = /^\/api\/remote\/p\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(p))) {
    const pair = getPairing(r[1]);
    const sub = r[2] || '';
    if (!pair) throw new HttpError(404, 'Lien de jumelage invalide ou expiré');
    if (sub === '/check' && m === 'GET') return sendJson(res, 200, { ok: true, title: pair.title || '' });
    if (sub === '/events' && m === 'GET') {
      sseOpen(req, res);
      pair.phones.add(res);
      sseSend(res, 'welcome', { title: pair.title || '', appTitle: CONF.title });
      if (pair.current) sseSend(res, 'request', pair.current);
      toHosts(pair, 'phone', phoneState(pair));
      req.on('close', () => { pair.phones.delete(res); toHosts(pair, 'phone', phoneState(pair)); });
      return;
    }
    let s;
    if ((s = /^\/photo\/([A-Za-z0-9]{4,40})$/.exec(sub)) && m === 'PUT') {
      const reqId = url.searchParams.get('req') || '';
      const rq = pair.reqs.get(reqId);
      if (!rq) throw new HttpError(410, 'Demande terminée ou inconnue');
      const thumb = url.searchParams.get('thumb') === '1';
      const buf = await readBody(req, CONF.maxUploadMb * MB);
      await savePhoto(rq.dossierId, s[1], thumb, buf);
      if (!thumb) {
        toHosts(pair, 'photo', { req: reqId, pid: s[1], dossierId: rq.dossierId, target: rq.target, label: rq.label,
          w: Number(url.searchParams.get('w')) || null, h: Number(url.searchParams.get('h')) || null,
          name: String(url.searchParams.get('name') || '').slice(0, 160) });
      }
      return sendJson(res, 200, { ok: true });
    }
    if (sub === '/done' && m === 'POST') {
      const body = await readJsonBody(req, 4096);
      if (pair.current && pair.current.req === body.req) pair.current = null;
      toHosts(pair, 'done', { req: String(body.req || '') });
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, 'Introuvable');
  }

  // ---------- tout le reste exige une session ----------
  const session = readSession(req);
  if (!session) throw new HttpError(401, 'Session expirée, reconnectez-vous');

  if (p === '/api/me' && m === 'GET') return sendJson(res, 200, { ok: true, codeSource: AUTH.source, codeUpdatedAt: AUTH.updatedAt });

  if (p === '/api/code' && m === 'POST') {
    const body = await readJsonBody(req, 4096);
    if (!verifyCode(body.current)) { registerFail(ip); throw new HttpError(403, 'Code actuel incorrect'); }
    const next = String(body.next || '').trim();
    if (next.length < 4) throw new HttpError(400, 'Le nouveau code doit contenir au moins 4 caractères');
    await setCode(next);
    setSessionCookie(res, signSession(true)); // les autres appareils devront se reconnecter
    log('Code d\'accès modifié depuis l\'application.');
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/dossiers' && m === 'GET') return sendJson(res, 200, { dossiers: await listDossiers() });

  if ((r = /^\/api\/dossiers\/([A-Za-z0-9]{4,40})(\/.*)?$/.exec(p))) {
    const id = r[1];
    const sub = r[2] || '';
    if (sub === '' && m === 'GET') {
      const d = await readJson(dossierFile(id), null);
      if (!d) throw new HttpError(404, 'Dossier introuvable');
      return sendJson(res, 200, { dossier: d });
    }
    if (sub === '' && m === 'PUT') {
      const body = await readJsonBody(req, 16 * MB);
      const saved = await saveDossier(id, body);
      return sendJson(res, 200, { ok: true, rev: saved.rev, savedAt: saved.savedAt });
    }
    if (sub === '' && m === 'DELETE') { await trashDossier(id); return sendJson(res, 200, { ok: true }); }

    let s;
    if ((s = /^\/photos\/([A-Za-z0-9]{4,40})$/.exec(sub))) {
      const pid = s[1];
      const thumb = url.searchParams.get('thumb') === '1';
      if (m === 'PUT') {
        const buf = await readBody(req, CONF.maxUploadMb * MB);
        await savePhoto(id, pid, thumb, buf);
        return sendJson(res, 200, { ok: true });
      }
      if (m === 'GET') {
        let f = path.join(photosDir(id), `${pid}${thumb ? '_t' : ''}.jpg`);
        if (thumb && !(await exists(f))) f = path.join(photosDir(id), `${pid}.jpg`);
        const st = await fsp.stat(f).catch(() => null);
        if (!st) throw new HttpError(404, 'Photo introuvable');
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    if (sub === '/copy-photos' && m === 'POST') {
      const body = await readJsonBody(req, 4096);
      const from = String(body.from || '');
      if (!ID_RE.test(from)) throw new HttpError(400, 'Source invalide');
      const src = photosDir(from);
      if (await exists(src)) { await ensureDir(photosDir(id)); await fsp.cp(src, photosDir(id), { recursive: true, force: false, errorOnExist: false }); }
      return sendJson(res, 200, { ok: true });
    }
    if (sub === '/pdf' && m === 'POST') {
      const buf = await readBody(req, 200 * MB);
      if (!isPdf(buf)) throw new HttpError(415, 'PDF invalide');
      const name = safePdfName(url.searchParams.get('name'));
      await writeAtomic(path.join(dossierDir(id), 'pdf', name), buf);
      return sendJson(res, 200, { ok: true, file: `dossiers/${id}/pdf/${name}` });
    }
    throw new HttpError(404, 'Introuvable');
  }

  // ---------- jumelage du téléphone, côté PC / tablette ----------
  if (p === '/api/remote/start' && m === 'POST') {
    const body = await readJsonBody(req, 4096);
    let pair = getPairing(body.token);
    if (!pair) pair = newPairing();
    if (typeof body.title === 'string') pair.title = body.title.slice(0, 200);
    pair.lastSeen = Date.now();
    return sendJson(res, 200, { token: pair.token, publicUrl: CONF.publicUrl || null, phones: pair.phones.size });
  }
  if (p === '/api/remote/host-events' && m === 'GET') {
    const pair = getPairing(url.searchParams.get('token'));
    if (!pair) throw new HttpError(404, 'Jumelage expiré');
    sseOpen(req, res);
    pair.hosts.add(res);
    const last = Number(req.headers['last-event-id'] || url.searchParams.get('last') || 0);
    if (last) pair.events.filter(e => e.id > last).forEach(e => sseSend(res, e.event, e.data, e.id));
    sseSend(res, 'phone', phoneState(pair));
    req.on('close', () => { pair.hosts.delete(res); pair.lastSeen = Date.now(); });
    return;
  }
  if (p.startsWith('/api/remote/') && m === 'POST') {
    const body = await readJsonBody(req, 8192);
    const pair = getPairing(body.token);
    if (!pair) throw new HttpError(404, 'Jumelage expiré');
    pair.lastSeen = Date.now();
    if (p === '/api/remote/request') {
      if (!ID_RE.test(String(body.dossierId || '')) || !/^[A-Za-z0-9]{4,40}$/.test(String(body.req || ''))) throw new HttpError(400, 'Demande invalide');
      const t = body.target && typeof body.target === 'object' ? body.target : {};
      const target = {};
      ['kind', 'pieceId', 'lineId', 'meterId', 'defectId', 'keyId'].forEach(k => { if (typeof t[k] === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t[k])) target[k] = t[k]; });
      const rq = { req: body.req, label: String(body.label || '').slice(0, 200), dossierId: body.dossierId, target, ts: Date.now() };
      pair.reqs.set(rq.req, rq);
      pair.current = { req: rq.req, label: rq.label };
      if (typeof body.title === 'string') pair.title = body.title.slice(0, 200);
      toPhones(pair, 'request', pair.current);
      return sendJson(res, 200, { ok: true, phones: pair.phones.size });
    }
    if (p === '/api/remote/cancel') {
      if (pair.current && pair.current.req === body.req) pair.current = null;
      toPhones(pair, 'cancel', { req: String(body.req || '') });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/remote/title') {
      pair.title = String(body.title || '').slice(0, 200);
      toPhones(pair, 'welcome', { title: pair.title, appTitle: CONF.title });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/remote/stop') {
      toPhones(pair, 'bye', {});
      pair.phones.forEach(x => x.end());
      pair.hosts.forEach(x => x.end());
      pairings.delete(pair.token);
      return sendJson(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Introuvable');
}

// ---------------------------------------------------------------------
//  Fichiers statiques
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(CONF.publicDir, '.' + rel);
  if (!file.startsWith(CONF.publicDir + path.sep)) throw new HttpError(403, 'Interdit');
  let st = await fsp.stat(file).catch(() => null);
  if (!st || !st.isFile()) throw new HttpError(404, 'Introuvable');
  const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
  const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------
//  Serveur
// ---------------------------------------------------------------------
async function onRequest(req, res) {
  securityHeaders(res);
  let url;
  try { url = new URL(req.url, 'http://local'); } catch (e) { res.writeHead(400); res.end(); return; }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
    else throw new HttpError(405, 'Méthode non autorisée');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log('Erreur', req.method, url.pathname, e.stack || e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || 'Erreur', ...(e.extra || {}) });
    else res.end();
  }
}

function tlsOptions() {
  const key = path.join(DIRS.certs, 'key.pem');
  const cert = path.join(DIRS.certs, 'cert.pem');
  const sanFile = path.join(DIRS.certs, 'san.txt');
  const san = ['DNS:localhost', 'IP:127.0.0.1'];
  try { const h = new URL(CONF.publicUrl).hostname; if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) san.push('IP:' + h); else if (h) san.push('DNS:' + h); } catch (e) { /* ignore */ }
  const custom = fs.existsSync(cert) && !fs.existsSync(sanFile); // certificat fourni par l'utilisateur : on n'y touche pas
  const stale = !custom && (!fs.existsSync(sanFile) || fs.readFileSync(sanFile, 'utf8') !== san.join(','));
  if (!fs.existsSync(key) || !fs.existsSync(cert) || stale) {
    fs.mkdirSync(DIRS.certs, { recursive: true });
    log('Génération d\'un certificat auto-signé (' + san.join(', ') + ')…');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650',
      '-subj', '/CN=etat-des-lieux', '-addext', 'subjectAltName=' + san.join(',')], { stdio: 'ignore' });
    fs.writeFileSync(sanFile, san.join(','));
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function main() {
  await initSecurity();
  await ensureDir(DIRS.dossiers);
  await purgeTrash().catch(e => log('Corbeille :', e.message));
  setInterval(() => purgeTrash().catch(() => {}), 12 * 3600e3).unref();

  const server = CONF.https ? https.createServer(tlsOptions(), onRequest) : http.createServer(onRequest);
  server.keepAliveTimeout = 65000;
  server.listen(CONF.port, '0.0.0.0', () => {
    const proto = CONF.https ? 'https' : 'http';
    log(`${CONF.title} v${VERSION} – serveur démarré (${proto}, port interne ${CONF.port}).`);
    log(`Données : ${CONF.dataDir}`);
    if (CONF.publicUrl) log(`Adresse pour le téléphone / la tablette : ${CONF.publicUrl}`);
    else log('PUBLIC_URL non défini : le QR code du téléphone demandera l\'adresse du PC (voir .env).');
    if (CONF.accessCode === '1234' && AUTH.source === 'env') log('ATTENTION : code d\'accès par défaut (1234). Changez ACCESS_CODE dans .env.');
  });
  const stop = () => {
    log('Arrêt du serveur…');
    pairings.forEach(p => { toPhones(p, 'bye', {}); p.phones.forEach(r => r.end()); p.hosts.forEach(r => r.end()); });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// Filet de sécurité : une erreur imprévue est journalisée sans arrêter le serveur.
process.on('unhandledRejection', e => log('Erreur non gérée (ignorée) :', e && e.stack || e));
process.on('uncaughtException', e => log('Exception non gérée (ignorée) :', e && e.stack || e));

main().catch(e => { console.error(e); process.exit(1); });
