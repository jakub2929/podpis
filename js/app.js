/**
 * App — propojení všeho dohromady:
 *  - upload PDF (drop / file picker)
 *  - viewer
 *  - modal pro vytvoření podpisu (kreslení / nahraný obrázek)
 *  - vkládání podpisů na aktuální / první stránku
 *  - sidebar: thumbs, list, zoom
 *  - export
 */
(function () {
  'use strict';

  const state = {
    fileName: null,
    originalBytes: null,    // ArrayBuffer
    viewer: null,
    signatures: [],         // SignatureOverlay instances
    currentPageIndex: 0,    // pro vložení nového podpisu
    pendingSignatureDataUrl: null,
    scale: 1.0
  };

  // ---- Elements ----
  const els = {
    main: document.getElementById('main'),
    uploadZone: document.getElementById('upload-zone'),
    uploadCard: document.querySelector('.upload-card'),
    fileInput: document.getElementById('file-input'),
    btnPickFile: document.getElementById('btn-pick-file'),
    viewerSection: document.getElementById('viewer-section'),
    pagesContainer: document.getElementById('pages-container'),
    pageThumbs: document.getElementById('page-thumbs'),
    placedList: document.getElementById('placed-list'),
    btnNewSig: document.getElementById('btn-new-signature'),
    btnExport: document.getElementById('btn-export'),
    btnReset: document.getElementById('btn-reset'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    zoomLabel: document.getElementById('zoom-label'),
    // modal
    modal: document.getElementById('sig-modal'),
    sigPadCanvas: document.getElementById('sig-pad'),
    penColor: document.getElementById('pen-color'),
    penWidth: document.getElementById('pen-width'),
    padClear: document.getElementById('pad-clear'),
    sigImageInput: document.getElementById('sig-image-input'),
    sigImagePreview: document.getElementById('sig-image-preview'),
    sigConfirm: document.getElementById('sig-confirm'),
    toast: document.getElementById('toast')
  };

  // ---- Toast ----
  let toastTimer = null;
  function toast(msg, kind = '') {
    els.toast.textContent = msg;
    els.toast.className = 'toast ' + kind;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
  }

  // ---- Upload ----
  function bindUpload() {
    els.btnPickFile.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFile(f);
    });

    ['dragenter', 'dragover'].forEach((evt) =>
      els.uploadCard.addEventListener(evt, (e) => {
        e.preventDefault();
        els.uploadCard.classList.add('drag-over');
      })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      els.uploadCard.addEventListener(evt, (e) => {
        e.preventDefault();
        els.uploadCard.classList.remove('drag-over');
      })
    );
    els.uploadCard.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    // Prevent the page from navigating when a PDF is dropped outside the dropzone
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  async function loadFile(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast('Vyberte prosím soubor PDF', 'error');
      return;
    }
    state.fileName = file.name;
    try {
      const buf = await file.arrayBuffer();
      state.originalBytes = buf;
      await openViewer(buf);
    } catch (err) {
      console.error(err);
      toast('Soubor se nepodařilo načíst: ' + err.message, 'error');
    }
  }

  async function openViewer(buffer) {
    els.uploadZone.classList.add('hidden');
    els.viewerSection.classList.remove('hidden');

    state.viewer = new PdfViewer(els.pagesContainer);
    // copy buffer for viewer (pdf.js transferuje vlastnictví)
    await state.viewer.loadFromArrayBuffer(buffer);

    rebuildThumbs();
    updateButtons();
    trackVisiblePage();
  }

  // ---- Thumbs ----
  function rebuildThumbs() {
    els.pageThumbs.innerHTML = '';
    state.viewer.pages.forEach((p, idx) => {
      const t = document.createElement('div');
      t.className = 'page-thumb' + (idx === state.currentPageIndex ? ' active' : '');
      t.textContent = `Stránka ${idx + 1}`;
      t.addEventListener('click', () => {
        state.currentPageIndex = idx;
        state.viewer.scrollToPage(idx);
        markActiveThumb();
      });
      els.pageThumbs.appendChild(t);
    });
  }
  function markActiveThumb() {
    els.pageThumbs.querySelectorAll('.page-thumb').forEach((n, i) => {
      n.classList.toggle('active', i === state.currentPageIndex);
    });
  }

  // ---- Track which page is most visible during scroll ----
  function trackVisiblePage() {
    const io = new IntersectionObserver((entries) => {
      let best = null;
      for (const e of entries) {
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
      }
      if (best && best.isIntersecting) {
        const idx = Number(best.target.dataset.pageIndex);
        if (!Number.isNaN(idx) && idx !== state.currentPageIndex) {
          state.currentPageIndex = idx;
          markActiveThumb();
        }
      }
    }, { root: els.pagesContainer, threshold: [0.25, 0.5, 0.75] });
    state.viewer.pages.forEach((p) => io.observe(p.wrap));
  }

  // ---- Buttons enable/disable ----
  function updateButtons() {
    const hasDoc = !!state.viewer;
    els.btnNewSig.disabled = !hasDoc;
    els.btnReset.disabled = !hasDoc;
    els.btnExport.disabled = !hasDoc || state.signatures.length === 0;
  }

  // ---- Signature modal ----
  let pad = null;
  function bindModal() {
    pad = new SignaturePad(els.sigPadCanvas, { color: '#0a0a0a', lineWidth: 2.5 });
    els.penColor.addEventListener('input', (e) => pad.setColor(e.target.value));
    els.penWidth.addEventListener('input', (e) => pad.setLineWidth(parseFloat(e.target.value)));
    els.padClear.addEventListener('click', () => {
      pad.clear();
      state.pendingSignatureDataUrl = null;
    });

    // tabs
    document.querySelectorAll('.modal-tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.modal-tabs .tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });

    // upload image
    els.sigImageInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        els.sigImagePreview.src = reader.result;
        state.pendingSignatureDataUrl = reader.result;
      };
      reader.readAsDataURL(f);
    });

    // close handlers
    els.modal.querySelectorAll('[data-close]').forEach((n) => {
      n.addEventListener('click', closeModal);
    });

    els.sigConfirm.addEventListener('click', confirmSignature);
    els.btnNewSig.addEventListener('click', openModal);
  }

  function openModal() {
    els.modal.classList.remove('hidden');
    // reset state
    pad.clear();
    els.sigImagePreview.removeAttribute('src');
    els.sigImageInput.value = '';
    state.pendingSignatureDataUrl = null;
  }
  function closeModal() {
    els.modal.classList.add('hidden');
  }

  function confirmSignature() {
    let dataUrl = null;

    const drawActive = document.querySelector('.modal-tabs .tab.active').dataset.tab === 'draw';
    if (drawActive) {
      if (pad.isEmpty()) {
        toast('Nakreslete prosím podpis', 'error');
        return;
      }
      dataUrl = pad.toTrimmedDataURL();
    } else {
      if (!state.pendingSignatureDataUrl) {
        toast('Vyberte prosím obrázek', 'error');
        return;
      }
      dataUrl = state.pendingSignatureDataUrl;
    }
    if (!dataUrl) return;

    // create image to get intrinsic size, then place on current page
    const img = new Image();
    img.onload = () => {
      placeSignature(dataUrl, img.naturalWidth, img.naturalHeight);
      closeModal();
    };
    img.src = dataUrl;
  }

  function placeSignature(dataUrl, iw, ih) {
    const pageEntry = state.viewer.getPage(state.currentPageIndex);
    if (!pageEntry) return;
    const sig = new SignatureOverlay({
      pageEntry,
      dataUrl,
      intrinsicWidth: iw,
      intrinsicHeight: ih,
      onChange: () => rebuildPlacedList(),
      onDelete: (s) => {
        state.signatures = state.signatures.filter((x) => x !== s);
        rebuildPlacedList();
        updateButtons();
      }
    });
    state.signatures.push(sig);
    sig.activate();
    rebuildPlacedList();
    updateButtons();
  }

  function rebuildPlacedList() {
    if (state.signatures.length === 0) {
      els.placedList.innerHTML = '<p class="muted">Zatím žádné. Klikněte na „Nový podpis".</p>';
      return;
    }
    els.placedList.innerHTML = '';
    state.signatures.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'placed-row';
      row.innerHTML = `<span>Podpis ${idx + 1} · str. ${s.pageEntry.pageIndex + 1}</span>`;
      const btn = document.createElement('button');
      btn.className = 'remove';
      btn.title = 'Smazat';
      btn.textContent = '×';
      btn.addEventListener('click', () => {
        s.destroy();
        state.signatures = state.signatures.filter((x) => x !== s);
        rebuildPlacedList();
        updateButtons();
      });
      const goto = document.createElement('button');
      goto.className = 'btn btn-ghost';
      goto.style.padding = '2px 8px';
      goto.style.fontSize = '11px';
      goto.textContent = 'Zobrazit';
      goto.addEventListener('click', () => {
        state.viewer.scrollToPage(s.pageEntry.pageIndex);
        s.activate();
      });
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '4px';
      right.appendChild(goto);
      right.appendChild(btn);
      row.appendChild(right);
      els.placedList.appendChild(row);
    });
  }

  // ---- Zoom ----
  function bindZoom() {
    els.zoomIn.addEventListener('click', () => changeZoom(state.scale + 0.1));
    els.zoomOut.addEventListener('click', () => changeZoom(state.scale - 0.1));
  }
  async function changeZoom(newScale) {
    newScale = Math.max(0.4, Math.min(2.5, newScale));
    if (!state.viewer) return;
    state.scale = newScale;
    els.zoomLabel.textContent = `${Math.round(newScale * 100)} %`;
    await state.viewer.setScaleAndRerender(newScale);
  }

  // ---- Export ----
  function bindExport() {
    els.btnExport.addEventListener('click', async () => {
      if (state.signatures.length === 0) return;
      els.btnExport.disabled = true;
      els.btnExport.textContent = 'Generuji…';
      try {
        const rects = state.signatures.map((s) => s.getExportRect());
        const blob = await Exporter.exportSignedPdf(state.originalBytes, rects);
        const outName = (state.fileName || 'dokument.pdf').replace(/\.pdf$/i, '') + '_podepsano.pdf';
        Exporter.downloadBlob(blob, outName);
        toast('Hotovo. Stahování zahájeno.', 'success');
      } catch (err) {
        console.error(err);
        toast('Export selhal: ' + err.message, 'error');
      } finally {
        els.btnExport.disabled = false;
        els.btnExport.textContent = 'Stáhnout podepsané PDF';
        updateButtons();
      }
    });
  }

  // ---- Reset ----
  function bindReset() {
    els.btnReset.addEventListener('click', () => {
      if (state.signatures.length > 0) {
        if (!confirm('Opravdu zahodit aktuální dokument a začít znovu?')) return;
      }
      state.signatures = [];
      state.originalBytes = null;
      state.fileName = null;
      state.currentPageIndex = 0;
      state.scale = 1.0;
      els.zoomLabel.textContent = '100 %';
      if (state.viewer) state.viewer.destroy();
      state.viewer = null;
      els.pageThumbs.innerHTML = '';
      els.placedList.innerHTML = '<p class="muted">Zatím žádné. Klikněte na „Nový podpis".</p>';
      els.viewerSection.classList.add('hidden');
      els.uploadZone.classList.remove('hidden');
      els.fileInput.value = '';
      updateButtons();
    });
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.pdfjsLib) {
      toast('Chyba: PDF.js se nenačetlo. Zkontrolujte vendor knihovny.', 'error');
      return;
    }
    if (!window.PDFLib) {
      toast('Chyba: pdf-lib se nenačetlo. Zkontrolujte vendor knihovny.', 'error');
      return;
    }
    bindUpload();
    bindModal();
    bindZoom();
    bindExport();
    bindReset();
    updateButtons();
  });
})();
