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
    tiles: 'single', // single | row | grid
    animate: true,
    motion: 0.2,
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
    const tilesEl = byId('pr-tiles');
    const animateEl = byId('pr-animate');
    const motionEl = byId('pr-motion');

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
    params.tiles = tilesEl?.value || 'single';
    params.animate = !!animateEl?.checked;
    params.motion = (parseInt(motionEl?.value || '20', 10)) / 100;

    setVal('val-pr-pa', params.pa.toFixed(2));
    setVal('val-pr-pb', params.pb.toFixed(2));
    setVal('val-pr-pc', String(params.pc));
    setVal('val-pr-pd', params.pd.toFixed(2));
    setVal('val-pr-depth', String(params.depth));
    setVal('val-pr-branches', String(params.branches));
    setVal('val-pr-radius', params.radius.toFixed(2));
    setVal('val-pr-id', params.idValue.toFixed(2));
    setVal('val-pr-cell', Math.round(params.cellScale * 100) + '%');
    setVal('val-pr-motion', params.motion.toFixed(2));
  }

  function bindControls() {
    const ids = ['pr-seed', 'pr-pa', 'pr-pb', 'pr-pc', 'pr-pd', 'pr-depth', 'pr-branches', 'pr-radius', 'pr-id', 'pr-cell', 'pr-motion'];
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
    p.background(0);
    p.colorMode(p.HSB);
    p.rectMode(p.CENTER);

    const cellW = minWidth * params.cellScale / 2;

    if (params.tiles === 'single') {
      pattern(p.width / 2, p.height / 2, cellW * 0.5);
    } else if (params.tiles === 'row') {
      for (let x = -1; x <= 1; ++x) {
        pattern(p.width / 2 + cellW * x, p.height / 2, cellW * 0.5);
      }
    } else {
      for (let x = -1; x <= 1; ++x) {
        for (let y = -1; y <= 1; ++y) {
          pattern(p.width / 2 + cellW * x, p.height / 2 + cellW * y, cellW * 0.5);
        }
      }
    }

    if (params.animate) {
      motion += params.motion;
      p.loop();
    } else {
      p.noLoop();
    }
  };

  function _draw(width, id, depth) {
    const x = p.sin(id * depth * 333.2 + motion * 0.05);
    const y = p.sin(id * depth * 531.1 + motion * 0.08);
    const hue = (p.int(palette(params.pa, params.pb, params.pc, params.pd, x) * 360 + 720) % 360);

    if (y <= 0) {
      p.noStroke();
      p.fill(hue, 100, 100, 0.5);
    } else {
      p.noFill();
      p.strokeWeight(1 + width / 100 * y);
      p.stroke(hue, 100, 100, 0.5);
    }

    const radius = fract(p.sin(id * depth * p.TWO_PI + 103.19 + motion * 0.01)) * width;
    if (x < 0) {
      p.rect(0, 0, radius);
    } else {
      p.circle(0, 0, radius);
    }
  }

  function rec(width, d, maxDepth, id, sw, mw) {
    if (maxDepth < d || sw >= mw) return;
    _draw(width, id, d);

    const rot = fract(p.sin(id * d * p.TWO_PI * 13.21 + motion * 0.01)) * p.PI;
    const r = fract(p.sin(id * d * p.TWO_PI * 33.4 + motion * 0.01)) + 0.2;
    const ox = width * r;

    p.push();
    p.rotate(rot);
    p.translate(ox, 0);
    rec(width * 0.5, d + 1, maxDepth, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(0);
    p.translate(ox, 0);
    rec(width * 0.5, d + 1, maxDepth, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(-rot);
    p.translate(ox, 0);
    rec(width * 0.6, d + 1, maxDepth, id, sw + ox, mw);
    p.pop();
  }

  function pattern(x, y, width) {
    const id = params.idValue;
    const r = params.radius;
    const n = params.branches;
    const maxDepth = params.depth;

    p.push();
    p.translate(x, y);
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
};

new p5(particleSketch);

