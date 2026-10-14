/* Mode d'affichage : détection automatique ou choix manuel (mémorisé sur l'appareil).
   Pose sur <html> :
     data-layout = phone | tablet-portrait | tablet-landscape | desktop
     data-touch  = 1 (grandes zones tactiles) | 0 (souris, plus compact)
     data-text   = normal | large | xlarge
   Chargé dans <head> pour appliquer la mise en page avant le premier affichage. */
(function () {
  'use strict';
  const KEY_MODE = 'edl.display';
  const KEY_TEXT = 'edl.textSize';

  const MODES = [
    { id: 'auto', label: 'Automatique', desc: "S'adapte à l'écran et à l'orientation" },
    { id: 'phone', label: 'Téléphone', desc: 'Une colonne, onglets en haut' },
    { id: 'tablet-portrait', label: 'Tablette verticale', desc: 'Une colonne large, grandes zones tactiles' },
    { id: 'tablet-landscape', label: 'Tablette horizontale / PC tactile', desc: 'Pièces à gauche, lignes sur 2 colonnes, grandes zones tactiles' },
    { id: 'desktop', label: 'PC (souris)', desc: 'Pièces à gauche, lignes sur 2 colonnes, affichage compact' }
  ];
  const TEXTS = [
    { id: 'normal', label: 'Normal' },
    { id: 'large', label: 'Grand' },
    { id: 'xlarge', label: 'Très grand' }
  ];

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }

  function mq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function isCoarse() {
    return mq('(pointer: coarse)') || mq('(any-pointer: coarse)') || (navigator.maxTouchPoints || 0) > 0;
  }
  function hasFinePointer() { return mq('(pointer: fine)'); }

  function detect() {
    const w = window.innerWidth || document.documentElement.clientWidth || 1024;
    const h = window.innerHeight || document.documentElement.clientHeight || 768;
    if (w < 600 || h < 480) return 'phone'; // téléphone, y compris à l'horizontale
    if (h > w) return 'tablet-portrait';
    if (w < 900) return 'tablet-portrait';
    if (isCoarse() && !hasFinePointer()) return 'tablet-landscape';
    if (isCoarse()) return 'tablet-landscape'; // PC tactile (écran tactile + souris)
    return 'desktop';
  }

  function getMode() {
    const m = read(KEY_MODE);
    return MODES.some(x => x.id === m) ? m : 'auto';
  }
  function getText() {
    const t = read(KEY_TEXT);
    return TEXTS.some(x => x.id === t) ? t : 'normal';
  }
  function resolved() {
    const m = getMode();
    return m === 'auto' ? detect() : m;
  }

  let last = '';
  function apply() {
    const layout = resolved();
    const touch = layout === 'desktop' ? '0' : '1';
    const text = getText();
    const el = document.documentElement;
    el.setAttribute('data-layout', layout);
    el.setAttribute('data-touch', touch);
    el.setAttribute('data-text', text);
    el.setAttribute('data-display-mode', getMode());
    const sig = layout + touch + text;
    if (sig !== last) {
      const changed = last !== '';
      last = sig;
      if (changed) { try { window.dispatchEvent(new CustomEvent('edl:layout', { detail: { layout, touch, text } })); } catch (e) { /* ignore */ } }
    }
    return layout;
  }

  function setMode(m) { write(KEY_MODE, MODES.some(x => x.id === m) ? m : 'auto'); return apply(); }
  function setText(t) { write(KEY_TEXT, TEXTS.some(x => x.id === t) ? t : 'normal'); return apply(); }
  function label(id) { const m = MODES.find(x => x.id === id); return m ? m.label : id; }

  let timer;
  function onResize() { clearTimeout(timer); timer = setTimeout(apply, 120); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  apply();

  window.Display = { MODES, TEXTS, getMode, getText, setMode, setText, resolved, detect, apply, label };
})();
