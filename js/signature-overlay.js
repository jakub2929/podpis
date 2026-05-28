/**
 * SignatureOverlay — instance jednoho vloženého podpisu v dokumentu.
 *
 * Vykreslí <div class="sig-box"> s <img> uvnitř, drag a resize přes pointer events.
 * Pozice (left/top/width/height) jsou v CSS pixelech v rámci page-overlay,
 * tj. v souřadnicích aktuálního viewportu PDF.js (počátek vlevo nahoře).
 *
 * Při exportu jsou tyto hodnoty převedeny do PDF bodů přes viewport.convertToPdfPoint().
 */
(function (global) {
  'use strict';

  let _idCounter = 0;
  const activeListeners = new Set();

  // ---- Scroll lock pro dobu draggingu (iOS Safari fix) ----
  // Když se hýbe s podpisem, zamkneme scroll celé stránky.
  // iOS jinak občas přeruší pointer capture a začne scrollovat dokument.
  let _lockCount = 0;
  let _savedScrollY = 0;
  function _lockScroll(on) {
    if (on) {
      _lockCount++;
      if (_lockCount === 1) {
        _savedScrollY = window.scrollY;
        document.body.classList.add('sig-dragging');
        // iOS: position:fixed na body + reset scroll polohy
        document.body.style.top = `-${_savedScrollY}px`;
      }
    } else {
      _lockCount = Math.max(0, _lockCount - 1);
      if (_lockCount === 0) {
        document.body.classList.remove('sig-dragging');
        document.body.style.top = '';
        window.scrollTo(0, _savedScrollY);
      }
    }
  }

  class SignatureOverlay {
    /**
     * @param {Object} opts
     *   - pageEntry  z PdfViewer.pages
     *   - dataUrl    PNG dataURL podpisu (s alfa kanálem)
     *   - intrinsicWidth/intrinsicHeight  rozměry podpisu v px (pro aspect ratio)
     *   - initialWidth  počáteční šířka v CSS pixelech viewportu
     *   - onChange  callback při změně (drag/resize/delete) — předá this
     *   - onActivate callback při kliknutí — předá this
     */
    constructor(opts) {
      this.id = ++_idCounter;
      this.pageEntry = opts.pageEntry;
      this.dataUrl = opts.dataUrl;
      this.intrinsicWidth = opts.intrinsicWidth;
      this.intrinsicHeight = opts.intrinsicHeight;
      this.onChange = opts.onChange || (() => {});
      this.onActivate = opts.onActivate || (() => {});
      this.onDelete = opts.onDelete || (() => {});

      const aspect = this.intrinsicHeight / this.intrinsicWidth;
      const initialW = opts.initialWidth || Math.min(220, this.pageEntry.width * 0.35);
      const initialH = initialW * aspect;

      // center on page
      this.x = (this.pageEntry.width - initialW) / 2;
      this.y = (this.pageEntry.height - initialH) / 2;
      this.w = initialW;
      this.h = initialH;

      this._build();
      this._bind();
    }

    _build() {
      const box = document.createElement('div');
      box.className = 'sig-box';
      box.style.left = `${this.x}px`;
      box.style.top = `${this.y}px`;
      box.style.width = `${this.w}px`;
      box.style.height = `${this.h}px`;

      const img = document.createElement('img');
      img.src = this.dataUrl;
      img.draggable = false;
      box.appendChild(img);

      const handle = document.createElement('div');
      handle.className = 'sig-handle';
      box.appendChild(handle);

      const del = document.createElement('button');
      del.className = 'sig-delete';
      del.type = 'button';
      del.textContent = '×';
      del.title = 'Smazat podpis';
      box.appendChild(del);

      this.el = box;
      this.handleEl = handle;
      this.deleteEl = del;
      this.pageEntry.overlay.appendChild(box);

      // iOS Safari fix: touch-action samotné nestačí, Safari někdy stejně
      // začne scrollovat. Explicitní non-passive touchmove + preventDefault
      // přímo na elementu zruší native gesto. Delete tlačítko vynecháme,
      // ať tap projde normálně.
      const blockTouch = (e) => {
        if (e.target === this.deleteEl) return;
        e.preventDefault();
      };
      box.addEventListener('touchstart', blockTouch, { passive: false });
      box.addEventListener('touchmove', blockTouch, { passive: false });
      handle.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      handle.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    _bind() {
      // Click to activate
      this.el.addEventListener('pointerdown', (e) => {
        if (e.target === this.deleteEl) return;
        this.activate();
      });

      // Drag whole box
      const onDragStart = (e) => {
        if (e.target === this.handleEl || e.target === this.deleteEl) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = this.x;
        const origY = this.y;
        this.el.setPointerCapture(e.pointerId);
        _lockScroll(true);

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let nx = origX + dx;
          let ny = origY + dy;
          // clamp into page
          nx = Math.max(0, Math.min(nx, this.pageEntry.width - this.w));
          ny = Math.max(0, Math.min(ny, this.pageEntry.height - this.h));
          this.x = nx;
          this.y = ny;
          this.el.style.left = `${nx}px`;
          this.el.style.top = `${ny}px`;
        };
        const onUp = (ev) => {
          this.el.removeEventListener('pointermove', onMove);
          this.el.removeEventListener('pointerup', onUp);
          this.el.removeEventListener('pointercancel', onUp);
          try { this.el.releasePointerCapture(ev.pointerId); } catch (_) {}
          _lockScroll(false);
          this.onChange(this);
        };
        this.el.addEventListener('pointermove', onMove);
        this.el.addEventListener('pointerup', onUp);
        this.el.addEventListener('pointercancel', onUp);
      };
      this.el.addEventListener('pointerdown', onDragStart);

      // Resize via corner handle (keep aspect ratio)
      this.handleEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const origW = this.w;
        const origH = this.h;
        const aspect = origH / origW;
        this.handleEl.setPointerCapture(e.pointerId);
        _lockScroll(true);

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          let newW = Math.max(24, origW + dx);
          // clamp width so we don't overflow page
          newW = Math.min(newW, this.pageEntry.width - this.x);
          let newH = newW * aspect;
          if (this.y + newH > this.pageEntry.height) {
            newH = this.pageEntry.height - this.y;
            newW = newH / aspect;
          }
          this.w = newW;
          this.h = newH;
          this.el.style.width = `${newW}px`;
          this.el.style.height = `${newH}px`;
        };
        const onUp = (ev) => {
          this.handleEl.removeEventListener('pointermove', onMove);
          this.handleEl.removeEventListener('pointerup', onUp);
          this.handleEl.removeEventListener('pointercancel', onUp);
          try { this.handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
          _lockScroll(false);
          this.onChange(this);
        };
        this.handleEl.addEventListener('pointermove', onMove);
        this.handleEl.addEventListener('pointerup', onUp);
        this.handleEl.addEventListener('pointercancel', onUp);
      });

      // Delete
      this.deleteEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.destroy();
        this.onDelete(this);
      });
    }

    activate() {
      // deactivate others
      document.querySelectorAll('.sig-box.active').forEach((n) => {
        if (n !== this.el) n.classList.remove('active');
      });
      this.el.classList.add('active');
      this.onActivate(this);
    }

    destroy() {
      this.el.remove();
    }

    /** Souřadnice pro export — předá je exporter dál do convertToPdfPoint */
    getExportRect() {
      return {
        pageIndex: this.pageEntry.pageIndex,
        x: this.x,
        y: this.y,
        width: this.w,
        height: this.h,
        viewport: this.pageEntry.viewport,
        page: this.pageEntry.page,
        dataUrl: this.dataUrl
      };
    }
  }

  // Click outside to deactivate
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    if (!e.target.closest('.sig-box')) {
      document.querySelectorAll('.sig-box.active').forEach((n) => n.classList.remove('active'));
    }
  });

  global.SignatureOverlay = SignatureOverlay;
})(window);
