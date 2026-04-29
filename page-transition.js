// Lightweight page-view transition for same-tab navigation.
// Fades in on load and fades out before navigating.

(function () {
  const READY_CLASS = 'is-ready';
  const LEAVING_CLASS = 'is-leaving';
  const PREVIEW_CLASS = 'is-preview';
  const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';

  if (isPreview) {
    document.body.classList.add(PREVIEW_CLASS);
  }

  function isModifiedClick(e) {
    return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
  }

  function isSameOriginLink(a) {
    try {
      const url = new URL(a.href, window.location.href);
      return url.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function shouldHandleLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    if (!isSameOriginLink(a)) return false;
    if (a.getAttribute('href')?.startsWith('#')) return false;
    return true;
  }

  window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
      document.body.classList.add(READY_CLASS);
    });
  });

  // Handle BFCache restore.
  window.addEventListener('pageshow', () => {
    document.body.classList.remove(LEAVING_CLASS);
    document.body.classList.add(READY_CLASS);
  });

  document.addEventListener('click', (e) => {
    if (isPreview) return;
    if (isModifiedClick(e)) return;
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!a) return;
    if (!shouldHandleLink(a)) return;

    const href = a.href;
    if (href === window.location.href) return;

    e.preventDefault();
    document.body.classList.remove(READY_CLASS);
    document.body.classList.add(LEAVING_CLASS);

    // Match CSS transition duration.
    window.setTimeout(() => {
      window.location.href = href;
    }, 180);
  });

  function isIndexPage() {
    const path = window.location.pathname.toLowerCase();
    return path.endsWith('/index.html') || path === '/' || path === '';
  }

  function pickCanvas() {
    const list = Array.from(document.querySelectorAll('canvas'));
    if (!list.length) return null;
    list.sort((a, b) => {
      const aa = (a.width || 0) * (a.height || 0);
      const bb = (b.width || 0) * (b.height || 0);
      return bb - aa;
    });
    return list[0];
  }

  function pickSvg() {
    const list = Array.from(document.querySelectorAll('svg'));
    if (!list.length) return null;
    const withArea = list.filter((svg) => {
      const rect = svg.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8;
    });
    return withArea[0] || null;
  }

  function filename(ext) {
    const raw = window.location.pathname.split('/').pop() || 'tool';
    const base = raw.replace(/\.html?$/i, '') || 'tool';
    return `${base}_export.${ext}`;
  }

  function filenameParamsSvg() {
    const raw = window.location.pathname.split('/').pop() || 'tool';
    const base = raw.replace(/\.html?$/i, '') || 'tool';
    return `${base}_params.svg`;
  }

  function escapeXmlText(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shouldIgnoreParametersShortcutFocus(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return (
        t === 'text' ||
        t === 'search' ||
        t === 'email' ||
        t === 'url' ||
        t === 'tel' ||
        t === 'password' ||
        t === 'number'
      );
    }
    return false;
  }

  function skipParametersElement(el) {
    if (!el.closest) return true;
    if (el.closest('#info-overlay')) return true;
    if (el.closest('#global-export-tools')) return true;
    if (el.closest('.info-overlay')) return true;
    return false;
  }

  function controlLabelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab && lab.textContent) return lab.textContent.replace(/\s+/g, ' ').trim();
      } catch {
        /* ignore */
      }
    }
    const row = el.closest('.control-row');
    if (row) {
      const lab = row.querySelector(':scope > label');
      if (lab && lab.textContent) return lab.textContent.replace(/\s+/g, ' ').trim();
    }
    const det = el.closest('details');
    if (det) {
      const sum = det.querySelector(':scope > summary');
      if (sum && sum.textContent) return `${sum.textContent.replace(/\s+/g, ' ').trim()} › ${el.name || el.id || 'control'}`;
    }
    return el.name || el.id || el.getAttribute('id') || 'control';
  }

  function controlValueString(el) {
    const type = (el.type || '').toLowerCase();
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      return opt ? (opt.textContent || opt.value || '').trim() : el.value;
    }
    if (type === 'checkbox') return el.checked ? 'on' : 'off';
    if (type === 'radio') return el.checked ? el.value || 'on' : '';
    return el.value;
  }

  function collectPanelParameters() {
    const panel = document.querySelector('.control-panel .panel-body');
    if (!panel) return [];
    const entries = [];
    const seen = new Set();

    panel.querySelectorAll('input, select, textarea').forEach((el) => {
      if (skipParametersElement(el)) return;
      if (el.disabled) return;
      const type = (el.type || '').toLowerCase();
      if (el.tagName === 'INPUT') {
        if (type === 'hidden' || type === 'file' || type === 'button' || type === 'submit' || type === 'reset') return;
        if (type === 'radio') {
          if (!el.checked) return;
        }
      }
      const value = controlValueString(el);
      const label = controlLabelFor(el);
      const key = `${label}\0${el.name || ''}\0${el.id || ''}\0${type}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ label, value: String(value) });
    });

    return entries;
  }

  function buildParametersSvgDocument() {
    const entries = collectPanelParameters();
    const raw = window.location.pathname.split('/').pop() || 'tool';
    const titleEl = document.querySelector('title');
    const pageTitle =
      (titleEl && titleEl.textContent.trim()) || raw.replace(/\.html?$/i, '') || 'tool';
    const lineHeight = 14;
    const padY = 28;
    const padX = 14;
    const width = 520;

    const jsonDesc = escapeXmlText(JSON.stringify(entries));
    let y = padY + lineHeight;
    let maxY = y;
    const textBlocks = [
      `<text x="${padX}" y="${y}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" font-weight="600" fill="#111">${escapeXmlText(pageTitle)} — parameters</text>`,
    ];
    y += lineHeight;
    maxY = y;
    textBlocks.push(
      `<text x="${padX}" y="${y}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="11" fill="#555">Shift+1 export · ${escapeXmlText(new Date().toISOString())}</text>`
    );
    y += lineHeight * 1.25;

    if (!entries.length) {
      y += lineHeight;
      maxY = y;
      textBlocks.push(
        `<text x="${padX}" y="${y}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="11" fill="#333">(no control values found in panel)</text>`
      );
    } else {
      entries.forEach(({ label, value }) => {
        y += lineHeight;
        maxY = y;
        const line = `${label}: ${value}`;
        textBlocks.push(
          `<text x="${padX}" y="${y}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="11" fill="#222">${escapeXmlText(line)}</text>`
        );
      });
    }

    const height = Math.ceil(maxY + 24);

    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<desc>${jsonDesc}</desc>` +
      `<rect width="100%" height="100%" fill="#fafafa"/>` +
            textBlocks.join('') +
      `</svg>`
    );
  }

  function downloadParametersSvg() {
    const svgText = buildParametersSvgDocument();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filenameParamsSvg();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  }

  function saveDataUrl(dataUrl, ext) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename(ext);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function svgToData(svg) {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const text = new XMLSerializer().serializeToString(clone);
    return {
      text,
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
    };
  }

  function rasterizeSource(kind, node, mime, quality) {
    return new Promise((resolve, reject) => {
      if (kind === 'canvas') {
        try {
          resolve(node.toDataURL(mime, quality));
        } catch (err) {
          reject(err);
        }
        return;
      }

      const { url } = svgToData(node);
      const img = new Image();
      img.onload = () => {
        const rect = node.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d');
        cx.clearRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(mime, quality));
      };
      img.onerror = () => reject(new Error('Could not render SVG.'));
      img.src = url;
    });
  }

  function getCompositedCanvas(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    
    let bgLayer = canvas;
    let bgColor = 'rgba(0, 0, 0, 0)';
    while (bgLayer && bgLayer.nodeType === 1) {
      const bg = window.getComputedStyle(bgLayer).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== '') {
        bgColor = bg;
        break;
      }
      bgLayer = bgLayer.parentNode;
    }
    if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
      bgColor = '#ffffff';
    }

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, out.width, out.height);

    let filterLayer = canvas;
    let computedFilter = 'none';
    while (filterLayer && filterLayer.nodeType === 1) {
      const f = window.getComputedStyle(filterLayer).filter;
      if (f && f !== 'none' && f !== '') {
        computedFilter = f;
        break;
      }
      filterLayer = filterLayer.parentNode;
    }

    ctx.save();
    if (computedFilter !== 'none') {
      ctx.filter = computedFilter;
    }
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();

    return out;
  }

  async function exportPNG() {
    if (typeof window.exportPagePNG === 'function') {
      try {
        const ret = window.exportPagePNG();
        if (ret != null && typeof ret.then === 'function') await ret;
        return;
      } catch (e) {
        console.error(e);
      }
    }
    const canvas = pickCanvas();
    const svg = pickSvg();
    if (canvas) {
      const comp = getCompositedCanvas(canvas);
      saveDataUrl(comp.toDataURL('image/png'), 'png');
      return;
    }
    if (svg) {
      const png = await rasterizeSource('svg', svg, 'image/png');
      saveDataUrl(png, 'png');
      return;
    }
    alert('No drawable canvas/SVG found on this page.');
  }

  async function exportIMG() {
    const canvas = pickCanvas();
    const svg = pickSvg();
    if (canvas) {
      const comp = getCompositedCanvas(canvas);
      saveDataUrl(comp.toDataURL('image/jpeg', 0.95), 'jpg');
      return;
    }
    if (svg) {
      const jpg = await rasterizeSource('svg', svg, 'image/jpeg', 0.95);
      saveDataUrl(jpg, 'jpg');
      return;
    }
    alert('No drawable canvas/SVG found on this page.');
  }

  function triggerSvgDownload(svgStr) {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename('svg');
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download — the browser may read the blob asynchronously.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  }

  async function exportSVG() {
    if (typeof window.exportTrueSVG === 'function') {
      try {
        const maybe = window.exportTrueSVG();
        // Avoid `await` on non-Promise returns: `await` always defers at least one
        // microtask and can drop user activation, so blob downloads are blocked.
        if (maybe != null && typeof maybe.then === 'function') {
          const svgStr = await maybe;
          if (svgStr) {
            triggerSvgDownload(svgStr);
            return;
          }
        } else if (maybe) {
          triggerSvgDownload(maybe);
          return;
        }
      } catch (e) {
        console.error('True SVG export failed, falling back:', e);
      }
    }

    const svg = pickSvg();
    if (svg) {
      const { text } = svgToData(svg);
      const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename('svg');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      return;
    }

    const canvas = pickCanvas();
    if (canvas) {
      const comp = getCompositedCanvas(canvas);
      const png = comp.toDataURL('image/png');
      const w = comp.width || comp.clientWidth || 1024;
      const h = comp.height || comp.clientHeight || 1024;
      const text =
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<image xlink:href="${png}" href="${png}" width="${w}" height="${h}" />` +
        `</svg>`;
      const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename('svg');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      return;
    }

    alert('No drawable canvas/SVG found on this page.');
  }

  function mountExportUI() {
    if (isPreview || isIndexPage()) return;
    if (document.getElementById('global-export-tools')) return;

    const wrap = document.createElement('section');
    wrap.id = 'global-export-tools';
    wrap.className = 'control-section global-export-tools';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';
    wrap.style.marginTop = '10px';

    const title = document.createElement('h3');
    title.textContent = 'Export';
    title.style.margin = '0';
    title.style.font = '600 12px/1 system-ui, -apple-system, Segoe UI, sans-serif';
    title.style.letterSpacing = '0.04em';
    title.style.textTransform = 'uppercase';
    wrap.appendChild(title);

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr';
    row.style.gap = '6px';

    const makeBtn = (label, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = 'panel-button panel-button--export';
      btn.style.width = '100%';
      btn.addEventListener('click', () => {
        try {
          const ret = onClick();
          if (ret != null && typeof ret.then === 'function') {
            ret.catch((err) => {
              console.error(err);
              alert('Export failed. Try again.');
            });
          }
        } catch (err) {
          console.error(err);
          alert('Export failed. Try again.');
        }
      });
      return btn;
    };

    row.appendChild(makeBtn('Export SVG', exportSVG));
    row.appendChild(makeBtn('Export PNG', exportPNG));
    row.appendChild(makeBtn('Export IMG', exportIMG));
    wrap.appendChild(row);

    const panelBody = document.querySelector('.control-panel .panel-body');
    if (panelBody) {
      panelBody.appendChild(wrap);
      return;
    }

    // Fallback only for pages without a right-side control center.
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '16px';
    wrap.style.zIndex = '9999';
    wrap.style.padding = '10px';
    wrap.style.borderRadius = '14px';
    wrap.style.backdropFilter = 'blur(8px)';
    wrap.style.background = 'rgba(12,12,12,0.72)';
    wrap.style.border = '1px solid rgba(255,255,255,0.16)';
    document.body.appendChild(wrap);
  }

  window.addEventListener('DOMContentLoaded', mountExportUI);

  document.addEventListener('keydown', (e) => {
    if (isPreview || isIndexPage()) return;
    if (e.code !== 'Digit1' || !e.shiftKey || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (shouldIgnoreParametersShortcutFocus(document.activeElement)) return;
    e.preventDefault();
    downloadParametersSvg();
  });
})();

