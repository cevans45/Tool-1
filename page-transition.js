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

  function escapeXmlAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/\r?\n/g, ' ');
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

  function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function px(n) {
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  function svgText(x, y, text, size, fill = '#111', weight = 400, extra = '') {
    return `<text x="${px(x)}" y="${px(y)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${escapeXmlAttr(fill)}" ${extra}>${escapeXmlText(text)}</text>`;
  }

  function svgRect(x, y, w, h, fill, stroke = 'none', rx = 0, extra = '') {
    return `<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" rx="${px(rx)}" fill="${escapeXmlAttr(fill)}" stroke="${escapeXmlAttr(stroke)}" ${extra}/>`;
  }

  function visibleElement(el) {
    if (!el || el.closest('#info-overlay, .info-overlay, #global-export-tools')) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function selectedText(select) {
    const opt = select.options[select.selectedIndex];
    return cleanText(opt ? opt.textContent || opt.value : select.value);
  }

  function rangeRatio(input) {
    const min = parseFloat(input.min || '0');
    const max = parseFloat(input.max || '100');
    const val = parseFloat(input.value || '0');
    if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
    return Math.min(1, Math.max(0, (val - min) / (max - min)));
  }

  function rowValue(row, input) {
    const val = row.querySelector('.param-value');
    if (val) return cleanText(val.textContent);
    if (!input) return '';
    if (input.tagName === 'SELECT') return selectedText(input);
    if ((input.type || '').toLowerCase() === 'checkbox') return input.checked ? 'on' : 'off';
    return cleanText(input.value);
  }

  function buttonText(btn) {
    return cleanText(btn.textContent || btn.getAttribute('aria-label') || 'button');
  }

  function renderControlRow(row, x, y, w, parts) {
    if (!visibleElement(row)) return y;
    const label = row.querySelector(':scope > label');
    const input = row.querySelector('input, select, textarea');
    const buttons = [...row.querySelectorAll('button')].filter(visibleElement);
    const modeButtons = [...row.querySelectorAll('.mode-switch button')].filter(visibleElement);
    const canvas = row.querySelector('canvas');

    if (modeButtons.length) {
      const gap = 4;
      const bw = (w - gap * (modeButtons.length - 1)) / modeButtons.length;
      modeButtons.forEach((btn, i) => {
        const bx = x + i * (bw + gap);
        const active = btn.classList.contains('is-active');
        parts.push(svgRect(bx, y, bw, 24, active ? '#111' : 'transparent', '#111', 3));
        parts.push(svgText(bx + bw / 2, y + 15.5, buttonText(btn), 8, active ? '#fff' : '#111', 700, 'text-anchor="middle" letter-spacing="0.04em"'));
      });
      return y + 34;
    }

    if (buttons.length && !input) {
      const gap = 6;
      const bw = (w - gap * (buttons.length - 1)) / buttons.length;
      buttons.forEach((btn, i) => {
        const bx = x + i * (bw + gap);
        parts.push(svgRect(bx, y, bw, 24, 'transparent', '#111', 3));
        parts.push(svgText(bx + bw / 2, y + 15.5, buttonText(btn), 8, '#111', 700, 'text-anchor="middle" letter-spacing="0.04em"'));
      });
      return y + 32;
    }

    if (canvas) {
      parts.push(svgRect(x, y, w, 24, '#f8f8f8', '#ccc', 3));
      parts.push(svgText(x + 8, y + 15.5, 'Marker preview', 9, '#555', 500));
      return y + 32;
    }

    const labelText = cleanText(label ? label.textContent : input ? input.id || input.name : '');
    const valueText = rowValue(row, input);

    if (!input) {
      if (labelText) parts.push(svgText(x, y + 13, labelText, 9, '#444', 500));
      return y + 24;
    }

    const tag = input.tagName;
    const type = (input.type || '').toLowerCase();
    parts.push(svgText(x, y + 14, labelText, 9, '#333', 500));

    if (type === 'range') {
      const valueW = Math.min(44, Math.max(26, valueText.length * 5.5));
      const trackX = x + 80;
      const trackW = Math.max(42, w - 88 - valueW);
      const cy = y + 11;
      const knobX = trackX + trackW * rangeRatio(input);
      parts.push(`<line x1="${px(trackX)}" y1="${px(cy)}" x2="${px(trackX + trackW)}" y2="${px(cy)}" stroke="#bbb" stroke-width="2" stroke-linecap="round"/>`);
      parts.push(`<circle cx="${px(knobX)}" cy="${px(cy)}" r="4" fill="#111"/>`);
      parts.push(svgText(x + w, y + 14, valueText, 9, '#444', 500, 'text-anchor="end"'));
      return y + 26;
    }

    if (type === 'color') {
      parts.push(svgRect(x + w - 34, y + 2, 28, 18, input.value || '#000', '#111', 2));
      return y + 26;
    }

    if (tag === 'SELECT') {
      parts.push(svgRect(x + 82, y, w - 82, 22, '#fff', '#aaa', 3));
      parts.push(svgText(x + 90, y + 14, valueText, 9, '#222', 500));
      parts.push(svgText(x + w - 12, y + 14, 'v', 9, '#555', 700, 'text-anchor="middle"'));
      return y + 28;
    }

    parts.push(svgText(x + w, y + 14, valueText, 9, '#444', 500, 'text-anchor="end"'));
    return y + 26;
  }

  function renderCheckbox(labelEl, x, y, w, parts) {
    if (!visibleElement(labelEl)) return y;
    const input = labelEl.querySelector('input[type="checkbox"]');
    const txt = cleanText(labelEl.querySelector('.cb-label')?.textContent || labelEl.textContent);
    parts.push(svgRect(x, y + 1, 12, 12, input && input.checked ? '#111' : '#fff', '#111', 2));
    if (input && input.checked) {
      parts.push(`<path d="M${px(x + 3)} ${px(y + 7)} L${px(x + 5.5)} ${px(y + 10)} L${px(x + 10)} ${px(y + 4)}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    parts.push(svgText(x + 20, y + 11.5, txt, 9, '#333', 500));
    return y + 24;
  }

  function renderControlNode(node, x, y, w, parts) {
    if (!visibleElement(node)) return y;
    if (node.classList.contains('checkbox-label')) return renderCheckbox(node, x, y, w, parts);
    if (node.classList.contains('control-row')) return renderControlRow(node, x, y, w, parts);
    if (node.tagName === 'H3') {
      parts.push(svgText(x, y + 12, cleanText(node.textContent), 9, '#111', 700, 'letter-spacing="0.04em"'));
      return y + 24;
    }
    return y;
  }

  function buildParametersSvgDocument() {
    const panel = document.querySelector('.control-panel');
    if (!panel) {
      const w = 320;
      const h = 48;
      return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<rect width="100%" height="100%" fill="#f6f6f6" stroke="#ccc"/>` +
        `<text x="12" y="28" font-family="system-ui,sans-serif" font-size="12" fill="#333">No control panel found</text>` +
        `</svg>`
      );
    }

    const panelRect = panel.getBoundingClientRect();
    const w = Math.max(220, Math.ceil(panelRect.width || 240));
    const parts = [];
    const panelStyle = window.getComputedStyle(panel);
    const bg = panelStyle.backgroundColor || '#fff';
    const border = panelStyle.borderColor || '#000';
    const bodyX = 16;
    const bodyW = w - bodyX * 2;
    let y = 0;

    parts.push(svgRect(0, 0, w, 10, bg, 'none', 16));

    const header = panel.querySelector('.panel-header');
    const headerH = header ? Math.max(42, Math.ceil(header.getBoundingClientRect().height)) : 48;
    parts.push(svgRect(0, 0, w, headerH, bg, 'none', 16));
    parts.push(`<line x1="0" y1="${headerH}" x2="${w}" y2="${headerH}" stroke="#ccc"/>`);
    parts.push(svgText(20, headerH / 2 + 4, cleanText(header?.querySelector('h2')?.textContent || 'Controls'), 10, '#333', 500, 'letter-spacing="0.05em" text-transform="uppercase"'));
    parts.push(`<circle cx="${w - 30}" cy="${headerH / 2}" r="10" fill="#333" stroke="#555"/>`);
    parts.push(svgText(w - 30, headerH / 2 + 4, 'i', 12, '#aaa', 700, 'text-anchor="middle" font-style="italic"'));
    y = headerH;

    const body = panel.querySelector('.panel-body');
    const children = body ? [...body.children] : [];
    children.forEach((child) => {
      if (!visibleElement(child)) return;
      if (child.id === 'global-export-tools') return;

      if (child.tagName === 'DETAILS') {
        const summary = child.querySelector(':scope > summary');
        parts.push(`<line x1="0" y1="${px(y)}" x2="${w}" y2="${px(y)}" stroke="#ddd"/>`);
        y += 19;
        parts.push(svgText(16, y, cleanText(summary?.textContent || 'Section'), 9, '#000', 700, 'letter-spacing="0.05em"'));
        y += 10;
        if (child.open) {
          child.querySelectorAll(':scope > .control-section').forEach((section) => {
            if (!visibleElement(section)) return;
            [...section.children].forEach((node) => {
              y = renderControlNode(node, bodyX, y, bodyW, parts);
            });
            y += 4;
          });
        }
        return;
      }

      if (child.classList.contains('control-section')) {
        [...child.children].forEach((node) => {
          y = renderControlNode(node, bodyX, y, bodyW, parts);
        });
        y += 8;
      }
    });

    y = Math.max(y + 10, headerH + 40);
    parts.push(svgRect(0.5, 0.5, w - 1, y - 1, 'none', border, 16, 'stroke-width="1"'));

    const desc = escapeXmlText(
      `Editable vector control panel · ${document.title || 'tool'} · ${new Date().toISOString()}`
    );
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${px(y)}" viewBox="0 0 ${w} ${px(y)}">` +
      `<desc>${desc}</desc>` +
      parts.join('') +
      `</svg>`
    );
  }

  function downloadParametersSvg() {
    try {
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
    } catch (e) {
      console.error(e);
      alert('Could not export parameters snapshot.');
    }
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

  const VIDEO_RECORD_MS = 10000;
  const VIDEO_FPS = 30;

  function pickVideoMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/mp4',
      'video/mp4; codecs=avc1.42E01E',
      'video/mp4; codecs=avc1.4d002a',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function videoFileExtension(mime) {
    return mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
  }

  async function exportMP4() {
    if (typeof MediaRecorder === 'undefined') {
      alert('Video recording is not available in this browser.');
      return;
    }
    const mimeType = pickVideoMimeType();
    if (!mimeType) {
      alert('No supported video codec for recording in this browser.');
      return;
    }

    let canvas = null;
    if (typeof window.prepareCanvasVideoExport === 'function') {
      try {
        let c = window.prepareCanvasVideoExport();
        if (c != null && typeof c.then === 'function') c = await c;
        if (c && c.nodeName === 'CANVAS') canvas = c;
      } catch (e) {
        console.error(e);
      }
    }
    if (!canvas) canvas = pickCanvas();
    if (!canvas) {
      alert('No canvas found to record.');
      return;
    }

    let stream;
    try {
      stream = canvas.captureStream(VIDEO_FPS);
    } catch (e) {
      console.error(e);
      alert('Could not capture the canvas for video.');
      return;
    }

    const chunks = [];
    const rec = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 6e6,
    });

    await new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => resolve();
      rec.onerror = () => reject(new Error('MediaRecorder failed'));
      try {
        rec.start(250);
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        reject(e);
        return;
      }
      window.setTimeout(() => {
        try {
          if (rec.state === 'recording') rec.stop();
        } catch (err) {
          console.error(err);
        }
        stream.getTracks().forEach((t) => t.stop());
      }, VIDEO_RECORD_MS);
    }).catch((err) => {
      console.error(err);
      throw err;
    });

    if (!chunks.length) {
      alert('Recording produced no data. The canvas may need to keep animating while recording (try unpausing).');
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const ext = videoFileExtension(mimeType);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename(ext);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
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
    wrap.style.marginTop = '-4px';

    const title = document.createElement('h3');
    title.textContent = 'Export';
    title.className = 'global-export-heading';
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

    const mp4Btn = document.createElement('button');
    mp4Btn.type = 'button';
    mp4Btn.className = 'panel-button panel-button--export';
    mp4Btn.style.width = '100%';
    mp4Btn.textContent = 'Export MP4';
    mp4Btn.title =
      'Records ~10s of the main canvas. Encodes as MP4 when your browser supports it; otherwise WebM (same file name base).';
    mp4Btn.addEventListener('click', async () => {
      if (mp4Btn.disabled) return;
      mp4Btn.disabled = true;
      const prev = mp4Btn.textContent;
      mp4Btn.textContent = 'Recording… 10s';
      try {
        await exportMP4();
      } catch (err) {
        console.error(err);
        alert('Video export failed. Try again.');
      } finally {
        mp4Btn.disabled = false;
        mp4Btn.textContent = prev;
      }
    });
    row.appendChild(mp4Btn);

    wrap.appendChild(row);

    const panelBody = document.querySelector('.control-panel .panel-body');
    if (panelBody) {
      panelBody.appendChild(wrap);
      return;
    }

    // Fallback only for pages without a right-side control center.
    wrap.classList.add('global-export-tools--floating');
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '24px';
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
    void downloadParametersSvg();
  });
})();

