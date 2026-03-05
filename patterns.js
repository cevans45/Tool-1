// Your original sketch, wired to OVRT controls via applyUI

const sketch = (p) => {
  let min_width;

  let PA;
  let PB;
  let PC;
  let PD;

  let SEED;

  function applyUI() {
    const depthEl = document.getElementById('pat-depth');
    const branchesEl = document.getElementById('pat-branches');
    const radiusEl = document.getElementById('pat-radius');
    const paEl = document.getElementById('pat-pa');
    const pbEl = document.getElementById('pat-pb');
    const pcEl = document.getElementById('pat-pc');
    const pdEl = document.getElementById('pat-pd');
    const seedEl = document.getElementById('pat-seed');

    SEED = parseInt(seedEl?.value || '0', 10) || 0;
    PA = paEl ? parseInt(paEl.value, 10) / 100 : 0.3;
    PB = pbEl ? parseInt(pbEl.value, 10) / 100 : 0.3;
    PC = pcEl ? parseInt(pcEl.value, 10) : 2;
    PD = pdEl ? parseInt(pdEl.value, 10) / 100 : 0.5;

    // Also push numeric sliders into labels so UI stays in sync
    const setVal = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    if (depthEl) setVal('val-pat-depth', depthEl.value);
    if (branchesEl) setVal('val-pat-branches', branchesEl.value);
    if (radiusEl) setVal('val-pat-radius', (parseInt(radiusEl.value, 10) / 100).toFixed(2));
    if (paEl) setVal('val-pat-pa', PA.toFixed(2));
    if (pbEl) setVal('val-pat-pb', PB.toFixed(2));
    if (pcEl) setVal('val-pat-pc', String(PC));
    if (pdEl) setVal('val-pat-pd', PD.toFixed(2));
  }

  function bindUIRedraw() {
    const ids = ['pat-depth', 'pat-branches', 'pat-radius', 'pat-pa', 'pat-pb', 'pat-pc', 'pat-pd', 'pat-seed'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        applyUI();
        p.redraw();
      });
    });
  }

  p.setup = () => {
    const container = document.getElementById('pattern-canvas');
    const w = Math.max(320, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    const canvas = p.createCanvas(w, w);
    if (container) canvas.parent('pattern-canvas');

    min_width = p.min(p.width, p.height);

    applyUI();
    SEED = p.random() * 998244353;
    p.randomSeed(SEED);

    bindUIRedraw();
    p.noLoop();
  };

  p.windowResized = () => {
    const container = document.getElementById('pattern-canvas');
    if (!container) return;
    const w = Math.max(320, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    p.resizeCanvas(w, w);
    min_width = p.min(p.width, p.height);
    p.redraw();
  };

  p.draw = () => {
    p.blendMode(p.BLEND);
    p.background(0);
    p.colorMode(p.HSB);
    p.rectMode(p.CENTER);

    const cell_w = min_width * 0.65 / 2;
    for (let x = -1; x <= 1; ++x) {
      for (let y = -1; y <= 1; ++y) {
        pattern(p.width / 2 + cell_w * x, p.height / 2 + cell_w * y, cell_w * 0.5);
      }
    }
    p.noLoop();
  };

  function _draw(width, id, depth) {
    const x = p.sin(id * depth * 333.2);
    const y = p.sin(id * depth * 531.1);
    if (y <= 0) {
      p.noStroke();
      p.fill(
        p.int(palette(PA, PB, PC, PD, x) * 360 + 720) % 360,
        100, 100,
        0.5
      );
    } else {
      p.noFill();
      p.strokeWeight(1 + (width / 100) * y);
      p.stroke(
        p.int(palette(PA, PB, PC, PD, x) * 360 + 720) % 360,
        100, 100,
        0.5
      );
    }
    const radius = p.fract(p.sin(id * depth * p.TWO_PI + 103.19)) * width;
    if (x < 0) {
      p.rect(0, 0, radius);
    } else {
      p.circle(0, 0, radius);
    }
  }

  function rec(x, y, width, d, mxd, id, sw, mw) {
    if (mxd < d || sw >= mw) return;

    _draw(width, id, d);

    const rot = p.fract(p.sin(id * d * p.TWO_PI * 13.21)) * p.PI;
    const r = p.fract(p.sin(id * d * p.TWO_PI * 33.4)) + 0.2;
    const ox = width * r;

    p.push();
    p.rotate(rot);
    p.translate(ox, 0);
    rec(0, 0, width * 0.5, d + 1, mxd, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(0);
    p.translate(ox, 0);
    rec(0, 0, width * 0.5, d + 1, mxd, id, sw + ox, mw);
    p.pop();

    p.push();
    p.rotate(-rot);
    p.translate(ox, 0);
    rec(0, 0, width * 0.6, d + 1, mxd, id, sw + ox, mw);
    p.pop();
  }

  function pattern(x, y, width) {
    const depthEl = document.getElementById('pat-depth');
    const branchesEl = document.getElementById('pat-branches');
    const radiusEl = document.getElementById('pat-radius');

    const max_depth = depthEl ? parseInt(depthEl.value, 10) : 7;
    const n = branchesEl ? parseInt(branchesEl.value, 10) : 5;
    const r = radiusEl ? parseInt(radiusEl.value, 10) / 100 : 0.15;

    const id = p.fract(p.random() * 19.19 + p.sin((x + y * 33.4) * 3.7));

    p.push();
    p.translate(x, y);

    for (let a = 0; a < p.TWO_PI - 1e-3; a += p.TWO_PI / n) {
      p.push();
      p.rotate(a);
      p.translate(r * width, 0);
      rec(0, 0, width / 2, 1, max_depth, id, r * width, width);
      p.pop();
    }
    p.pop();
  }

  function palette(a, b, c, d, x) {
    return a + b * p.cos(p.TWO_PI * c * x + d);
  }
};

new p5(sketch);

