let curveHash = new Map();
let beziers = [];
let grid = [];
let nearPoint = [];
let hEdges = [];
let vEdges = [];
let isPreview = false;

const params = {
  seed: 0,
  gridCount: 170,
  curveCount: 7,
  curveSamples: 110,
  influenceRadius: 16,
  threshold: 0.44,
  blurPasses: 70,
  blurStrength: 0.18,
  prunePasses: 10,
  branchChance: 0.26,
  strokeW: 3,
  taper: 0.4,
  mirrorX: true,
  mirrorY: false,
  bg: '#e7e7e7',
  ink: '#000000'
};

function setup() {
  isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
  if (isPreview) {
    params.gridCount = 110;
    params.curveCount = 5;
    params.blurPasses = 36;
    params.strokeW = 2;
  }

  const canvas = createCanvas(calcWidth(), calcHeight());
  canvas.parent('stigil-canvas');
  pixelDensity(1);
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  bindControls();
  if (!params.seed) randomizeSeed();
  regenerate();
  noLoop();
}

function calcWidth() {
  if (isPreview) return max(220, min(windowWidth, windowHeight));
  return max(360, windowWidth - 440);
}

function calcHeight() {
  if (isPreview) return max(220, min(windowWidth, windowHeight));
  return max(320, windowHeight - 120);
}

function windowResized() {
  resizeCanvas(calcWidth(), calcHeight());
  regenerate();
}

function randomizeSeed() {
  params.seed = floor(random(1_000_000_000));
  const seedEl = document.getElementById('cs-seed');
  if (seedEl) seedEl.value = String(params.seed);
}

function regenerate() {
  randomSeed(int(params.seed));
  noiseSeed(int(params.seed));
  curveHash = new Map();
  beziers = [];
  grid = [];
  nearPoint = [];
  hEdges = [];
  vEdges = [];

  const m = params.influenceRadius * 1.3;
  const rw = () => random(width - m * 2) + m;
  const rh = () => random(height - m * 2) + m;
  for (let i = 0; i < params.curveCount; i++) {
    beziers.push({ x1: rw(), y1: rh(), x2: rw(), y2: rh(), x3: rw(), y3: rh(), x4: rw(), y4: rh() });
  }

  const points = [];
  for (const b of beziers) {
    for (let i = 0; i <= params.curveSamples; i++) {
      const t = i / params.curveSamples;
      const px = bezierPoint(b.x1, b.x2, b.x3, b.x4, t);
      const py = bezierPoint(b.y1, b.y2, b.y3, b.y4, t);
      points.push(createVector(px, py));
      if (params.mirrorX) points.push(createVector(width - px, py));
      if (params.mirrorY) points.push(createVector(px, height - py));
      if (params.mirrorX && params.mirrorY) points.push(createVector(width - px, height - py));
    }
  }

  buildCurveHash(points);
  buildGrid();
  buildEdges();
  pruneDanglingEdges();

  for (let i = 0; i < params.blurPasses; i++) {
    blurGrid(params.blurStrength);
  }
  redraw();
}

function buildCurveHash(points) {
  const cell = max(4, params.influenceRadius);
  for (const p of points) {
    const ix = floor(p.x / cell);
    const iy = floor(p.y / cell);
    const key = `${ix},${iy}`;
    if (!curveHash.has(key)) curveHash.set(key, []);
    curveHash.get(key).push(p);
  }
}

function pointNearCurves(v) {
  const cell = max(4, params.influenceRadius);
  const ix = floor(v.x / cell);
  const iy = floor(v.y / cell);
  const search = 2;
  let minD = 1e9;
  for (let yy = -search; yy <= search; yy++) {
    for (let xx = -search; xx <= search; xx++) {
      const bucket = curveHash.get(`${ix + xx},${iy + yy}`);
      if (!bucket) continue;
      for (const p of bucket) {
        const d = dist(v.x, v.y, p.x, p.y);
        if (d < minD) minD = d;
      }
    }
  }
  if (minD > params.influenceRadius) return 0;
  const q = 1 - minD / params.influenceRadius;
  return constrain(q, 0, 1);
}

function buildGrid() {
  const stepX = width / params.gridCount;
  const stepY = height / params.gridCount;
  for (let y = 0; y <= params.gridCount; y++) {
    const row = [];
    const nearRow = [];
    for (let x = 0; x <= params.gridCount; x++) {
      const v = createVector(x * stepX, y * stepY);
      row.push(v);
      nearRow.push(pointNearCurves(v));
    }
    grid.push(row);
    nearPoint.push(nearRow);
  }
}

function buildEdges() {
  for (let y = 0; y <= params.gridCount; y++) {
    const hr = [];
    for (let x = 0; x < params.gridCount; x++) {
      const a = nearPoint[y][x] > params.threshold;
      const b = nearPoint[y][x + 1] > params.threshold;
      let on = a && b;
      if (!on && (a || b) && random() < params.branchChance * 0.2) on = true;
      hr.push(on);
    }
    hEdges.push(hr);
  }
  for (let y = 0; y < params.gridCount; y++) {
    const vr = [];
    for (let x = 0; x <= params.gridCount; x++) {
      const a = nearPoint[y][x] > params.threshold;
      const b = nearPoint[y + 1][x] > params.threshold;
      let on = a && b;
      if (!on && (a || b) && random() < params.branchChance * 0.2) on = true;
      vr.push(on);
    }
    vEdges.push(vr);
  }
}

function nodeDegree(y, x) {
  let d = 0;
  if (x > 0 && hEdges[y][x - 1]) d++;
  if (x < params.gridCount && hEdges[y][x]) d++;
  if (y > 0 && vEdges[y - 1][x]) d++;
  if (y < params.gridCount && vEdges[y][x]) d++;
  return d;
}

function pruneDanglingEdges() {
  for (let pass = 0; pass < params.prunePasses; pass++) {
    let changed = false;
    for (let y = 0; y <= params.gridCount; y++) {
      for (let x = 0; x < params.gridCount; x++) {
        if (!hEdges[y][x]) continue;
        const a = nodeDegree(y, x);
        const b = nodeDegree(y, x + 1);
        if (a <= 1 || b <= 1) {
          hEdges[y][x] = false;
          changed = true;
        }
      }
    }
    for (let y = 0; y < params.gridCount; y++) {
      for (let x = 0; x <= params.gridCount; x++) {
        if (!vEdges[y][x]) continue;
        const a = nodeDegree(y, x);
        const b = nodeDegree(y + 1, x);
        if (a <= 1 || b <= 1) {
          vEdges[y][x] = false;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function blurGrid(strength) {
  if (strength <= 0) return;
  const next = [];
  for (let y = 0; y <= params.gridCount; y++) {
    const row = [];
    for (let x = 0; x <= params.gridCount; x++) {
      const v = grid[y][x].copy();
      if (x > 0 && x < params.gridCount && y > 0 && y < params.gridCount) {
        if (nearPoint[y][x] > params.threshold) {
          const avg = p5.Vector.add(grid[y - 1][x], grid[y + 1][x]);
          avg.add(grid[y][x - 1]);
          avg.add(grid[y][x + 1]);
          avg.mult(0.25);
          v.lerp(avg, strength);
        }
      }
      row.push(v);
    }
    next.push(row);
  }
  grid = next;
  applyMirrorConstraint();
}

function applyMirrorConstraint() {
  const cx = width * 0.5;
  const cy = height * 0.5;
  if (params.mirrorX) {
    for (let y = 0; y <= params.gridCount; y++) {
      for (let x = 0; x <= floor(params.gridCount / 2); x++) {
        const mx = params.gridCount - x;
        const left = grid[y][x];
        const right = grid[y][mx];
        const mid = (left.x + (2 * cx - right.x)) * 0.5;
        left.x = mid;
        right.x = 2 * cx - mid;
      }
    }
  }
  if (params.mirrorY) {
    for (let y = 0; y <= floor(params.gridCount / 2); y++) {
      const my = params.gridCount - y;
      for (let x = 0; x <= params.gridCount; x++) {
        const top = grid[y][x];
        const bottom = grid[my][x];
        const mid = (top.y + (2 * cy - bottom.y)) * 0.5;
        top.y = mid;
        bottom.y = 2 * cy - mid;
      }
    }
  }
}

function draw() {
  background(params.bg);
  drawEdges();
}

function drawEdges() {
  const ink = color(params.ink);
  stroke(ink);

  for (let y = 0; y <= params.gridCount; y++) {
    for (let x = 0; x < params.gridCount; x++) {
      if (!hEdges[y][x]) continue;
      const a = grid[y][x];
      const b = grid[y][x + 1];
      const n = (nearPoint[y][x] + nearPoint[y][x + 1]) * 0.5;
      const w = max(0.6, params.strokeW * (1 - params.taper + params.taper * n));
      strokeWeight(w);
      line(a.x, a.y, b.x, b.y);
    }
  }
  for (let y = 0; y < params.gridCount; y++) {
    for (let x = 0; x <= params.gridCount; x++) {
      if (!vEdges[y][x]) continue;
      const a = grid[y][x];
      const b = grid[y + 1][x];
      const n = (nearPoint[y][x] + nearPoint[y + 1][x]) * 0.5;
      const w = max(0.6, params.strokeW * (1 - params.taper + params.taper * n));
      strokeWeight(w);
      line(a.x, a.y, b.x, b.y);
    }
  }
}

function bindControls() {
  const byId = (id) => document.getElementById(id);
  const setValue = (id, txt) => {
    const el = byId(id);
    if (el) el.textContent = txt;
  };

  const bindRange = (id, valueId, cb) => {
    const el = byId(id);
    if (!el) return;
    const apply = () => {
      const txt = cb(el.value);
      if (valueId) setValue(valueId, txt);
      regenerate();
    };
    el.addEventListener('input', apply);
  };

  const bindCheck = (id, cb) => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('change', () => {
      cb(el.checked);
      regenerate();
    });
  };

  const seedEl = byId('cs-seed');
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      params.seed = parseInt(seedEl.value || '0', 10) || 0;
      regenerate();
    });
  }
  const seedBtn = byId('cs-random-seed');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      randomizeSeed();
      regenerate();
    });
  }
  const regenBtn = byId('cs-regenerate');
  if (regenBtn) regenBtn.addEventListener('click', regenerate);

  bindRange('cs-grid', 'val-cs-grid', (v) => {
    params.gridCount = parseInt(v, 10);
    return String(params.gridCount);
  });
  bindRange('cs-curves', 'val-cs-curves', (v) => {
    params.curveCount = parseInt(v, 10);
    return String(params.curveCount);
  });
  bindRange('cs-samples', 'val-cs-samples', (v) => {
    params.curveSamples = parseInt(v, 10);
    return String(params.curveSamples);
  });
  bindRange('cs-influence', 'val-cs-influence', (v) => {
    params.influenceRadius = parseInt(v, 10);
    return String(params.influenceRadius);
  });
  bindRange('cs-threshold', 'val-cs-threshold', (v) => {
    params.threshold = parseInt(v, 10) / 100;
    return params.threshold.toFixed(2);
  });
  bindRange('cs-prune', 'val-cs-prune', (v) => {
    params.prunePasses = parseInt(v, 10);
    return String(params.prunePasses);
  });
  bindRange('cs-branch', 'val-cs-branch', (v) => {
    params.branchChance = parseInt(v, 10) / 100;
    return `${v}%`;
  });
  bindRange('cs-blurs', 'val-cs-blurs', (v) => {
    params.blurPasses = parseInt(v, 10);
    return String(params.blurPasses);
  });
  bindRange('cs-blur-strength', 'val-cs-blur-strength', (v) => {
    params.blurStrength = parseInt(v, 10) / 100;
    return params.blurStrength.toFixed(2);
  });
  bindRange('cs-stroke', 'val-cs-stroke', (v) => {
    params.strokeW = parseInt(v, 10);
    return String(params.strokeW);
  });
  bindRange('cs-taper', 'val-cs-taper', (v) => {
    params.taper = parseInt(v, 10) / 100;
    return params.taper.toFixed(2);
  });

  bindCheck('cs-mirror-x', (checked) => { params.mirrorX = checked; });
  bindCheck('cs-mirror-y', (checked) => { params.mirrorY = checked; });

  const bg = byId('cs-bg');
  if (bg) {
    bg.addEventListener('input', () => {
      params.bg = bg.value;
      redraw();
    });
  }
  const ink = byId('cs-ink');
  if (ink) {
    ink.addEventListener('input', () => {
      params.ink = ink.value;
      redraw();
    });
  }
}
