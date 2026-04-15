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

    const filter = window.getComputedStyle(canvas).filter;
    ctx.save();
    if (filter && filter !== 'none') {
      ctx.filter = filter;
    }
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();

    return out;
  }

  async function exportPNG() {
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

  async function exportSVG() {
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
      URL.revokeObjectURL(blobUrl);
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
      URL.revokeObjectURL(blobUrl);
      return;
    }

    alert('No drawable canvas/SVG found on this page.');
  }

  function mountExportUI() {
    if (isPreview || isIndexPage()) return;
    if (document.getElementById('global-export-tools')) return;

    const wrap = document.createElement('section');
    wrap.id = 'global-export-tools';
    wrap.className = 'control-section';
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
      btn.className = 'panel-button';
      btn.style.width = '100%';
      btn.style.border = '1px solid rgba(255,255,255,0.18)';
      btn.style.background = '#151515';
      btn.style.color = '#f3f3f3';
      btn.style.padding = '8px 10px';
      btn.style.font = '600 12px/1 system-ui, -apple-system, Segoe UI, sans-serif';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', async () => {
        try {
          await onClick();
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
})();

