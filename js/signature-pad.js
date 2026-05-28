/**
 * SignaturePad — canvas pro kreslení podpisu.
 * - Pointer events (myš i dotyk i pero)
 * - Respektuje devicePixelRatio, aby čára nebyla rozmazaná
 * - Vyrenderuje výsledek na PNG s průhledným pozadím (trim okolí)
 */
(function (global) {
  'use strict';

  class SignaturePad {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.color = opts.color || '#0a0a0a';
      this.lineWidth = opts.lineWidth || 2.5;
      this.isDrawing = false;
      this.hasContent = false;
      this.lastX = 0;
      this.lastY = 0;
      this.dpr = Math.max(1, window.devicePixelRatio || 1);

      this._resize();
      this._bind();

      // re-fit if container resizes
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(canvas);
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Save existing drawing
      const prev = this.hasContent ? this.canvas.toDataURL('image/png') : null;

      this.canvas.width = Math.round(rect.width * this.dpr);
      this.canvas.height = Math.round(rect.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._applyStrokeStyle();

      if (prev) {
        const img = new Image();
        img.onload = () => {
          this.ctx.drawImage(img, 0, 0, rect.width, rect.height);
        };
        img.src = prev;
      }
    }

    _applyStrokeStyle() {
      this.ctx.strokeStyle = this.color;
      this.ctx.lineWidth = this.lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    }

    _bind() {
      const onDown = (e) => {
        e.preventDefault();
        this.canvas.setPointerCapture?.(e.pointerId);
        this.isDrawing = true;
        const p = this._pos(e);
        this.lastX = p.x;
        this.lastY = p.y;
        // Draw a small dot for taps
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, this.lineWidth / 2, 0, Math.PI * 2);
        this.ctx.fillStyle = this.color;
        this.ctx.fill();
        this.hasContent = true;
      };
      const onMove = (e) => {
        if (!this.isDrawing) return;
        e.preventDefault();
        const p = this._pos(e);
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
        this.lastX = p.x;
        this.lastY = p.y;
      };
      const onUp = (e) => {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        try { this.canvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
      };

      this.canvas.addEventListener('pointerdown', onDown);
      this.canvas.addEventListener('pointermove', onMove);
      this.canvas.addEventListener('pointerup', onUp);
      this.canvas.addEventListener('pointercancel', onUp);
      this.canvas.addEventListener('pointerleave', onUp);
    }

    _pos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    setColor(color) {
      this.color = color;
      this._applyStrokeStyle();
    }

    setLineWidth(w) {
      this.lineWidth = w;
      this._applyStrokeStyle();
    }

    clear() {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._applyStrokeStyle();
      this.hasContent = false;
    }

    isEmpty() {
      return !this.hasContent;
    }

    /**
     * Vrátí PNG dataURL s podpisem oříznutým na bounding box obsahu.
     * Pozadí zůstává průhledné.
     */
    toTrimmedDataURL() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const data = this.ctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = data[(y * w + x) * 4 + 3];
          if (a > 8) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return null;
      const pad = Math.round(4 * this.dpr);
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(w - 1, maxX + pad);
      maxY = Math.min(h - 1, maxY + pad);
      const outW = maxX - minX + 1;
      const outH = maxY - minY + 1;
      const tmp = document.createElement('canvas');
      tmp.width = outW;
      tmp.height = outH;
      tmp.getContext('2d').drawImage(this.canvas, minX, minY, outW, outH, 0, 0, outW, outH);
      return tmp.toDataURL('image/png');
    }
  }

  global.SignaturePad = SignaturePad;
})(window);
