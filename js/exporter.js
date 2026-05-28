/**
 * Exporter — vezme původní PDF (ArrayBuffer) a seznam podpisů (overlay rects)
 * a vypíše do něj podpisy pomocí pdf-lib. Vrací Blob hotového souboru.
 *
 * Převod souřadnic:
 *   - Overlay rect je v CSS pixelech viewportu PDF.js (origin vlevo nahoře).
 *   - viewport.convertToPdfPoint(x, y) → [pdfX, pdfY] v PDF bodech (origin vlevo dole),
 *     a správně zohledňuje rotaci stránky.
 *   - Pro správné x/y pdf-libu (vlevo dole) převedeme oba rohy a vezmeme min,
 *     šířku a výšku spočítáme z absolutních rozdílů. Tím přirozeně sedí
 *     i 90° / 270° rotace — protože pdf-lib drawImage při rotaci stránky
 *     stejně mapuje na user-space PDF.
 *   - V tomto v1 nepřidáváme `rotate` parametr — drawImage kreslí v PDF
 *     user-space, který je už správně.
 */
(function (global) {
  'use strict';

  async function _dataUrlToBytes(dataUrl) {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * @param {ArrayBuffer} originalPdfBytes
   * @param {Array} signatures  — pole {pageIndex, x, y, width, height, viewport, dataUrl}
   * @returns {Promise<Blob>}
   */
  async function exportSignedPdf(originalPdfBytes, signatures) {
    const { PDFDocument } = PDFLib;

    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();

    // cache embedded images podle dataUrl (kdyby se stejný podpis použil víckrát)
    const imageCache = new Map();

    for (const sig of signatures) {
      const page = pages[sig.pageIndex];
      if (!page) continue;

      // Embed image (PNG s alfa kanálem)
      let pngImage = imageCache.get(sig.dataUrl);
      if (!pngImage) {
        const bytes = await _dataUrlToBytes(sig.dataUrl);
        pngImage = await pdfDoc.embedPng(bytes);
        imageCache.set(sig.dataUrl, pngImage);
      }

      const vp = sig.viewport;

      // Rohy overlaye v CSS pixelech (viewportu)
      const x1 = sig.x;
      const y1 = sig.y;
      const x2 = sig.x + sig.width;
      const y2 = sig.y + sig.height;

      // Převod do PDF bodů — viewport.convertToPdfPoint zná scale i rotaci stránky
      const [pdfX1, pdfY1] = vp.convertToPdfPoint(x1, y1);
      const [pdfX2, pdfY2] = vp.convertToPdfPoint(x2, y2);

      const pdfX = Math.min(pdfX1, pdfX2);
      const pdfY = Math.min(pdfY1, pdfY2);
      const pdfW = Math.abs(pdfX2 - pdfX1);
      const pdfH = Math.abs(pdfY2 - pdfY1);

      page.drawImage(pngImage, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH
      });
    }

    const out = await pdfDoc.save();
    return new Blob([out], { type: 'application/pdf' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Uloží PDF nejvhodnějším způsobem pro dané zařízení:
   *  - Mobil (iOS Safari / Android Chrome): Web Share API → otevře share sheet
   *    kde uživatel uloží do Files / Disku / pošle dál. iOS Safari ignoruje
   *    download atribut u blob URL a PDF by se otevřelo inline místo stažení,
   *    proto tady share je jediná spolehlivá cesta.
   *  - Desktop: klasický anchor download.
   *
   * Vrací 'shared' | 'downloaded' | 'cancelled'.
   */
  async function saveOrSharePdf(blob, filename) {
    // Web Share API s files je podporované od iOS 16, Android Chrome 75+.
    // canShare s konkrétním File je důležité — některé prohlížeče mají
    // navigator.share, ale neumí sdílet soubory.
    if (typeof File !== 'undefined' && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: filename,
            text: 'Podepsaný dokument'
          });
          return 'shared';
        }
      } catch (err) {
        // Uživatel zrušil share sheet — neukládáme nic dalšího.
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
          return 'cancelled';
        }
        // Jiná chyba (např. iOS Safari v PWA módu) → spadneme do downloadu.
        console.warn('Web Share selhal, padám na download:', err);
      }
    }
    downloadBlob(blob, filename);
    return 'downloaded';
  }

  global.Exporter = { exportSignedPdf, downloadBlob, saveOrSharePdf };
})(window);
