// Particles tool reworked to "something like your recursive sketch"
// with deterministic seed + editable input fields.

const particleSketch = (p) => {
  let minWidth;
  let motion = 0;

  const params = {
    seed: 123456,
    pa: 0.3,
    pb: 0.3,
    pc: 2,
    pd: 0.5,
    depth: 7,
    branches: 5,
    radius: 0.15,
    idValue: 0.5,
    cellScale: 0.65,
    zoom: 1.5,
    tiles: 'single', // locked to single composition
    animate: true,
    motion: 0.2,
    rotFreq: 13.21,
    radFreq: 33.4,
    branchA: 0.5,
    branchB: 0.5,
    branchC: 0.6,
    hueStart: 0,
    hueEnd: 360,
    bg: '#000000',
    saturation: 100,
    brightnessMul: 1,
    alpha: 0.5,
    strokeMode: 'auto', // auto | fill | stroke
    strokeWidth: 1,
  };

  const fract = (v) => v - Math.floor(v);

  const byId = (id) => document.getElementById(id);
  const setVal = (id, txt) => {
    const el = byId(id);
    if (el) el.textContent = txt;
  };

  function applyUI() {
    const seedEl = byId('pr-seed');
    const paEl = byId('pr-pa');
    const pbEl = byId('pr-pb');
    const pcEl = byId('pr-pc');
    const pdEl = byId('pr-pd');
    const depthEl = byId('pr-depth');
    const branchesEl = byId('pr-branches');
    const radiusEl = byId('pr-radius');
    const idEl = byId('pr-id');
    const cellEl = byId('pr-cell');
    const zoomEl = byId('pr-zoom');
    const tilesEl = byId('pr-tiles');
    const animateEl = byId('pr-animate');
    const motionEl = byId('pr-motion');
    const rotFreqEl = byId('pr-rot-freq');
    const radFreqEl = byId('pr-rad-freq');
    const b1El = byId('pr-b1');
    const b2El = byId('pr-b2');
    const b3El = byId('pr-b3');
    const hueStartEl = byId('pr-hue-start');
    const hueEndEl = byId('pr-hue-end');
    const bgEl = byId('pr-bg');
    const satEl = byId('pr-sat');
    const brightEl = byId('pr-bright');
    const alphaEl = byId('pr-alpha');
    const strokeModeEl = byId('pr-stroke-mode');
    const strokeWidthEl = byId('pr-stroke-width');

    params.seed = parseInt(seedEl?.value || '0', 10) || 0;
    params.pa = (parseInt(paEl?.value || '30', 10)) / 100;
    params.pb = (parseInt(pbEl?.value || '30', 10)) / 100;
    params.pc = parseInt(pcEl?.value || '2', 10);
    params.pd = (parseInt(pdEl?.value || '50', 10)) / 100;
    params.depth = parseInt(depthEl?.value || '7', 10);
    params.branches = parseInt(branchesEl?.value || '5', 10);
    params.radius = (parseInt(radiusEl?.value || '15', 10)) / 100;
    params.idValue = (parseInt(idEl?.value || '500', 10)) / 1000;
    params.cellScale = (parseInt(cellEl?.value || '65', 10)) / 100;
    params.zoom = (parseInt(zoomEl?.value || '100', 10)) / 100;
    params.tiles = 'single';
    params.animate = !!animateEl?.checked;
    params.motion = (parseInt(motionEl?.value || '20', 10)) / 100;
    params.rotFreq = (parseInt(rotFreqEl?.value || '132', 10)) / 10;
    params.radFreq = (parseInt(radFreqEl?.value || '334', 10)) / 10;
    params.branchA = (parseInt(b1El?.value || '50', 10)) / 100;
    params.branchB = (parseInt(b2El?.value || '50', 10)) / 100;
    params.branchC = (parseInt(b3El?.value || '60', 10)) / 100;
    params.hueStart = parseInt(hueStartEl?.value || '0', 10);
    params.hueEnd = parseInt(hueEndEl?.value || '360', 10);
    params.bg = bgEl?.value || '#000000';
    params.saturation = parseInt(satEl?.value || '100', 10);
    params.brightnessMul = (parseInt(brightEl?.value || '100', 10)) / 100;
    params.alpha = (parseInt(alphaEl?.value || '50', 10)) / 100;
    params.strokeMode = strokeModeEl?.value || 'auto';
    params.strokeWidth = parseInt(strokeWidthEl?.value || '1', 10);

    setVal('val-pr-pa', params.pa.toFixed(2));
    setVal('val-pr-pb', params.pb.toFixed(2));
    setVal('val-pr-pc', String(params.pc));
    setVal('val-pr-pd', params.pd.toFixed(2));
    setVal('val-pr-depth', String(params.depth));
    setVal('val-pr-branches', String(params.branches));
    setVal('val-pr-radius', params.radius.toFixed(2));
    setVal('val-pr-id', params.idValue.toFixed(2));
    setVal('val-pr-cell', Math.round(params.cellScale * 100) + '%');
    setVal('val-pr-zoom', params.zoom.toFixed(2) + 'x');
    setVal('val-pr-motion', params.motion.toFixed(2));
    setVal('val-pr-rot-freq', params.rotFreq.toFixed(1));
    setVal('val-pr-rad-freq', params.radFreq.toFixed(1));
    setVal('val-pr-b1', params.branchA.toFixed(2));
    setVal('val-pr-b2', params.branchB.toFixed(2));
    setVal('val-pr-b3', params.branchC.toFixed(2));
    setVal('val-pr-hue-start', params.hueStart + '°');
    setVal('val-pr-hue-end', params.hueEnd + '°');
    setVal('val-pr-sat', String(params.saturation));
    setVal('val-pr-bright', Math.round(params.brightnessMul * 100) + '%');
    setVal('val-pr-alpha', params.alpha.toFixed(2));
    setVal('val-pr-stroke-width', String(params.strokeWidth));
  }

  function bindControls() {
    const ids = [
      'pr-seed', 'pr-pa', 'pr-pb', 'pr-pc', 'pr-pd',
      'pr-depth', 'pr-branches', 'pr-radius', 'pr-id', 'pr-cell', 'pr-zoom', 'pr-motion',
      'pr-rot-freq', 'pr-rad-freq', 'pr-b1', 'pr-b2', 'pr-b3',
      'pr-hue-start', 'pr-hue-end', 'pr-sat', 'pr-bright', 'pr-alpha', 'pr-stroke-width'
    ];
    ids.forEach((id) => {
      const el = byId(id);
      if (!el) return;
      el.addEventListener('input', () => {
        applyUI();
        p.redraw();
      });
    });

    const tilesEl = byId('pr-tiles');
    if (tilesEl) {
      tilesEl.addEventListener('change', () => {
        applyUI();
        p.redraw();
      });
    }

    const strokeModeEl = byId('pr-stroke-mode');
    if (strokeModeEl) {
      strokeModeEl.addEventListener('change', () => {
        applyUI();
        p.redraw();
      });
    }

    const animateEl = byId('pr-animate');
    if (animateEl) {
      animateEl.addEventListener('change', () => {
        applyUI();
      });
    }

    const randomSeedBtn = byId('pr-random-seed');
    if (randomSeedBtn) {
      randomSeedBtn.addEventListener('click', () => {
        params.seed = Math.floor(Math.random() * 1_000_000_000);
        const seedEl = byId('pr-seed');
        if (seedEl) seedEl.value = String(params.seed);
        applyUI();
        p.redraw();
      });
    }

    const randomPaletteBtn = byId('pr-random-palette');
    if (randomPaletteBtn) {
      randomPaletteBtn.addEventListener('click', () => {
        params.pa = p.random(0.1, 0.5);
        params.pb = p.random(0.1, 0.5);
        params.pc = p.int(p.random(1, 4));
        params.pd = p.random();
        const paEl = byId('pr-pa');
        const pbEl = byId('pr-pb');
        const pcEl = byId('pr-pc');
        const pdEl = byId('pr-pd');
        if (paEl) paEl.value = String(Math.round(params.pa * 100));
        if (pbEl) pbEl.value = String(Math.round(params.pb * 100));
        if (pcEl) pcEl.value = String(params.pc);
        if (pdEl) pdEl.value = String(Math.round(params.pd * 100));
        const hsEl = byId('pr-hue-start');
        const hrEl = byId('pr-hue-end');
        if (hsEl) hsEl.value = String(Math.floor(p.random(360)));
        if (hrEl) hrEl.value = String(Math.floor(p.random(360)));
        applyUI();
        p.redraw();
      });
    }
  }

  p.setup = () => {
    const container = byId('particle-canvas');
    const w = Math.max(360, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    const canvas = p.createCanvas(w, w);
    if (container) canvas.parent('particle-canvas');
    minWidth = p.min(p.width, p.height);
    p.noLoop();
    applyUI();
    bindControls();
  };

  p.windowResized = () => {
    const container = byId('particle-canvas');
    if (!container) return;
    const w = Math.max(360, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    p.resizeCanvas(w, w);
    minWidth = p.min(p.width, p.height);
    p.redraw();
  };

  p.draw = () => {
    p.randomSeed(params.seed);
    p.blendMode(p.BLEND);
    p.background(params.bg);
    p.colorMode(p.HSB);
    p.rectMode(p.CENTER);

    const cellW = minWidth * params.cellScale / 2 * params.zoom;

    // Keep one stable composition only.
    pattern(p.width / 2, p.height / 2, cellW * 0.5);

    if (params.animate) {
      motion += params.motion;
      p.loop();
    } else {
      p.noLoop();
    }
  };

  function _draw(width, id, depth) {
    const x = p.sin(id * depth * 333.2);
    const y = p.sin(id * depth * 531.1);
    const sourceHue = (p.int(palette(params.pa, params.pb, params.pc, params.pd, x) * 360 + 720) % 360 + 360) % 360;
    const t = sourceHue / 360;
    let hue;
    if (params.hueEnd >= params.hueStart) {
      hue = params.hueStart + t * (params.hueEnd - params.hueStart);
    } else {
      const span = (params.hueEnd + 360) - params.hueStart;
      hue = (params.hueStart + t * span) % 360;
    }
    const bright = Math.max(0, Math.min(100, 100 * params.brightnessMul));

    if (params.strokeMode === 'fill') {
      p.noStroke();
      p.fill(hue, params.saturation, bright, params.alpha);
    } else if (params.strokeMode === 'stroke') {
      p.noFill();
      p.strokeWeight(Math.max(0.5, params.strokeWidth));
      p.stroke(hue, params.saturation, bright, params.alpha);
    } else if (y <= 0) {
      p.noStroke();
      p.fill(hue, params.saturation, bright, params.alpha);
    } else {
      p.noFill();
      p.strokeWeight(Math.max(0.5, params.strokeWidth) + (width / 100) * y);
      p.stroke(hue, params.saturation, bright, params.alpha);
    }

    const radius = fract(p.sin(id * depth * p.TWO_PI + 103.19)) * width;
    if (x < 0) {
      p.rect(0, 0, radius);
    } else {
      p.circle(0, 0, radius);
    }
  }

  function rec(width, d, maxDepth, id, sw, mw) {
    if (maxDepth < d || sw >= mw) return;
    _draw(width, id, d);

    const rot = fract(p.sin(id * d * p.TWO_PI * params.rotFreq)) * p.PI;
    const r = fract(p.sin(id * d * p.TWO_PI * params.radFreq)) + 0.2;
    const ox = width * r;

    p.push();
    p.rotate(rot);
    p.translate(ox, 0);
    rec(width * params.branchA, d + 1, maxDepth, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(0);
    p.translate(ox, 0);
    rec(width * params.branchB, d + 1, maxDepth, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(-rot);
    p.translate(ox, 0);
    rec(width * params.branchC, d + 1, maxDepth, id, sw + ox, mw);
    p.pop();
  }

  function pattern(x, y, width) {
    const id = params.idValue;
    const r = params.radius;
    const n = params.branches;
    const maxDepth = params.depth;

    p.push();
    p.translate(x, y);
    // Move the whole composition as one unit instead of morphing internals.
    p.rotate(motion * 0.02);
    for (let a = 0; a < p.TWO_PI - 1e-3; a += p.TWO_PI / n) {
      p.push();
      p.rotate(a);
      p.translate(r * width, 0);
      rec(width / 2, 1, maxDepth, id, r * width, width);
      p.pop();
    }
    p.pop();
  }

  function palette(a, b, c, d, x) {
    return a + b * p.cos(p.TWO_PI * c * x + d);
  }

  p.mouseWheel = (event) => {
    // Let normal trackpad/page scrolling work.
    // Only zoom with a modifier key while hovering canvas.
    if (!event.shiftKey) return true;

    const zoomEl = byId('pr-zoom');
    if (!zoomEl) return;
    const current = parseInt(zoomEl.value, 10);
    const next = event.deltaY < 0 ? current + 25 : current - 25;
    const min = parseInt(zoomEl.min, 10);
    const max = parseInt(zoomEl.max, 10);
    zoomEl.value = String(Math.max(min, Math.min(max, next)));
    applyUI();
    p.redraw();
    return false;
  };
};

new p5(particleSketch);

