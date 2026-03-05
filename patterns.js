const patternsSketch = (p) => {
  let minWidth;

  const params = {
    seed: 123456,
    depth: 7,
    branches: 5,
    radiusFactor: 0.15,
    pa: 0.3,
    pb: 0.3,
    pc: 2,
    pd: 0.5,
    tiles: 'single', // single | row | grid
  };

  p.setup = () => {
    const container = document.getElementById('pattern-canvas');
    const w = Math.max(320, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    const canvas = p.createCanvas(w, w);
    if (container) canvas.parent('pattern-canvas');

    minWidth = p.min(p.width, p.height);
    bindControls();
    p.noLoop();
    drawPattern();
  };

  p.windowResized = () => {
    const container = document.getElementById('pattern-canvas');
    if (!container) return;
    const w = Math.max(320, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    p.resizeCanvas(w, w);
    minWidth = p.min(p.width, p.height);
    drawPattern();
  };

  function bindControls() {
    const byId = (id) => document.getElementById(id);

    const depthEl = byId('pat-depth');
    const branchesEl = byId('pat-branches');
    const radiusEl = byId('pat-radius');
    const paEl = byId('pat-pa');
    const pbEl = byId('pat-pb');
    const pcEl = byId('pat-pc');
    const pdEl = byId('pat-pd');
    const tilesEl = byId('pat-tiles');
    const seedEl = byId('pat-seed');
    const randSeedBtn = byId('pat-random-seed');
    const randPaletteBtn = byId('pat-random-palette');

    const setVal = (id, text) => {
      const el = byId(id);
      if (el) el.textContent = text;
    };

    if (depthEl) {
      depthEl.addEventListener('input', () => {
        params.depth = parseInt(depthEl.value, 10);
        setVal('val-pat-depth', depthEl.value);
        drawPattern();
      });
    }

    if (branchesEl) {
      branchesEl.addEventListener('input', () => {
        params.branches = parseInt(branchesEl.value, 10);
        setVal('val-pat-branches', branchesEl.value);
        drawPattern();
      });
    }

    if (radiusEl) {
      radiusEl.addEventListener('input', () => {
        params.radiusFactor = parseInt(radiusEl.value, 10) / 100;
        setVal('val-pat-radius', params.radiusFactor.toFixed(2));
        drawPattern();
      });
    }

    if (paEl) {
      paEl.addEventListener('input', () => {
        params.pa = parseInt(paEl.value, 10) / 100;
        setVal('val-pat-pa', params.pa.toFixed(2));
        drawPattern();
      });
    }

    if (pbEl) {
      pbEl.addEventListener('input', () => {
        params.pb = parseInt(pbEl.value, 10) / 100;
        setVal('val-pat-pb', params.pb.toFixed(2));
        drawPattern();
      });
    }

    if (pcEl) {
      pcEl.addEventListener('input', () => {
        params.pc = parseInt(pcEl.value, 10);
        setVal('val-pat-pc', pcEl.value);
        drawPattern();
      });
    }

    if (pdEl) {
      pdEl.addEventListener('input', () => {
        params.pd = parseInt(pdEl.value, 10) / 100;
        setVal('val-pat-pd', params.pd.toFixed(2));
        drawPattern();
      });
    }

    if (tilesEl) {
      tilesEl.addEventListener('change', () => {
        params.tiles = tilesEl.value;
        drawPattern();
      });
    }

    if (seedEl) {
      seedEl.addEventListener('input', () => {
        params.seed = parseInt(seedEl.value, 10) || 0;
        drawPattern();
      });
    }

    if (randSeedBtn) {
      randSeedBtn.addEventListener('click', () => {
        params.seed = Math.floor(Math.random() * 1_000_000_000);
        if (seedEl) seedEl.value = String(params.seed);
        drawPattern();
      });
    }

    if (randPaletteBtn) {
      randPaletteBtn.addEventListener('click', () => {
        params.pa = p.random(0.1, 0.5);
        params.pb = p.random(0.1, 0.5);
        params.pc = p.int(p.random(1, 3));
        params.pd = p.random();

        if (paEl) paEl.value = Math.round(params.pa * 100);
        if (pbEl) pbEl.value = Math.round(params.pb * 100);
        if (pcEl) pcEl.value = params.pc;
        if (pdEl) pdEl.value = Math.round(params.pd * 100);

        setVal('val-pat-pa', params.pa.toFixed(2));
        setVal('val-pat-pb', params.pb.toFixed(2));
        setVal('val-pat-pc', String(params.pc));
        setVal('val-pat-pd', params.pd.toFixed(2));

        drawPattern();
      });
    }

    setVal('val-pat-depth', String(params.depth));
    setVal('val-pat-branches', String(params.branches));
    setVal('val-pat-radius', params.radiusFactor.toFixed(2));
    setVal('val-pat-pa', params.pa.toFixed(2));
    setVal('val-pat-pb', params.pb.toFixed(2));
    setVal('val-pat-pc', String(params.pc));
    setVal('val-pat-pd', params.pd.toFixed(2));
  }

  function drawPattern() {
    p.randomSeed(params.seed);
    p.blendMode(p.BLEND);
    p.background(0);
    p.colorMode(p.HSB);
    p.rectMode(p.CENTER);

    const cellW = minWidth * 0.65 / 2;

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

    p.redraw();
  }

  function _draw(width, id, depth) {
    const x = p.sin(id * depth * 333.2);
    const y = p.sin(id * depth * 531.1);
    const hue = (p.int(palette(params.pa, params.pb, params.pc, params.pd, x) * 360 + 720) % 360);

    if (y <= 0) {
      p.noStroke();
      p.fill(hue, 100, 100, 0.5);
    } else {
      p.noFill();
      p.strokeWeight(1 + (width / 100) * y);
      p.stroke(hue, 100, 100, 0.5);
    }

    const radius = p.fract(p.sin(id * depth * p.TWO_PI + 103.19)) * width;
    if (x < 0) {
      p.rect(0, 0, radius);
    } else {
      p.circle(0, 0, radius);
    }
  }

  function rec(x, y, width, d, maxD, id, sw, mw) {
    if (maxD < d || sw >= mw) return;

    _draw(width, id, d);

    const rot = p.fract(p.sin(id * d * p.TWO_PI * 13.21)) * p.PI;
    const r = p.fract(p.sin(id * d * p.TWO_PI * 33.4)) + 0.2;
    const ox = width * r;

    p.push();
    p.rotate(rot);
    p.translate(ox, 0);
    rec(0, 0, width * 0.5, d + 1, maxD, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(0);
    p.translate(ox, 0);
    rec(0, 0, width * 0.5, d + 1, maxD, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(-rot);
    p.translate(ox, 0);
    rec(0, 0, width * 0.6, d + 1, maxD, id, sw + ox, mw);
    p.pop();
  }

  function pattern(x, y, width) {
    const maxDepth = params.depth;
    const id = p.fract(p.random() * 19.19 + p.sin((x + y * 33.4) * 3.7));
    const r = params.radiusFactor;
    const n = params.branches;

    p.push();
    p.translate(x, y);

    for (let a = 0; a < p.TWO_PI - 1e-3; a += p.TWO_PI / n) {
      p.push();
      p.rotate(a);
      p.translate(r * width, 0);
      rec(0, 0, width / 2, 1, maxDepth, id, r * width, width);
      p.pop();
    }

    p.pop();
  }

  function palette(a, b, c, d, x) {
    return a + b * p.cos(p.TWO_PI * c * x + d);
  }
};

new p5(patternsSketch);

