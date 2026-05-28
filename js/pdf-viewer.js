/**
 * PdfViewer — načte PDF (ArrayBuffer) a renderuje stránky do <canvas>.
 *
 * Pro každou stránku vytvoří wrapper:
 *   <div class="page-wrap" data-page-index="i">
 *     <span class="page-label">Stránka i+1 / N</span>
 *     <canvas></canvas>
 *     <div class="page-overlay"></div>   ← sem se vkládají sig-box overlay divs
 *   </div>
 *
 * Souřadnice:
 *   - Overlay je position:absolute inset:0 nad canvasem → pixely overlaye == CSS pixely renderu
 *   - viewport.convertToPdfPoint(x, y) převede CSS px (na current scale) → PDF body
 */
(function (global) {
  'use strict';

  class PdfViewer {
    constructor(container) {
      this.container = container;
      this.pdfDoc = null;
      this.pages = []; // { pageNumber, page, viewport, canvas, wrap, overlay, baseViewport }
      this.scale = 1.0;
      this.onPageRendered = null; // callback(pageEntry)
    }

    async loadFromArrayBuffer(buffer) {
      // pdf.js needs a copy because it transfers ownership of the buffer
      const copy = buffer.slice(0);
      const loadingTask = pdfjsLib.getDocument({ data: copy });
      this.pdfDoc = await loadingTask.promise;
      await this.renderAll();
      return this.pdfDoc.numPages;
    }

    setScale(scale) {
      this.scale = scale;
    }

    async renderAll() {
      // clear container + state
      this.container.innerHTML = '';
      this.pages = [];

      const numPages = this.pdfDoc.numPages;
      // device pixel ratio for sharp text
      const outputScale = Math.max(1, window.devicePixelRatio || 1);

      for (let i = 1; i <= numPages; i++) {
        const page = await this.pdfDoc.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 }); // 1 PDF point = 1 CSS px at scale 1
        const viewport = page.getViewport({ scale: this.scale });

        const wrap = document.createElement('div');
        wrap.className = 'page-wrap';
        wrap.dataset.pageIndex = String(i - 1);
        wrap.style.width = `${viewport.width}px`;
        wrap.style.height = `${viewport.height}px`;

        const label = document.createElement('span');
        label.className = 'page-label';
        label.textContent = `Stránka ${i} / ${numPages}`;
        wrap.appendChild(label);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        wrap.appendChild(canvas);

        const overlay = document.createElement('div');
        overlay.className = 'page-overlay';
        wrap.appendChild(overlay);

        this.container.appendChild(wrap);

        const ctx = canvas.getContext('2d');
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        await page.render({ canvasContext: ctx, viewport, transform }).promise;

        const entry = {
          pageNumber: i,
          pageIndex: i - 1,
          page,
          viewport,         // viewport at current scale (CSS pixel space)
          baseViewport,     // viewport at scale 1 (PDF point space, but pdf.js still flips Y)
          canvas,
          wrap,
          overlay,
          width: viewport.width,
          height: viewport.height
        };
        this.pages.push(entry);
        if (this.onPageRendered) this.onPageRendered(entry);
      }
    }

    /**
     * Re-render všech stránek při novém zoomu, zachovává overlay divs
     * (jejich pozice/rozměry jsou v CSS pixelech, takže je škálujeme proporcionálně).
     */
    async setScaleAndRerender(newScale) {
      const oldScale = this.scale;
      this.scale = newScale;

      const outputScale = Math.max(1, window.devicePixelRatio || 1);

      for (const entry of this.pages) {
        const newViewport = entry.page.getViewport({ scale: newScale });
        const ratio = newScale / oldScale;

        // resize wrap + canvas
        entry.wrap.style.width = `${newViewport.width}px`;
        entry.wrap.style.height = `${newViewport.height}px`;
        entry.canvas.width = Math.floor(newViewport.width * outputScale);
        entry.canvas.height = Math.floor(newViewport.height * outputScale);
        entry.canvas.style.width = `${newViewport.width}px`;
        entry.canvas.style.height = `${newViewport.height}px`;

        const ctx = entry.canvas.getContext('2d');
        ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
        await entry.page.render({ canvasContext: ctx, viewport: newViewport, transform }).promise;

        entry.viewport = newViewport;
        entry.width = newViewport.width;
        entry.height = newViewport.height;

        // scale existing overlay children
        for (const child of Array.from(entry.overlay.children)) {
          if (!(child instanceof HTMLElement)) continue;
          const left = parseFloat(child.style.left) || 0;
          const top = parseFloat(child.style.top) || 0;
          const w = parseFloat(child.style.width) || 0;
          const h = parseFloat(child.style.height) || 0;
          child.style.left = `${left * ratio}px`;
          child.style.top = `${top * ratio}px`;
          child.style.width = `${w * ratio}px`;
          child.style.height = `${h * ratio}px`;
        }
      }
    }

    getPage(index) {
      return this.pages[index];
    }

    scrollToPage(index) {
      const entry = this.pages[index];
      if (entry) entry.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    destroy() {
      this.container.innerHTML = '';
      this.pages = [];
      this.pdfDoc = null;
    }
  }

  global.PdfViewer = PdfViewer;
})(window);
