let curveHash = new Map();
let paths = [];
let drawnPaths = [];
let activeStroke = null;
let isPreview = false;

const params = {
  seed: 0,
  gridCount: 170, // Repurposed as optional texture density.
  curveCount: 7,
  curveSamples: 110,
  influenceRadius: 20,
  threshold: 0.44,
  blurPasses: 62,
  blurStrength: 0.18,
  prunePasses: 7,
  branchChance: 0.22,
  strokeW: 6,
  taper: 0.68,
  fillAmount: 0.58,
  drawMode: true,
  mirrorX: true,
  mirrorY: false,
  bg: '#e7e7e7',
  ink: '#000000'
};

function setup() {
  isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
  if (isPreview) {
    params.gridCount = 120;
    params.curveCount = 5;
    params.blurPasses = 28;
    params.strokeW = 3;
    params.drawMode = false;
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
  if (params.drawMode) {
    buildCurveHashFromPaths(getRenderablePaths());
    redraw();
  } else {
    regenerate();
  }
}

function randomizeSeed() {
  params.seed = floor(random(1_000_000_000));
  const seedEl = document.getElementById('cs-seed');
  if (seedEl) seedEl.value = String(params.seed);
}

function regenerate() {
  if (params.drawMode) {
    buildCurveHashFromPaths(getRenderablePaths());
    redraw();
    return;
  }

  randomSeed(int(params.seed));
  noiseSeed(int(params.seed));
  paths = [];
  curveHash = new Map();

  const basePaths = [];
  const m = params.influenceRadius * 2.0;
  for (let i = 0; i < params.curveCount; i++) {
    const side = random() < 0.5 ? -1 : 1;
    const cx = width * 0.5 + side * random(width * 0.06, width * 0.26);
    const x1 = constrain(cx + side * random(-40, 80), m, width - m);
    const y1 = random(height * 0.22, height * 0.72);
    const x2 = constrain(cx + side * random(-80, 120), m, width - m);
    const y2 = random(height * 0.1, height * 0.85);
    const x3 = constrain(cx + side * random(-120, 120), m, width - m);
    const y3 = random(height * 0.12, height * 0.88);
    const x4 = constrain(cx + side * random(-50, 100), m, width - m);
    const y4 = random(height * 0.2, height * 0.9);

    const path = [];
    for (let s = 0; s <= params.curveSamples; s++) {
      const t = s / params.curveSamples;
      path.push(createVector(
        bezierPoint(x1, x2, x3, x4, t),
        bezierPoint(y1, y2, y3, y4, t)
      ));
    }
    basePaths.push(path);
  }

  for (const path of basePaths) {
    const mirrored = createMirroredPaths(path);
    for (const p of mirrored) paths.push(warpPath(p));
  }

  addBranches();
  smoothPaths();
  prunePaths();
  buildCurveHashFromPaths();
  redraw();
}

function createMirroredPaths(path) {
  const out = [];
  const transforms = [{ mx: false, my: false }];
  if (params.mirrorX) transforms.push({ mx: true, my: false });
  if (params.mirrorY) transforms.push({ mx: false, my: true });
  if (params.mirrorX && params.mirrorY) transforms.push({ mx: true, my: true });

  for (const t of transforms) {
    out.push(path.map((p) => {
      const q = createVector(
        t.mx ? width - p.x : p.x,
        t.my ? height - p.y : p.y
      );
      if (p.sw != null) q.sw = p.sw;
      return q;
    }));
  }
  return out;
}

function warpPath(path) {
  const warped = [];
  const amp = params.influenceRadius * 0.55;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const prev = path[max(0, i - 1)];
    const next = path[min(path.length - 1, i + 1)];
    const tan = p5.Vector.sub(next, prev);
    if (tan.magSq() < 1e-4) tan.set(1, 0);
    tan.normalize();
    const normal = createVector(-tan.y, tan.x);

    const nx = params.mirrorX ? min(p.x, width - p.x) : p.x;
    const ny = params.mirrorY ? min(p.y, height - p.y) : p.y;
    const n = noise(nx * 0.01, ny * 0.01, params.seed * 0.00001);
    const spine = params.mirrorX ? (width * 0.5 - p.x) * 0.015 : 0;
    const w = (n - 0.5) * 2 * amp + spine;
    const tangentSkew = (noise(nx * 0.015, ny * 0.015, 90 + params.seed * 0.00002) - 0.5) * params.influenceRadius * 0.18;
    warped.push(createVector(
      p.x + normal.x * w + tan.x * tangentSkew,
      p.y + normal.y * w + tan.y * tangentSkew
    ));
  }
  return warped;
}

function addBranches() {
  const base = paths.slice();
  const branchProb = params.branchChance * 0.34;
  for (const path of base) {
    const step = max(5, floor(path.length / 11));
    for (let i = step; i < path.length - step; i += step) {
      if (random() > branchProb) continue;
      const a = path[i - 1];
      const b = path[i + 1];
      const root = path[i];
      const tan = p5.Vector.sub(b, a);
      if (tan.magSq() < 1e-4) continue;
      tan.normalize();
      const normal = createVector(-tan.y, tan.x).mult(random() < 0.5 ? -1 : 1);

      const len = params.influenceRadius * random(0.8, 2.4);
      const segs = floor(random(5, 13));
      const branch = [root.copy()];
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const bend = (noise((root.x + s * 7) * 0.02, (root.y + s * 7) * 0.02, params.seed * 0.00003) - 0.5) * 2;
        const p = createVector(
          root.x + normal.x * len * t + tan.x * len * 0.23 * bend * t,
          root.y + normal.y * len * t + tan.y * len * 0.23 * bend * t
        );
        branch.push(p);
      }
      for (const mirrored of createMirroredPaths(branch)) {
        paths.push(mirrored);
      }
    }
  }
}

function smoothPaths() {
  const passes = min(200, params.blurPasses);
  const strength = constrain(params.blurStrength, 0, 1) * 0.55;
  for (let pass = 0; pass < passes; pass++) {
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p];
      if (path.length < 4) continue;
      const next = [path[0].copy()];
      for (let i = 1; i < path.length - 1; i++) {
        const prev = path[i - 1];
        const cur = path[i];
        const nxt = path[i + 1];
        const avg = createVector((prev.x + nxt.x) * 0.5, (prev.y + nxt.y) * 0.5);
        const v = p5.Vector.lerp(cur, avg, strength);
        next.push(v);
      }
      next.push(path[path.length - 1].copy());
      paths[p] = next;
    }
  }
}

function prunePaths() {
  const keep = [];
  const pruneN = constrain(params.prunePasses / 24, 0, 1);
  const keepChance = 1 - pruneN * 0.55;
  const minLen = max(4, floor(map(pruneN, 0, 1, 3, 11)));

  for (const path of paths) {
    if (path.length <= minLen) continue;
    if (path.length >= params.curveSamples * 0.8 || random() < keepChance) {
      const trim = floor(random(0, map(pruneN, 0, 1, 0, 5)));
      const start = min(trim, path.length - 2);
      const end = max(start + 2, path.length - trim);
      keep.push(path.slice(start, end));
    }
  }
  paths = keep;
}

function buildCurveHashFromPaths(sourcePaths = getRenderablePaths()) {
  curveHash = new Map();
  const cell = max(6, params.influenceRadius * 0.9);
  for (const path of sourcePaths) {
    for (let i = 0; i < path.length; i += 2) {
      const p = path[i];
      const ix = floor(p.x / cell);
      const iy = floor(p.y / cell);
      const key = `${ix},${iy}`;
      if (!curveHash.has(key)) curveHash.set(key, []);
      curveHash.get(key).push(p);
    }
  }
}

function pointNearPaths(v) {
  const cell = max(6, params.influenceRadius * 0.9);
  const ix = floor(v.x / cell);
  const iy = floor(v.y / cell);
  let minD = 1e9;
  for (let yy = -2; yy <= 2; yy++) {
    for (let xx = -2; xx <= 2; xx++) {
      const bucket = curveHash.get(`${ix + xx},${iy + yy}`);
      if (!bucket) continue;
      for (const p of bucket) {
        const d = dist(v.x, v.y, p.x, p.y);
        if (d < minD) minD = d;
      }
    }
  }
  if (minD > params.influenceRadius * 1.6) return 0;
  return constrain(1 - minD / (params.influenceRadius * 1.6), 0, 1);
}

function draw() {
  background(params.bg);
  buildCurveHashFromPaths(getRenderablePaths());
  drawPaths();
  drawGridTexture();
}

function drawPaths() {
  const ink = color(params.ink);
  stroke(ink);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxCenterD = max(width, height) * 0.55;

  // Pass 1: heavy body
  for (const path of getRenderablePaths()) {
    if (path.length < 2) continue;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const t = i / (path.length - 1);
      const bell = sin(PI * t);
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const centerBoost = 1 - constrain(dist(mx, my, cx, cy) / maxCenterD, 0, 1);
      const speedBase = (((a.sw != null ? a.sw : params.strokeW) + (b.sw != null ? b.sw : params.strokeW)) * 0.5);
      const w = max(0.9, speedBase * (0.28 + params.taper * bell + centerBoost * 0.9));
      strokeWeight(w);
      line(a.x, a.y, b.x, b.y);
    }
  }

  // Pass 2: crisp spine so forms stay sharp, not muddy.
  for (const path of getRenderablePaths()) {
    if (path.length < 2) continue;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const t = i / (path.length - 1);
      const bell = sin(PI * t);
      const speedBase = (((a.sw != null ? a.sw : params.strokeW) + (b.sw != null ? b.sw : params.strokeW)) * 0.5);
      const w = max(0.55, speedBase * (0.12 + bell * 0.28));
      strokeWeight(w);
      line(a.x, a.y, b.x, b.y);
    }
  }

  drawInteriorFill();
}

function drawGridTexture() {
  const density = constrain(params.gridCount, 80, 260);
  const step = map(density, 80, 260, 22, 6);
  const alphaBase = map(density, 80, 260, 0, 42);
  if (alphaBase < 1) return;

  const baseInk = color(params.ink);
  stroke(red(baseInk), green(baseInk), blue(baseInk), alphaBase);
  strokeWeight(1);
  for (let y = 0; y <= height; y += step) {
    for (let x = 0; x <= width; x += step) {
      const n = pointNearPaths(createVector(x, y));
      if (n < params.threshold * 0.55) continue;
      if (((floor(x / step) + floor(y / step)) & 1) === 0) {
        point(x, y);
      } else {
        line(x - 1, y, x + 1, y);
      }
    }
  }
}

function localPointDensity(v) {
  const cell = max(6, params.influenceRadius * 0.9);
  const ix = floor(v.x / cell);
  const iy = floor(v.y / cell);
  let count = 0;
  const r2 = (params.influenceRadius * 0.8) * (params.influenceRadius * 0.8);
  for (let yy = -1; yy <= 1; yy++) {
    for (let xx = -1; xx <= 1; xx++) {
      const bucket = curveHash.get(`${ix + xx},${iy + yy}`);
      if (!bucket) continue;
      for (const p of bucket) {
        const dx = v.x - p.x;
        const dy = v.y - p.y;
        if (dx * dx + dy * dy <= r2) count++;
      }
    }
  }
  return constrain(count / 24, 0, 1);
}

function drawInteriorFill() {
  if (params.fillAmount <= 0) return;
  const sourcePaths = getRenderablePaths();
  noStroke();
  fill(params.ink);
  for (const path of sourcePaths) {
    if (path.length < 4) continue;
    for (let i = 2; i < path.length - 2; i += 2) {
      const p = path[i];
      const d = localPointDensity(p);
      if (d < 0.28) continue;
      const base = p.sw != null ? p.sw : params.strokeW;
      const r = base * (0.18 + params.fillAmount * d * 0.95);
      if (r > 0.7) circle(p.x, p.y, r * 2);
    }
  }
}

function bindControls() {
  const byId = (id) => document.getElementById(id);
  const setValue = (id, txt) => {
    const el = byId(id);
    if (el) el.textContent = txt;
  };

  const requestUpdate = () => {
    if (params.drawMode) {
      buildCurveHashFromPaths(getRenderablePaths());
      redraw();
    } else {
      regenerate();
    }
  };

  const bindRange = (id, valueId, cb) => {
    const el = byId(id);
    if (!el) return;
    const apply = () => {
      const txt = cb(el.value);
      if (valueId) setValue(valueId, txt);
      requestUpdate();
    };
    el.addEventListener('input', apply);
  };

  const bindCheck = (id, cb) => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('change', () => {
      cb(el.checked);
      requestUpdate();
    });
  };

  const seedEl = byId('cs-seed');
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      params.seed = parseInt(seedEl.value || '0', 10) || 0;
      requestUpdate();
    });
  }
  const seedBtn = byId('cs-random-seed');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      randomizeSeed();
      requestUpdate();
    });
  }
  const regenBtn = byId('cs-regenerate');
  if (regenBtn) regenBtn.addEventListener('click', requestUpdate);

  const drawModeEl = byId('cs-draw-mode');
  if (drawModeEl) {
    drawModeEl.checked = params.drawMode;
    drawModeEl.addEventListener('change', () => {
      params.drawMode = !!drawModeEl.checked;
      if (!params.drawMode && paths.length === 0) regenerate();
      requestUpdate();
    });
  }
  const clearBtn = byId('cs-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      drawnPaths = [];
      activeStroke = null;
      requestUpdate();
    });
  }

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
  bindRange('cs-fill', 'val-cs-fill', (v) => {
    params.fillAmount = parseInt(v, 10) / 100;
    return params.fillAmount.toFixed(2);
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

function getRenderablePaths() {
  if (!params.drawMode) return paths;
  const out = [];
  for (const path of drawnPaths) {
    const mirrored = createMirroredPaths(path);
    for (const p of mirrored) out.push(p);
  }
  return out;
}

function isInsideCanvas(x, y) {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function mousePressed() {
  if (!params.drawMode) return;
  if (!isInsideCanvas(mouseX, mouseY)) return;
  const first = createVector(mouseX, mouseY);
  first.sw = params.strokeW * 1.2;
  activeStroke = [first];
  drawnPaths.push(activeStroke);
  redraw();
}

function mouseDragged() {
  if (!params.drawMode || !activeStroke) return false;
  if (!isInsideCanvas(mouseX, mouseY)) return false;
  const last = activeStroke[activeStroke.length - 1];
  if (!last || dist(last.x, last.y, mouseX, mouseY) >= 1.8) {
    const d = last ? dist(last.x, last.y, mouseX, mouseY) : 0;
    const dt = max(1, deltaTime || 16);
    const speed = d / dt; // px per ms
    const speedNorm = constrain(map(speed, 0.02, 1.2, 0, 1), 0, 1);
    const target = params.strokeW * lerp(1.75, 0.38, speedNorm); // slower->thicker, faster->thinner
    const prevW = last && last.sw != null ? last.sw : params.strokeW;
    const sw = lerp(prevW, target, 0.45);
    const p = createVector(mouseX, mouseY);
    p.sw = sw;
    activeStroke.push(p);
    redraw();
  }
  return false;
}

function mouseReleased() {
  if (!params.drawMode) return;
  activeStroke = null;
}
