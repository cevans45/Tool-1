// CRT wash tool — your fake raycast sketch with editable parameters

let crtZMotion = 0;

const crtParams = {
  layers: 100,
  block: 20,
  zspeed: 5,
  xspeed: 5,
  fade: 0.05,
  bg: '#000000',
  hueBase: 0,
  hueRange: 360,
  shape: 'square', // square | rounded | circle
  mirrors: 4,      // 1..4
};

const crtSketch = (p) => {
  p.setup = () => {
    const container = document.getElementById('crt-canvas');
    const w = Math.max(480, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    const h = Math.max(360, Math.min(window.innerHeight - 160, w * 3 / 4));
    const canvas = p.createCanvas(w, h);
    if (container) canvas.parent('crt-canvas');
    p.colorMode(p.HSL, 360, 255, 255);
    p.noStroke();
    bindCrtControls();
  };

  p.windowResized = () => {
    const container = document.getElementById('crt-canvas');
    if (!container) return;
    const w = Math.max(480, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    const h = Math.max(360, Math.min(window.innerHeight - 160, w * 3 / 4));
    p.resizeCanvas(w, h);
  };

  p.draw = () => {
    p.background(crtParams.bg);
    p.noStroke();
    // trail
    p.fill(0, 0, 0, crtParams.fade);
    p.rect(0, 0, p.width, p.height);

    let xmotion = 0;
    let ymotion = 0;

    for (let i = 0; i < crtParams.layers; i++) {
      const ni = i / crtParams.layers;

      const sw = crtParams.block;
      const sh = crtParams.block;
      const w = p.width;
      const h = p.height;
      const sf = 0.5 * p.sin(ni * p.PI * 2.25 + crtZMotion / 100);
      const sx = sf + xmotion / 64;
      const sy = sf + xmotion / 64;

      p.push();
      p.translate(p.width / 2, p.height / 2);
      p.scale(0.8);
      p.rotate((p.sin(xmotion / 32) / 8) * ni + crtZMotion / 500 + p.cos(crtZMotion / 200));

      for (let x = 0; x < w / 2; x += sh) {
        const nx = x / (w / 2);
        const anx = Math.abs(0.5 - nx) * 2;
        const smx = (p.sin(xmotion / 50 + crtZMotion / 100 + anx * p.PI * 2)) * anx * w / 2;
        const smy = (p.cos(xmotion / 50 + crtZMotion / 100 + ni * p.PI * 0.5 + nx * p.PI * 2)) * (w / 2 * p.sin(crtZMotion / 100));
        const brightness = 105 + 255 * Math.abs(p.sin(crtZMotion / 1000 + ni * p.PI * 1) * nx) - ((x ^ (i * 16 + p.frameCount * 16)) % 255);

        let srcHue = (crtZMotion + (x + p.frameCount) | (i / 2 + p.frameCount * 2)) % 360;
        const hue = (crtParams.hueBase + (srcHue / 360) * crtParams.hueRange) % 360;

        p.fill(hue, 200, brightness, 1);

        const vw = sw * sx * (1 - ni);
        const vh = sh * sy * (1 - ni);

        let xx = x;
        if (x <= 0) {
          xx += smx;
        }

        if (brightness < 1) continue;

        const yy = 0 + smy;

        rectSymmetric(p, w, h, xx, yy, sx, sy, vw, vh);
      }
      p.pop();

      xmotion += 0.5 * (crtParams.xspeed / 5);
      ymotion += 0.5 * (crtParams.xspeed / 5);
    }

    crtZMotion += 4.5 * (crtParams.zspeed / 5);
  };
};

function crtDrawBlock(p, x, y, w, h) {
  if (crtParams.shape === 'circle') {
    const d = Math.min(w, h);
    p.circle(x + w / 2, y + h / 2, d);
  } else if (crtParams.shape === 'rounded') {
    const r = Math.min(w, h) * 0.4;
    p.rect(x, y, w, h, r);
  } else {
    p.rect(x, y, w, h);
  }
}

function rectSymmetric(p, w, h, xx, yy, sx, sy, vw, vh) {
  const m = crtParams.mirrors || 1;

  // compute base position, then work in centered coordinates for clean symmetry
  const baseX = -w / 2 + w / 2 + (-w / 2 + xx) * sx;
  const baseY = -h / 2 + h / 2 + (-h / 2 + yy) * sy;
  const cx = w / 2;
  const cy = h / 2;
  const dx = baseX - cx;
  const dy = baseY - cy;

  const positions = [];

  // 1: base
  if (m >= 1) positions.push({ dx:  dx, dy:  dy });
  // 2: horizontal mirror
  if (m >= 2) positions.push({ dx: -dx, dy:  dy });
  // 3: vertical mirror
  if (m >= 3) positions.push({ dx:  dx, dy: -dy });
  // 4: both axes
  if (m >= 4) positions.push({ dx: -dx, dy: -dy });
  // 5–6: diagonals (swap x/y)
  if (m >= 5) positions.push({ dx:  dy, dy:  dx });
  if (m >= 6) positions.push({ dx: -dy, dy: -dx });

  positions.forEach(pos => {
    const x = cx + pos.dx - vw / 2;
    const y = cy + pos.dy - vh / 2;
    crtDrawBlock(p, x, y, vw, vh);
  });
}

function bindCrtControls() {
  const id = (x) => document.getElementById(x);
  const layersEl = id('crt-layers');
  const blockEl = id('crt-block');
  const zspeedEl = id('crt-zspeed');
  const xspeedEl = id('crt-xspeed');
  const fadeEl = id('crt-fade');
  const bgEl = id('crt-bg');
  const hueBaseEl = id('crt-hue-base');
  const hueRangeEl = id('crt-hue-range');
  const shapeEl = id('crt-shape');
  const mirrorsEl = id('crt-mirrors');

  const setVal = (labelId, text) => {
    const el = id(labelId);
    if (el) el.textContent = text;
  };

  if (layersEl) {
    layersEl.addEventListener('input', () => {
      crtParams.layers = parseInt(layersEl.value, 10);
      setVal('val-crt-layers', layersEl.value);
    });
  }

  if (blockEl) {
    blockEl.addEventListener('input', () => {
      crtParams.block = parseInt(blockEl.value, 10);
      setVal('val-crt-block', blockEl.value);
    });
  }

  if (zspeedEl) {
    zspeedEl.addEventListener('input', () => {
      crtParams.zspeed = parseInt(zspeedEl.value, 10);
      setVal('val-crt-zspeed', zspeedEl.value);
    });
  }

  if (xspeedEl) {
    xspeedEl.addEventListener('input', () => {
      crtParams.xspeed = parseInt(xspeedEl.value, 10);
      setVal('val-crt-xspeed', xspeedEl.value);
    });
  }

  if (fadeEl) {
    fadeEl.addEventListener('input', () => {
      crtParams.fade = parseInt(fadeEl.value, 10) / 100;
      setVal('val-crt-fade', crtParams.fade.toFixed(2));
    });
  }

  if (bgEl) {
    bgEl.addEventListener('input', () => {
      crtParams.bg = bgEl.value;
    });
  }

  if (hueBaseEl) {
    hueBaseEl.addEventListener('input', () => {
      crtParams.hueBase = parseInt(hueBaseEl.value, 10) || 0;
      setVal('val-crt-hue-base', crtParams.hueBase + '°');
    });
  }

  if (hueRangeEl) {
    hueRangeEl.addEventListener('input', () => {
      crtParams.hueRange = parseInt(hueRangeEl.value, 10) || 0;
      setVal('val-crt-hue-range', crtParams.hueRange + '°');
    });
  }

  if (shapeEl) {
    shapeEl.addEventListener('change', () => {
      crtParams.shape = shapeEl.value;
    });
  }

  if (mirrorsEl) {
    mirrorsEl.addEventListener('input', () => {
      crtParams.mirrors = parseInt(mirrorsEl.value, 10) || 1;
      setVal('val-crt-mirrors', String(crtParams.mirrors));
    });
  }

  setVal('val-crt-layers', String(crtParams.layers));
  setVal('val-crt-block', String(crtParams.block));
  setVal('val-crt-zspeed', String(crtParams.zspeed));
  setVal('val-crt-xspeed', String(crtParams.xspeed));
  setVal('val-crt-fade', crtParams.fade.toFixed(2));
  setVal('val-crt-hue-base', crtParams.hueBase + '°');
  setVal('val-crt-hue-range', crtParams.hueRange + '°');
  setVal('val-crt-mirrors', String(crtParams.mirrors));
}

new p5(crtSketch);

