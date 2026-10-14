/* Génération du PDF avec jsPDF (A4 portrait). Fonctionne dans le navigateur et sous Node. */
(function () {
  'use strict';

  const NAVY = [31, 58, 95];
  const INK = [30, 36, 48];
  const MUTED = [110, 118, 130];
  const GRID = [205, 212, 220];
  const ZEBRA = [245, 247, 250];
  const ETAT_COLORS = {
    'Neuf': [46, 125, 50], 'Bon état': [67, 160, 71], "État d'usage": [230, 110, 0], 'Mauvais état': [198, 40, 40]
  };
  const FONCTIONNE = { oui: 'Oui', non: 'Non', na: '—' };
  const GRAVITE = { leger: 'Léger', moyen: 'Moyen', important: 'Important' };
  const GRAV_COLORS = { leger: [120, 132, 30], moyen: [230, 110, 0], important: [198, 40, 40] };

  function build(d, jsPDFCtor) {
    const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const W = 210, H = 297, M = 14, CW = W - 2 * M, FOOT = 9;
    let y = M;

    const font = (style, size) => { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size || 10); };
    const lh = size => size * 0.3528 * 1.3;
    const need = h => { if (y + h > H - M - FOOT) { doc.addPage(); y = M; return true; } return false; };
    const splitLines = (str, maxW) => {
      const out = [];
      String(str == null ? '' : str).split(/\r?\n/).forEach(part => {
        const lines = doc.splitTextToSize(part === '' ? ' ' : part, maxW);
        (Array.isArray(lines) ? lines : [lines]).forEach(l => out.push(l));
      });
      return out.length ? out : [' '];
    };

    function paragraph(str, opts) {
      opts = opts || {};
      const size = opts.size || 10;
      font(opts.style || 'normal', size);
      doc.setTextColor(...(opts.color || INK));
      const lines = splitLines(str, opts.width || CW);
      const h = lh(size);
      for (const ln of lines) {
        need(h);
        doc.text(ln, opts.x || M, y, { baseline: 'top' });
        y += h;
      }
      y += opts.after == null ? 1.5 : opts.after;
    }

    function sectionTitle(str) {
      need(38); // évite un titre orphelin en bas de page
      y += 2;
      doc.setFillColor(...NAVY);
      doc.rect(M, y, CW, 8, 'F');
      font('bold', 11);
      doc.setTextColor(255, 255, 255);
      doc.text(String(str).toUpperCase(), M + 3, y + 4, { baseline: 'middle' });
      y += 11;
    }

    function subTitle(str) {
      need(24);
      font('bold', 10);
      doc.setTextColor(...NAVY);
      doc.text(String(str), M, y, { baseline: 'top' });
      y += lh(10) + 1;
    }

    function labelValue(pairs) {
      // deux colonnes de « Libellé : valeur »
      const colW = CW / 2;
      font('normal', 10);
      for (let i = 0; i < pairs.length; i += 2) {
        const row = pairs.slice(i, i + 2);
        const cells = row.map(([label, value]) => {
          const valLines = splitLines(value || '—', colW - 4 - 32);
          return { label, valLines };
        });
        const h = Math.max(...cells.map(c => c.valLines.length)) * lh(10) + 1;
        need(h);
        cells.forEach((c, j) => {
          const x = M + j * colW;
          font('bold', 10); doc.setTextColor(...MUTED);
          doc.text(c.label + ' :', x, y, { baseline: 'top' });
          font('normal', 10); doc.setTextColor(...INK);
          doc.text(c.valLines, x + 32, y, { baseline: 'top' });
        });
        y += h;
      }
      y += 2;
    }

    function imageProps(p) {
      if (p.w && p.h) return { width: p.w, height: p.h };
      try { const pr = doc.getImageProperties(p.dataUrl); return { width: pr.width, height: pr.height }; }
      catch (e) { return { width: 4, height: 3 }; }
    }

    function photoGrid(photos, caption) {
      if (!photos || !photos.length) return;
      const gap = 2, perRow = 4;
      const bw = (CW - gap * (perRow - 1)) / perRow, bh = 36;
      if (caption) {
        need(lh(8) + bh + gap);
        font('italic', 8); doc.setTextColor(...MUTED);
        doc.text(caption, M, y, { baseline: 'top' });
        y += lh(8);
      }
      for (let i = 0; i < photos.length; i += perRow) {
        need(bh + gap);
        photos.slice(i, i + perRow).forEach((p, j) => {
          const x = M + j * (bw + gap);
          doc.setDrawColor(...GRID);
          doc.rect(x, y, bw, bh);
          if (!p.dataUrl) return;
          const pr = imageProps(p);
          const s = Math.min((bw - 1) / pr.width, (bh - 1) / pr.height);
          const dw = pr.width * s, dh = pr.height * s;
          const fmt = /^data:image\/png/i.test(p.dataUrl) ? 'PNG' : 'JPEG';
          try { doc.addImage(p.dataUrl, fmt, x + (bw - dw) / 2, y + (bh - dh) / 2, dw, dh, undefined, 'FAST'); }
          catch (e) { font('normal', 7); doc.setTextColor(...MUTED); doc.text('photo illisible', x + 2, y + bh / 2, { baseline: 'middle' }); }
        });
        y += bh + gap;
      }
      y += 1;
    }

    /* cols : [{title, w}]   rows : [{cells:[string | {text,color,bold}], photos, photoCaption}] */
    function table(cols, rows) {
      const headerH = 7, pad = 1.6, size = 9, lhr = lh(size);
      const drawHeader = () => {
        need(headerH + lhr);
        doc.setFillColor(...NAVY);
        doc.rect(M, y, CW, headerH, 'F');
        font('bold', 9); doc.setTextColor(255, 255, 255);
        let x = M;
        cols.forEach(c => { doc.text(c.title, x + pad, y + headerH / 2, { baseline: 'middle' }); x += c.w; });
        y += headerH;
      };
      drawHeader();
      rows.forEach((row, ri) => {
        const cells = row.cells.map((cell, i) => {
          const obj = (cell && typeof cell === 'object') ? cell : { text: cell };
          font(obj.bold ? 'bold' : 'normal', size);
          return { ...obj, lines: splitLines(obj.text == null ? '' : obj.text, cols[i].w - 2 * pad) };
        });
        const rowH = Math.max(...cells.map(c => c.lines.length)) * lhr + 2 * pad;
        if (need(rowH)) drawHeader();
        if (ri % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(M, y, CW, rowH, 'F'); }
        doc.setDrawColor(...GRID);
        let x = M;
        cells.forEach((c, i) => {
          doc.rect(x, y, cols[i].w, rowH);
          font(c.bold ? 'bold' : 'normal', size);
          doc.setTextColor(...(c.color || INK));
          doc.text(c.lines, x + pad, y + pad, { baseline: 'top' });
          x += cols[i].w;
        });
        y += rowH;
        if (row.photos && row.photos.length) { y += 1; photoGrid(row.photos, row.photoCaption); }
        (row.photoGroups || []).forEach(g => { if (g.photos && g.photos.length) { y += 1; photoGrid(g.photos, g.caption); } });
      });
      y += 3;
    }

    const etatCell = e => e ? { text: e, color: ETAT_COLORS[e] || INK, bold: true } : { text: '—', color: MUTED };

    // ---------- En-tête ----------
    const titre = d.type === 'sortie' ? "ÉTAT DES LIEUX DE SORTIE" : "ÉTAT DES LIEUX D'ENTRÉE";
    font('bold', 18); doc.setTextColor(...NAVY);
    doc.text(titre, M, y, { baseline: 'top' });
    y += 9;
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); doc.setLineWidth(0.2);
    y += 4;
    font('normal', 9); doc.setTextColor(...MUTED);
    doc.text(`Établi le ${U_fmtDate(d.date)}${d.meuble ? ' · Logement meublé' : ' · Logement non meublé'}`, M, y, { baseline: 'top' });
    y += 7;

    labelValue([
      ['Adresse', [d.adresse, d.complement].filter(Boolean).join('\n')],
      ['Date', U_fmtDate(d.date)],
      ['Bailleur', d.bailleur],
      ['Locataire(s)', d.locataire]
    ]);
    if (d.remarques) { subTitle('Remarques générales'); paragraph(d.remarques); }

    // ---------- Compteurs ----------
    if (d.compteurs && d.compteurs.length) {
      sectionTitle('Compteurs');
      table(
        [{ title: 'Compteur', w: 34 }, { title: 'N° / PDL / PCE', w: 40 }, { title: 'Relevés', w: 52 }, { title: 'Remarques', w: CW - 126 }],
        d.compteurs.map(m => ({
          cells: [{ text: m.type || '—', bold: true }, m.numero || '—',
                  (m.index || []).map(ix => `${ix.label || 'Index'} : ${ix.value || '—'}`).join('\n') || '—',
                  m.remarques || ''],
          photos: m.photos, photoCaption: `Photos – ${m.type || 'compteur'}`
        }))
      );
    }

    // ---------- Clés ----------
    const cles = (d.cles || []).filter(k => k.type || k.nombre || (k.photos || []).length);
    if (cles.length) {
      sectionTitle('Clés remises');
      table([{ title: 'Type', w: CW - 30 }, { title: 'Nombre', w: 30 }],
        cles.map(k => ({ cells: [k.type || '—', k.nombre || '—'], photos: k.photos, photoCaption: `Photos – ${k.type || 'clés'}` })));
    }

    // ---------- Pièces ----------
    (d.pieces || []).forEach(p => {
      sectionTitle(`Pièce : ${p.nom || 'Pièce'}`);
      const cols = [{ title: 'Élément', w: 46 }, { title: 'État', w: 28 }, { title: 'Fonctionne', w: 22 }, { title: 'Remarques', w: CW - 96 }];
      const toRow = l => {
        const defs = (l.defauts || []);
        const defTxt = defs.map(df => `• ${df.type}${df.gravite ? ' (' + (GRAVITE[df.gravite] || df.gravite) + ')' : ''}${df.precision ? ' : ' + df.precision : ''}${df.photos && df.photos.length ? ` [${df.photos.length} photo${df.photos.length > 1 ? 's' : ''}]` : ''}`).join('\n');
        const rem = [l.remarques || '', defs.length ? `Défauts constatés :\n${defTxt}` : ''].filter(Boolean).join('\n');
        return {
          cells: [{ text: l.nom || '—', bold: true }, etatCell(l.etat), FONCTIONNE[l.fonctionne] || '—', rem],
          photos: l.photos, photoCaption: `Photos – ${l.nom || 'élément'}`,
          photoGroups: defs.map(df => ({ photos: df.photos, caption: `Défaut – ${l.nom || 'élément'} : ${df.type}${df.precision ? ' (' + df.precision + ')' : ''}` }))
        };
      };
      const els = (p.lignes || []).filter(l => l.cat !== 'meuble');
      const meubles = (p.lignes || []).filter(l => l.cat === 'meuble');
      if (els.length) { subTitle('Éléments de la pièce'); table(cols, els.map(toRow)); }
      if (meubles.length) { subTitle('Meubles & équipements'); table(cols, meubles.map(toRow)); }
      if (!els.length && !meubles.length) paragraph('Aucune ligne.', { color: MUTED });
      if (p.remarques) { subTitle('Remarques sur la pièce'); paragraph(p.remarques); }
    });

    // ---------- Récapitulatif des défauts ----------
    const recap = [];
    (d.pieces || []).forEach(p => (p.lignes || []).forEach(l => (l.defauts || []).forEach(df => recap.push({ p, l, df }))));
    if (recap.length) {
      sectionTitle(`Récapitulatif des défauts constatés (${recap.length})`);
      table(
        [{ title: 'Pièce', w: 32 }, { title: 'Élément', w: 36 }, { title: 'Défaut', w: 34 }, { title: 'Gravité', w: 22 }, { title: 'Précision', w: CW - 140 }, { title: 'Photos', w: 16 }],
        recap.map(({ p, l, df }) => ({ cells: [p.nom || '—', { text: l.nom || '—', bold: true }, { text: df.type, bold: true },
          df.gravite ? { text: GRAVITE[df.gravite] || df.gravite, color: GRAV_COLORS[df.gravite] || INK, bold: true } : { text: '—', color: MUTED },
          df.precision || '', String((df.photos || []).length)] }))
      );
    }

    // ---------- Pied de page ----------
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      font('normal', 8); doc.setTextColor(...MUTED);
      doc.setDrawColor(...GRID);
      doc.line(M, H - M - 4, W - M, H - M - 4);
      const left = `${titre.charAt(0) + titre.slice(1).toLowerCase()} – ${d.adresse || ''}`;
      doc.text(left.length > 95 ? left.slice(0, 92) + '…' : left, M, H - M, { baseline: 'bottom' });
      doc.text(`Page ${i} / ${n}`, W - M, H - M, { baseline: 'bottom', align: 'right' });
    }
    return doc;
  }

  function U_fmtDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
  }

  function fileName(d) {
    const slug = String(d.adresse || 'logement').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'logement';
    return `EDL-${d.type === 'sortie' ? 'sortie' : 'entree'}-${slug}-${d.date || ''}.pdf`;
  }

  const api = { build, fileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.EdlPdf = api;
})();
