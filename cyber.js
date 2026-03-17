let curveHash = new Map();
let paths = [];
let isPreview = false;
let beziers = [];
let grid = [];
let curvePoints = [];
let nearPoint = [];
let hEdges = [];
let vEdges = [];
let blurs = 0;

let drawBuffer;
let drawPoints = [];
let isDrawing = false;

const params = {
  seed: 0,
  textureMode: 'none',
  textureStrength: 0.8,
  textureDensity: 0.72,
  textureSize: 0.56,
  textureOpacity: 0.82,
  textureJitter: 0.22,
  curveCount: 7,
  curveSamples: 110,
  influenceRadius: 20,
  threshold: 0.44,
  blurPasses: 62,
  blurStrength: 0.18,
  prunePasses: 7,
  branchChance: 0.35,
  strokeW: 2,
  taper: 0.68,
  fillAmount: 0.72,
  strokeEnabled: true,
  drawMode: true,
  drawOperation: 'ink',
  mirrorX: true,
  mirrorY: false,
  bg: '#e7e7e7',
  ink: '#000000',
  sketchRoughness: 4,
  sketchDensity: 6,
  sketchReach: 70
};

function setup() {
  isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
  if (isPreview) {
    params.textureStrength = 0.55;
    params.textureDensity = 0.60;
    params.textureOpacity = 0.70;
    params.curveCount = 5;
    params.blurPasses = 28;
    params.strokeW = 3;
    params.drawMode = false;
  }

  const canvas = createCanvas(calcWidth(), calcHeight());
  canvas.parent('stigil-canvas');
  pixelDensity(displayDensity());
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  drawBuffer = createGraphics(width, height);
  drawBuffer.pixelDensity(displayDensity());

  bindControls();
  if (!params.seed) randomizeSeed();

  if (params.drawMode) {
    drawGuideline();
    redraw();
  } else {
    regenerate();
  }
  noLoop();
}

function calcWidth() {
  if (isPreview) return max(220, min(windowWidth, windowHeight));
  return max(360, windowWidth - 340);
}

function calcHeight() {
  if (isPreview) return max(220, min(windowWidth, windowHeight));
  return max(320, windowHeight - 120);
}

function windowResized() {
  resizeCanvas(calcWidth(), calcHeight());
  drawBuffer.resizeCanvas(width, height);
  if (params.drawMode) {
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

function buildCurveHashFromPaths(sourcePaths) {
  if (!sourcePaths) sourcePaths = paths;
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

/* ===== PATH EXTRACTION FROM SKETCH ===== */

function getDrawnPathSegments() {
  const segments = [];
  let current = [];
  for (const p of drawPoints) {
    if (p === null) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else {
      current.push(createVector(p.x, p.y));
    }
  }
  if (current.length > 1) segments.push(current);

  const out = [];
  for (const seg of segments) {
    const mirrored = createMirroredPaths(seg);
    for (const m of mirrored) out.push(m);
  }
  return out;
}

/* ===== DRAW LOOP ===== */

function draw() {
  background(params.bg);

  if (params.drawMode) {
    image(drawBuffer, 0, 0);

    const sketchPaths = getDrawnPathSegments();
    if (sketchPaths.length > 0) {
      drawTextureOnPaths(sketchPaths);
    }

    if (params.mirrorX) drawGuidelineOnMain();
    return;
  }

  buildCurveHashFromPaths(paths);
  drawGeneratedPaths();
  drawTextureOnPaths(paths);
}

function drawGuidelineOnMain() {
  const ctx = drawingContext;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
  ctx.restore();
}

function drawGuideline() {
  if (!params.mirrorX) return;
  redraw();
}

/* ===== MYCELIUM SCRATCH-LINE DRAWING ENGINE ===== */

function scratchLine(ctx, x1, y1, x2, y2, d) {
  const distFactor = Math.max(0.2, (params.sketchReach - d) / 10);
  const finalThickness = params.strokeW * distFactor;
  const jitter = params.sketchRoughness + (finalThickness * 0.8);
  const w = drawBuffer.width;
  const h = drawBuffer.height;

  if (params.drawOperation === 'ink') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = params.ink;
    ctx.fillStyle = params.ink;
  } else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  }

  for (let i = 0; i < params.sketchDensity; i++) {
    const jx1 = (Math.random() - 0.5) * jitter;
    const jy1 = (Math.random() - 0.5) * jitter;
    const jx2 = (Math.random() - 0.5) * jitter;
    const jy2 = (Math.random() - 0.5) * jitter;

    if (Math.random() > 0.15) {
      const px1 = x1 + jx1, py1 = y1 + jy1;
      const px2 = x2 + jx2, py2 = y2 + jy2;

      ctx.beginPath();
      ctx.lineWidth = finalThickness;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'bevel';
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);

      if (params.mirrorX) {
        ctx.moveTo(w - px1, py1);
        ctx.lineTo(w - px2, py2);
      }
      if (params.mirrorY) {
        ctx.moveTo(px1, h - py1);
        ctx.lineTo(px2, h - py2);
      }
      if (params.mirrorX && params.mirrorY) {
        ctx.moveTo(w - px1, h - py1);
        ctx.lineTo(w - px2, h - py2);
      }

      ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
}

function addDrawPoint(x, y) {
  const p = { x, y };
  drawPoints.push(p);

  const ctx = drawBuffer.drawingContext;
  const startIndex = Math.max(0, drawPoints.length - 250);

  for (let i = startIndex; i < drawPoints.length - 1; i++) {
    const prev = drawPoints[i];
    if (!prev) continue;

    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const d = Math.hypot(dx, dy);
    const dynamicConnect = params.sketchReach + params.strokeW;

    if (d < dynamicConnect) {
      scratchLine(ctx, prev.x, prev.y, p.x, p.y, d);
    }
  }
}

function clearDrawBuffer() {
  drawPoints = [];
  isDrawing = false;
  drawBuffer.clear();
  redraw();
}

/* ===== GENERATED MODE RENDERING ===== */

function drawGeneratedPaths() {
  if (!params.strokeEnabled) return;
  const ink = color(params.ink);
  stroke(ink);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxCenterD = max(width, height) * 0.55;

  for (const path of paths) {
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

  for (const path of paths) {
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

  drawSpikes();
  drawInteriorFill();
}

function drawSpikes() {
  const cx = width * 0.5;
  const cy = height * 0.5;
  noStroke();
  fill(params.ink);

  for (const path of paths) {
    if (path.length < 8) continue;
    const step = max(3, floor(map(params.branchChance, 0, 1, 16, 5)));
    for (let i = step; i < path.length - step; i += step) {
      const gate = hash01(path[i].x * 0.013 + i, path[i].y * 0.017, params.seed * 0.0001);
      if (gate > (0.16 + params.branchChance * 0.54)) continue;

      const p = path[i];
      const prev = path[i - 1];
      const next = path[i + 1];
      const tan = p5.Vector.sub(next, prev);
      if (tan.magSq() < 1e-4) continue;
      tan.normalize();
      const normal = createVector(-tan.y, tan.x);

      const centerDir = createVector(p.x - cx, p.y - cy);
      const outward = centerDir.dot(normal) >= 0 ? 1 : -1;
      const density = localPointDensity(p);
      const len = (params.influenceRadius * (0.5 + params.fillAmount * 1.7)) * (0.5 + density * 0.9);
      const baseW = ((p.sw != null ? p.sw : params.strokeW) * (0.26 + params.fillAmount * 0.2));

      const tip = createVector(
        p.x + normal.x * outward * len,
        p.y + normal.y * outward * len
      );
      const left = createVector(
        p.x + tan.x * baseW,
        p.y + tan.y * baseW
      );
      const right = createVector(
        p.x - tan.x * baseW,
        p.y - tan.y * baseW
      );

      beginShape();
      vertex(left.x, left.y);
      vertex(tip.x, tip.y);
      vertex(right.x, right.y);
      endShape(CLOSE);
    }
  }
}

function drawInteriorFill() {
  if (params.fillAmount <= 0) return;
  noStroke();
  fill(params.ink);
  for (const path of paths) {
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

/* ===== TEXTURE EFFECTS (generated mode) ===== */

function drawTextureOnPaths(sourcePaths) {
  if (params.textureMode === 'none' || params.textureStrength <= 0) return;
  if (!sourcePaths || sourcePaths.length === 0) return;
  if (params.textureMode === 'grain') {
    drawGrainTexture(sourcePaths);
    return;
  }
  rebuildGridSystemFromPaths(sourcePaths);
  if (params.textureMode === 'grid') drawEdgesTexture('grid');
  else if (params.textureMode === 'dots') drawEdgesTexture('dots');
  else if (params.textureMode === 'pixel') drawEdgesTexture('pixel');
}

function rebuildGridSystemFromPaths(sourcePaths) {
  const k = constrain(params.textureStrength, 0, 1);
  curvePoints = [];
  grid = [];
  nearPoint = [];
  hEdges = [];
  vEdges = [];
  blurs = 0;
  curveHash = new Map();
  beziers = [];

  const stride = max(1, floor(map(k, 0, 1, 5, 1)));
  for (const path of sourcePaths) {
    for (let i = 0; i < path.length; i += stride) {
      curvePoints.push(path[i].copy());
    }
  }
  buildCurveHashLegacy();

  const gridCount = floor(map(k, 0, 1, 120, 240));
  const step = width / gridCount;
  for (let y = 0; y <= gridCount; y++) {
    const row = [];
    const nearRow = [];
    for (let x = 0; x <= gridCount; x++) {
      const v = createVector(x * step, y * step);
      row.push(v);
      nearRow.push(pointNearCurvesLegacy(v));
    }
    grid.push(row);
    nearPoint.push(nearRow);
  }

  buildEdgesLegacy();
  for (let i = 0; i < max(1, floor(map(k, 0, 1, 2, 8))); i++) {
    pruneDanglingEdgesLegacy();
  }

  const blurMax = floor(map(k, 0, 1, 0, 18));
  const blurAmt = max(0.02, params.blurStrength * 0.35);
  while (blurs < blurMax) {
    blurGridLegacy(grid, nearPoint, blurAmt);
    blurs++;
  }
}

function buildCurveHashLegacy() {
  const cell = max(4, params.influenceRadius);
  curveHash = new Map();
  for (const p of curvePoints) {
    const ix = floor(p.x / cell);
    const iy = floor(p.y / cell);
    const key = `${ix},${iy}`;
    if (!curveHash.has(key)) curveHash.set(key, []);
    curveHash.get(key).push(p);
  }
}

function pointNearCurvesLegacy(v) {
  const cell = max(4, params.influenceRadius);
  const ix = floor(v.x / cell);
  const iy = floor(v.y / cell);
  const r2 = params.influenceRadius * params.influenceRadius;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const key = `${ix + dx},${iy + dy}`;
      const bucket = curveHash.get(key);
      if (!bucket) continue;
      for (const p of bucket) {
        const dxp = v.x - p.x;
        const dyp = v.y - p.y;
        if (dxp * dxp + dyp * dyp < r2) return true;
      }
    }
  }
  return false;
}

function buildEdgesLegacy() {
  for (let y = 0; y < grid.length; y++) {
    const r = [];
    for (let x = 0; x < grid[y].length - 1; x++) {
      r.push(nearPoint[y][x] && nearPoint[y][x + 1]);
    }
    hEdges.push(r);
  }
  for (let y = 0; y < grid.length - 1; y++) {
    const r = [];
    for (let x = 0; x < grid[y].length; x++) {
      r.push(nearPoint[y][x] && nearPoint[y + 1][x]);
    }
    vEdges.push(r);
  }
}

function pruneDanglingEdgesLegacy() {
  const degree = grid.map((r) => r.map(() => 0));
  for (let y = 0; y < hEdges.length; y++) {
    for (let x = 0; x < hEdges[y].length; x++) {
      if (hEdges[y][x]) { degree[y][x]++; degree[y][x + 1]++; }
    }
  }
  for (let y = 0; y < vEdges.length; y++) {
    for (let x = 0; x < vEdges[y].length; x++) {
      if (vEdges[y][x]) { degree[y][x]++; degree[y + 1][x]++; }
    }
  }
  for (let y = 0; y < hEdges.length; y++) {
    for (let x = 0; x < hEdges[y].length; x++) {
      if (hEdges[y][x] && (degree[y][x] < 2 || degree[y][x + 1] < 2)) hEdges[y][x] = false;
    }
  }
  for (let y = 0; y < vEdges.length; y++) {
    for (let x = 0; x < vEdges[y].length; x++) {
      if (vEdges[y][x] && (degree[y][x] < 2 || degree[y + 1][x] < 2)) vEdges[y][x] = false;
    }
  }
}

function blurGridLegacy(g, mask, amount) {
  const h = g.length;
  const w = g[0].length;
  const cx = Array.from({ length: h }, () => Array(w));
  const cy = Array.from({ length: h }, () => Array(w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cx[y][x] = g[y][x].x;
      cy[y][x] = g[y][x].y;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y][x]) continue;
      let sx = 0, sy = 0, n = 0;
      if (mask[y][x]) { sx += cx[y][x]; sy += cy[y][x]; n++; }
      if (mask[y - 1][x]) { sx += cx[y - 1][x]; sy += cy[y - 1][x]; n++; }
      if (mask[y + 1][x]) { sx += cx[y + 1][x]; sy += cy[y + 1][x]; n++; }
      if (mask[y][x - 1]) { sx += cx[y][x - 1]; sy += cy[y][x - 1]; n++; }
      if (mask[y][x + 1]) { sx += cx[y][x + 1]; sy += cy[y][x + 1]; n++; }
      if (n > 0) {
        g[y][x].x += (sx / n - g[y][x].x) * amount;
        g[y][x].y += (sy / n - g[y][x].y) * amount;
      }
    }
  }
}

function drawEdgesTexture(mode) {
  const k = constrain(params.textureStrength, 0, 1);
  const d = constrain(params.textureDensity, 0, 1);
  const s = constrain(params.textureSize, 0, 1);
  const o = constrain(params.textureOpacity, 0, 1);
  const j = constrain(params.textureJitter, 0, 1);
  const baseInk = color(params.ink);
  const alpha = map(k * o, 0, 1, 20, 255);
  if (mode === 'dots' || mode === 'pixel') {
    noStroke();
    fill(red(baseInk), green(baseInk), blue(baseInk), alpha);
  } else {
    stroke(red(baseInk), green(baseInk), blue(baseInk), alpha);
    strokeWeight(map(k * (0.4 + 0.6 * s), 0, 1, 0.7, 2.8));
  }
  const edgeStride = max(1, floor(map(d, 0, 1, 5, 1)));
  const jitterAmp = map(j, 0, 1, 0, 2.4);

  for (let y = 0; y < hEdges.length; y++) {
    for (let x = 0; x < hEdges[y].length; x++) {
      if (!hEdges[y][x]) continue;
      if (((x + y) % edgeStride) !== 0) continue;
      const a = grid[y][x];
      const b = grid[y][x + 1];
      const mx = (a.x + b.x) * 0.5 + random(-jitterAmp, jitterAmp);
      const my = (a.y + b.y) * 0.5 + random(-jitterAmp, jitterAmp);
      if (mode === 'grid') { line(a.x, a.y, b.x, b.y); }
      else if (mode === 'dots') { circle(mx, my, map(k * (0.4 + 0.6 * s), 0, 1, 0.9, 6.5)); }
      else if (mode === 'pixel') { rectMode(CENTER); rect(mx, my, map(k * (0.4 + 0.6 * s), 0, 1, 1.2, 7.2), map(k * (0.4 + 0.6 * s), 0, 1, 1.2, 7.2)); rectMode(CORNER); }
    }
  }
  for (let y = 0; y < vEdges.length; y++) {
    for (let x = 0; x < vEdges[y].length; x++) {
      if (!vEdges[y][x]) continue;
      if (((x + y) % edgeStride) !== 0) continue;
      const a = grid[y][x];
      const b = grid[y + 1][x];
      const mx = (a.x + b.x) * 0.5 + random(-jitterAmp, jitterAmp);
      const my = (a.y + b.y) * 0.5 + random(-jitterAmp, jitterAmp);
      if (mode === 'grid') { line(a.x, a.y, b.x, b.y); }
      else if (mode === 'dots') { circle(mx, my, map(k * (0.4 + 0.6 * s), 0, 1, 0.9, 6.5)); }
      else if (mode === 'pixel') { rectMode(CENTER); rect(mx, my, map(k * (0.4 + 0.6 * s), 0, 1, 1.2, 7.2), map(k * (0.4 + 0.6 * s), 0, 1, 1.2, 7.2)); rectMode(CORNER); }
    }
  }
}

function drawGrainTexture(sourcePaths) {
  const k = constrain(params.textureStrength, 0, 1);
  const d = constrain(params.textureDensity, 0, 1);
  const s = constrain(params.textureSize, 0, 1);
  const o = constrain(params.textureOpacity, 0, 1);
  const jt = constrain(params.textureJitter, 0, 1);
  const baseInk = color(params.ink);
  stroke(red(baseInk), green(baseInk), blue(baseInk), map(k * o, 0, 1, 8, 135));
  strokeWeight(map(s, 0, 1, 0.8, 2.2));
  const stride = max(1, floor(map(d, 0, 1, 4, 1)));
  const spread = map(jt, 0, 1, 0.9, 4.8);
  for (const path of sourcePaths) {
    for (let i = 0; i < path.length; i += stride) {
      const p = path[i];
      const samples = floor(map(k * d, 0, 1, 1, 8));
      for (let j = 0; j < samples; j++) {
        const ox = random(-spread, spread);
        const oy = random(-spread, spread);
        point(p.x + ox, p.y + oy);
      }
    }
  }
}

/* ===== MOUSE / TOUCH HANDLERS ===== */

function mousePressed() {
  if (!params.drawMode) return;
  if (!isInsideCanvas(mouseX, mouseY)) return;
  isDrawing = true;
  const noiseScale = params.strokeW * 0.8;
  const nx = (Math.random() - 0.5) * noiseScale;
  const ny = (Math.random() - 0.5) * noiseScale;
  addDrawPoint(mouseX + nx, mouseY + ny);
  redraw();
}

function mouseDragged() {
  if (!params.drawMode) return;
  if (!isInsideCanvas(mouseX, mouseY)) return;
  if (!isDrawing) return;
  const noiseScale = params.strokeW * 0.8;
  const nx = (Math.random() - 0.5) * noiseScale;
  const ny = (Math.random() - 0.5) * noiseScale;
  addDrawPoint(mouseX + nx, mouseY + ny);
  redraw();
  return false;
}

function mouseReleased() {
  if (!params.drawMode) return;
  isDrawing = false;
  drawPoints.push(null);
}

function isInsideCanvas(x, y) {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function hash01(a, b, c) {
  const n = sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return n - floor(n);
}

function exportPng() {
  saveCanvas('cyber_stigilism', 'png');
}

function keyPressed() {
  if (key === '1') {
    params.drawOperation = 'ink';
  } else if (key === '2') {
    params.drawOperation = 'cut';
  } else if (key === 'm' || key === 'M') {
    params.mirrorX = !params.mirrorX;
    const mx = document.getElementById('cs-mirror-x');
    if (mx) mx.checked = params.mirrorX;
    redraw();
  } else if (key === ' ' || keyCode === 32) {
    clearDrawBuffer();
    return false;
  } else if (key === 's' || key === 'S') {
    exportPng();
  }

  const inkBtn = document.getElementById('cs-mode-ink');
  const cutBtn = document.getElementById('cs-mode-cut');
  if (inkBtn) inkBtn.classList.toggle('is-active', params.drawOperation === 'ink');
  if (cutBtn) cutBtn.classList.toggle('is-active', params.drawOperation === 'cut');
}

/* ===== UI BINDINGS ===== */

function bindControls() {
  const byId = (id) => document.getElementById(id);
  const setValue = (id, txt) => {
    const el = byId(id);
    if (el) el.textContent = txt;
  };

  let updateTimer = null;
  const runUpdate = () => {
    if (params.drawMode) {
      redraw();
    } else {
      regenerate();
    }
  };
  const requestUpdate = (immediate = false) => {
    if (immediate) {
      if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
      runUpdate();
      return;
    }
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => { updateTimer = null; runUpdate(); }, 50);
  };

  const bindRange = (id, valueId, cb) => {
    const el = byId(id);
    if (!el) return;
    const apply = () => {
      const txt = cb(el.value);
      if (valueId) setValue(valueId, txt);
      requestUpdate(false);
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', () => requestUpdate(true));
  };

  const bindCheck = (id, cb) => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('change', () => {
      cb(el.checked);
      requestUpdate(true);
    });
  };

  const updateDrawOperationUI = () => {
    const inkBtn = byId('cs-mode-ink');
    const cutBtn = byId('cs-mode-cut');
    if (inkBtn) inkBtn.classList.toggle('is-active', params.drawOperation === 'ink');
    if (cutBtn) cutBtn.classList.toggle('is-active', params.drawOperation === 'cut');
  };

  const updateTextureModeUI = () => {
    const mode = params.textureMode;
    const rowStrength = byId('row-cs-texture-strength');
    const rowDensity = byId('row-cs-texture-density');
    const rowSize = byId('row-cs-texture-size');
    const rowOpacity = byId('row-cs-texture-opacity');
    const rowJitter = byId('row-cs-texture-jitter');
    const setRow = (row, visible) => { if (row) row.style.display = visible ? 'flex' : 'none'; };
    if (mode === 'none') {
      setRow(rowStrength, false); setRow(rowDensity, false); setRow(rowSize, false);
      setRow(rowOpacity, false); setRow(rowJitter, false);
      return;
    }
    setRow(rowStrength, true); setRow(rowDensity, true); setRow(rowSize, true);
    setRow(rowOpacity, true); setRow(rowJitter, true);
    if (mode === 'grid') setRow(rowJitter, false);
  };

  const updateStrokeUI = () => {
    const enabled = !!params.strokeEnabled;
    const taperEl = byId('cs-taper');
    const fillEl = byId('cs-fill');
    const rowTaper = byId('row-cs-taper');
    const rowFill = byId('row-cs-fill');
    if (taperEl) taperEl.disabled = !enabled;
    if (fillEl) fillEl.disabled = !enabled;
    if (rowTaper) rowTaper.classList.toggle('control-row--disabled', !enabled);
    if (rowFill) rowFill.classList.toggle('control-row--disabled', !enabled);
  };

  const updateModeUI = () => {
    const isSketch = params.drawMode;
    const sketchCore = byId('section-sketch-core');
    const structure = byId('section-structure');
    const smoothing = byId('section-smoothing');
    const style = byId('section-style');
    const sketchBtn = byId('cs-mode-sketch');
    const genBtn = byId('cs-mode-generate');
    if (sketchCore) sketchCore.style.display = isSketch ? '' : 'none';
    if (structure) structure.style.display = isSketch ? 'none' : '';
    if (smoothing) smoothing.style.display = isSketch ? 'none' : '';
    if (style) style.style.display = isSketch ? 'none' : '';
    if (sketchBtn) sketchBtn.classList.toggle('is-active', isSketch);
    if (genBtn) genBtn.classList.toggle('is-active', !isSketch);
  };

  const setDrawMode = (sketch) => {
    params.drawMode = sketch;
    updateModeUI();
    if (!sketch) regenerate();
    else redraw();
  };

  const sketchModeBtn = byId('cs-mode-sketch');
  const genModeBtn = byId('cs-mode-generate');
  if (sketchModeBtn) sketchModeBtn.addEventListener('click', () => setDrawMode(true));
  if (genModeBtn) genModeBtn.addEventListener('click', () => setDrawMode(false));
  updateModeUI();

  const seedEl = byId('cs-seed');
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      params.seed = parseInt(seedEl.value || '0', 10) || 0;
      requestUpdate(true);
    });
  }
  const seedBtn = byId('cs-random-seed');
  if (seedBtn) seedBtn.addEventListener('click', () => { randomizeSeed(); requestUpdate(true); });

  const regenBtn = byId('cs-regenerate');
  if (regenBtn) regenBtn.addEventListener('click', () => requestUpdate(true));

  const exportGenBtn = byId('cs-export-gen');
  if (exportGenBtn) exportGenBtn.addEventListener('click', () => exportPng());

  const mirrorXGen = byId('cs-mirror-x-gen');
  if (mirrorXGen) {
    mirrorXGen.checked = params.mirrorX;
    mirrorXGen.addEventListener('change', () => {
      params.mirrorX = mirrorXGen.checked;
      const mx = byId('cs-mirror-x');
      if (mx) mx.checked = params.mirrorX;
      requestUpdate(true);
    });
  }

  const inkBtn = byId('cs-mode-ink');
  const cutBtn = byId('cs-mode-cut');
  if (inkBtn) inkBtn.addEventListener('click', () => { params.drawOperation = 'ink'; updateDrawOperationUI(); });
  if (cutBtn) cutBtn.addEventListener('click', () => { params.drawOperation = 'cut'; updateDrawOperationUI(); });
  updateDrawOperationUI();

  const clearBtn = byId('cs-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => clearDrawBuffer());

  const exportBtn = byId('cs-export');
  if (exportBtn) exportBtn.addEventListener('click', () => exportPng());

  const textureModeEl = byId('cs-texture-mode');
  if (textureModeEl) {
    textureModeEl.value = params.textureMode;
    textureModeEl.addEventListener('change', () => {
      params.textureMode = textureModeEl.value;
      updateTextureModeUI();
      requestUpdate(true);
    });
  }

  bindRange('cs-texture-strength', 'val-cs-texture-strength', (v) => { params.textureStrength = parseInt(v, 10) / 100; return params.textureStrength.toFixed(2); });
  bindRange('cs-texture-density', 'val-cs-texture-density', (v) => { params.textureDensity = parseInt(v, 10) / 100; return params.textureDensity.toFixed(2); });
  bindRange('cs-texture-size', 'val-cs-texture-size', (v) => { params.textureSize = parseInt(v, 10) / 100; return params.textureSize.toFixed(2); });
  bindRange('cs-texture-opacity', 'val-cs-texture-opacity', (v) => { params.textureOpacity = parseInt(v, 10) / 100; return params.textureOpacity.toFixed(2); });
  bindRange('cs-texture-jitter', 'val-cs-texture-jitter', (v) => { params.textureJitter = parseInt(v, 10) / 100; return params.textureJitter.toFixed(2); });
  updateTextureModeUI();

  bindRange('cs-curves', 'val-cs-curves', (v) => { params.curveCount = parseInt(v, 10); return String(params.curveCount); });
  bindRange('cs-samples', 'val-cs-samples', (v) => { params.curveSamples = parseInt(v, 10); return String(params.curveSamples); });
  bindRange('cs-influence', 'val-cs-influence', (v) => { params.influenceRadius = parseInt(v, 10); return String(params.influenceRadius); });
  bindRange('cs-threshold', 'val-cs-threshold', (v) => { params.threshold = parseInt(v, 10) / 100; return params.threshold.toFixed(2); });
  bindRange('cs-prune', 'val-cs-prune', (v) => { params.prunePasses = parseInt(v, 10); return String(params.prunePasses); });
  bindRange('cs-branch', 'val-cs-branch', (v) => { params.branchChance = parseInt(v, 10) / 100; return `${v}%`; });
  bindRange('cs-blurs', 'val-cs-blurs', (v) => { params.blurPasses = parseInt(v, 10); return String(params.blurPasses); });
  bindRange('cs-blur-strength', 'val-cs-blur-strength', (v) => { params.blurStrength = parseInt(v, 10) / 100; return params.blurStrength.toFixed(2); });
  bindRange('cs-stroke', 'val-cs-stroke', (v) => { params.strokeW = parseInt(v, 10); return String(params.strokeW); });
  bindRange('cs-taper', 'val-cs-taper', (v) => { params.taper = parseInt(v, 10) / 100; return params.taper.toFixed(2); });
  bindRange('cs-fill', 'val-cs-fill', (v) => { params.fillAmount = parseInt(v, 10) / 100; return params.fillAmount.toFixed(2); });

  bindCheck('cs-stroke-enabled', (checked) => { params.strokeEnabled = checked; });
  const strokeEnabledEl = byId('cs-stroke-enabled');
  if (strokeEnabledEl) {
    strokeEnabledEl.checked = params.strokeEnabled;
    strokeEnabledEl.addEventListener('change', updateStrokeUI);
  }
  updateStrokeUI();

  bindCheck('cs-mirror-x', (checked) => {
    params.mirrorX = checked;
    const mxg = byId('cs-mirror-x-gen');
    if (mxg) mxg.checked = checked;
    redraw();
  });
  bindCheck('cs-mirror-y', (checked) => { params.mirrorY = checked; });

  bindRange('cs-sketch-roughness', 'val-cs-sketch-roughness', (v) => { params.sketchRoughness = parseInt(v, 10); return String(params.sketchRoughness); });
  bindRange('cs-sketch-density', 'val-cs-sketch-density', (v) => { params.sketchDensity = parseInt(v, 10); return String(params.sketchDensity); });
  bindRange('cs-sketch-reach', 'val-cs-sketch-reach', (v) => { params.sketchReach = parseInt(v, 10); return String(params.sketchReach); });

  const bg = byId('cs-bg');
  if (bg) bg.addEventListener('input', () => { params.bg = bg.value; redraw(); });
  const ink = byId('cs-ink');
  if (ink) ink.addEventListener('input', () => { params.ink = ink.value; redraw(); });

  const bgSketch = byId('cs-bg-sketch');
  if (bgSketch) {
    bgSketch.value = params.bg;
    bgSketch.addEventListener('input', () => {
      params.bg = bgSketch.value;
      if (bg) bg.value = bgSketch.value;
      redraw();
    });
  }
  const inkSketch = byId('cs-ink-sketch');
  if (inkSketch) {
    inkSketch.value = params.ink;
    inkSketch.addEventListener('input', () => {
      params.ink = inkSketch.value;
      if (ink) ink.value = inkSketch.value;
      redraw();
    });
  }
}
