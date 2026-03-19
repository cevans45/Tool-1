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
let undoStack = [];

const params = {
  seed: 0,
  textureMode: 'none',
  textureStrength: 0.8,
  textureDensity: 0.72,
  textureSize: 0.56,
  textureOpacity: 0.82,
  textureJitter: 0.22,
  curveCount: 5,
  spread: 50,
  branching: 30,
  influenceRadius: 20,
  blurStrength: 0.18,
  strokeW: 2,
  drawMode: true,
  drawOperation: 'ink',
  mirrorX: true,
  mirrorY: false,
  bg: '#ffffff',
  ink: '#000000',
  textureColor: '#000000',
  fillEnabled: true,
  outlineEnabled: false,
  outlineColor: '#888888',
  outlineWidth: 2,
  sketchRoughness: 4,
  sketchDensity: 6,
  sketchReach: 35
};

function setup() {
  isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
  if (isPreview) {
    params.textureStrength = 0.55;
    params.textureDensity = 0.60;
    params.textureOpacity = 0.70;
    params.curveCount = 5;
    params.strokeW = 3;
    params.drawMode = false;
  }

  const canvas = createCanvas(calcWidth(), calcHeight());
  canvas.parent('sigil-canvas');
  pixelDensity(displayDensity());
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  drawBuffer = createGraphics(width, height);
  drawBuffer.pixelDensity(displayDensity());

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    }
  });

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

/* ===== GENERATE MODE ===== */

function regenerate() {
  if (params.drawMode) { redraw(); return; }

  randomSeed(int(params.seed));
  noiseSeed(int(params.seed));
  paths = [];
  curveHash = new Map();

  const sp = constrain(params.spread / 100, 0.1, 1);
  const halfW = width * 0.5;
  const margin = height * 0.12;

  const halfPaths = [];
  for (let i = 0; i < params.curveCount; i++) {
    const yCenter = params.curveCount === 1
      ? height * 0.5
      : map(i, 0, params.curveCount - 1, margin, height - margin);

    const startX = halfW + random(2, 12);
    const endX = halfW + random(width * sp * 0.06, width * sp * 0.3);
    const startY = yCenter + random(-height * 0.04, height * 0.04);
    const endY = yCenter + random(-height * sp * 0.22, height * sp * 0.22);

    const cx1 = lerp(startX, endX, 0.33) + random(-18, 18) * sp;
    const cy1 = lerp(startY, endY, 0.33) + random(-28, 28) * sp;
    const cx2 = lerp(startX, endX, 0.66) + random(-18, 18) * sp;
    const cy2 = lerp(startY, endY, 0.66) + random(-28, 28) * sp;

    const path = [];
    const steps = 80;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      path.push(createVector(
        bezierPoint(startX, cx1, cx2, endX, t),
        bezierPoint(startY, cy1, cy2, endY, t)
      ));
    }
    halfPaths.push(path);
  }

  if (params.branching > 0) addBranchesToList(halfPaths);

  const warped = halfPaths.map(p => warpPath(p));

  for (let pass = 0; pass < 25; pass++) {
    for (const path of warped) {
      if (path.length < 4) continue;
      for (let i = 1; i < path.length - 1; i++) {
        const prev = path[i - 1], cur = path[i], nxt = path[i + 1];
        cur.x += ((prev.x + nxt.x) * 0.5 - cur.x) * 0.25;
        cur.y += ((prev.y + nxt.y) * 0.5 - cur.y) * 0.25;
      }
    }
  }

  for (const path of warped) {
    const mirrored = createMirroredPaths(path);
    for (const p of mirrored) paths.push(p);
  }

  renderPathsToBuffer(paths);
  buildCurveHashFromPaths(paths);
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
      return q;
    }));
  }
  return out;
}

function warpPath(path) {
  const warped = [];
  const amp = 14;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const prev = path[max(0, i - 1)];
    const next = path[min(path.length - 1, i + 1)];
    const tan = p5.Vector.sub(next, prev);
    if (tan.magSq() < 1e-4) tan.set(1, 0);
    tan.normalize();
    const normal = createVector(-tan.y, tan.x);
    const n = noise(p.x * 0.012, p.y * 0.012, params.seed * 0.00001);
    const w = (n - 0.5) * 2 * amp;
    warped.push(createVector(p.x + normal.x * w, p.y + normal.y * w));
  }
  return warped;
}

function addBranchesToList(pathList) {
  const branchProb = (params.branching / 100) * 0.25;
  const base = pathList.slice();
  for (const path of base) {
    const step = max(5, floor(path.length / 7));
    for (let i = step; i < path.length - step; i += step) {
      if (random() > branchProb) continue;
      const root = path[i];
      const a = path[i - 1];
      const b = path[i + 1];
      const tan = p5.Vector.sub(b, a);
      if (tan.magSq() < 1e-4) continue;
      tan.normalize();
      const normal = createVector(-tan.y, tan.x).mult(random() < 0.5 ? -1 : 1);
      const len = random(18, 60);
      const segs = floor(random(4, 9));
      const branch = [root.copy()];
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        branch.push(createVector(
          root.x + normal.x * len * t + tan.x * random(-5, 5) * t,
          root.y + normal.y * len * t + tan.y * random(-5, 5) * t
        ));
      }
      pathList.push(branch);
    }
  }
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
  image(drawBuffer, 0, 0);

  const activePaths = params.drawMode ? getDrawnPathSegments() : paths;
  if (activePaths.length > 0) {
    drawTextureOnPaths(activePaths);
  }

  if (params.drawMode && params.mirrorX) drawGuidelineOnMain();
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

/* ===== DETERMINISTIC PRNG ===== */

function makeRng(seed) {
  let s = seed | 0 || 1;
  return function() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/* ===== MYCELIUM SCRATCH-LINE DRAWING ENGINE ===== */

function scratchLine(ctx, x1, y1, x2, y2, d, mirror, colorOverride, widthAdd) {
  const reach = mirror ? params.sketchReach : Math.max(params.sketchReach, 100);
  const distFactor = Math.max(0.2, (reach - d) / 10);
  const finalThickness = params.strokeW * distFactor + (widthAdd || 0);
  const roughness = params.sketchRoughness;
  const roughFactor = Math.min(roughness / 20, 1);
  const jitter = roughFactor * roughFactor * (6 + finalThickness * 0.8);
  const passes = params.sketchDensity;
  const w = width;
  const h = height;
  const useRound = roughFactor < 0.25;
  const skipChance = roughFactor * roughFactor * 0.15;

  const seed = (Math.round(x1 * 73) * 374761 + Math.round(y1 * 73) * 668265 +
                Math.round(x2 * 73) * 214748 + Math.round(y2 * 73) * 110351) | 0;
  const rng = makeRng(seed);

  const drawColor = colorOverride || params.ink;
  if (params.drawOperation === 'ink') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = drawColor;
    ctx.fillStyle = drawColor;
  } else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  }

  for (let i = 0; i < passes; i++) {
    const jx1 = (rng() - 0.5) * jitter;
    const jy1 = (rng() - 0.5) * jitter;
    const jx2 = (rng() - 0.5) * jitter;
    const jy2 = (rng() - 0.5) * jitter;

    if (rng() > skipChance) {
      const px1 = x1 + jx1, py1 = y1 + jy1;
      const px2 = x2 + jx2, py2 = y2 + jy2;

      ctx.beginPath();
      ctx.lineWidth = finalThickness;
      ctx.lineCap = useRound ? 'round' : 'square';
      ctx.lineJoin = useRound ? 'round' : 'bevel';
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);

      if (mirror) {
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
      }

      ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
}

function drawConnections(ctx, connections, mirror, colorOverride, widthAdd) {
  for (const c of connections) {
    scratchLine(ctx, c.px, c.py, c.x, c.y, c.d, mirror, colorOverride, widthAdd);
  }
}

function addDrawPoint(x, y) {
  const p = { x, y };
  drawPoints.push(p);

  const ctx = drawBuffer.drawingContext;
  const startIndex = Math.max(0, drawPoints.length - 250);
  const dynamicConnect = params.sketchReach + params.strokeW;

  const conns = [];
  for (let i = startIndex; i < drawPoints.length - 1; i++) {
    const prev = drawPoints[i];
    if (!prev) continue;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d < dynamicConnect) {
      conns.push({ px: prev.x, py: prev.y, x: p.x, y: p.y, d });
    }
  }

  const ow = params.outlineWidth * 2;
  if (params.outlineEnabled) drawConnections(ctx, conns, true, params.outlineColor, ow);
  if (params.fillEnabled) drawConnections(ctx, conns, true, null, 0);
}

function renderPathsToBuffer(pathList) {
  drawBuffer.clear();
  const ctx = drawBuffer.drawingContext;
  const savedOp = params.drawOperation;
  params.drawOperation = 'ink';

  const ow = params.outlineWidth * 2;

  if (params.outlineEnabled) {
    for (const path of pathList) {
      if (path.length < 2) continue;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        scratchLine(ctx, a.x, a.y, b.x, b.y, d, false, params.outlineColor, ow);
      }
    }
  }

  if (params.fillEnabled) {
    for (const path of pathList) {
      if (path.length < 2) continue;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        scratchLine(ctx, a.x, a.y, b.x, b.y, d, false, null, 0);
      }
    }
  }

  params.drawOperation = savedOp;
}

function buildSketchConnections() {
  const segments = [];
  let current = [];
  for (const p of drawPoints) {
    if (p === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length > 0) segments.push(current);

  const all = [];
  const dynamicConnect = params.sketchReach + params.strokeW;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      const lookback = Math.max(0, i - 249);
      for (let j = lookback; j < i; j++) {
        const prev = seg[j];
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (d < dynamicConnect) {
          all.push({ px: prev.x, py: prev.y, x: p.x, y: p.y, d });
        }
      }
    }
  }
  return all;
}

function reRenderSketch() {
  drawBuffer.clear();
  const ctx = drawBuffer.drawingContext;
  const savedOp = params.drawOperation;
  params.drawOperation = 'ink';

  const conns = buildSketchConnections();
  const ow = params.outlineWidth * 2;
  if (params.outlineEnabled) drawConnections(ctx, conns, true, params.outlineColor, ow);
  if (params.fillEnabled) drawConnections(ctx, conns, true, null, 0);

  params.drawOperation = savedOp;
  redraw();
}

function clearDrawBuffer() {
  drawPoints = [];
  undoStack = [];
  isDrawing = false;
  drawBuffer.clear();
  redraw();
}

function undo() {
  if (undoStack.length === 0) return;
  const prevLen = undoStack.pop();
  drawPoints.length = prevLen;
  if (drawPoints.length > 0) {
    reRenderSketch();
  } else {
    drawBuffer.clear();
    redraw();
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

/* ===== TEXTURE EFFECTS ===== */

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
  const baseInk = color(params.textureColor);
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
  const baseInk = color(params.textureColor);
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
  undoStack.push(drawPoints.length);
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
  saveCanvas('cyber_sigilism', 'png');
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
      if (drawPoints.length > 0) reRenderSketch();
      else redraw();
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
    const rowColor = byId('row-cs-texture-color');
    const rowStrength = byId('row-cs-texture-strength');
    const rowDensity = byId('row-cs-texture-density');
    const rowSize = byId('row-cs-texture-size');
    const rowOpacity = byId('row-cs-texture-opacity');
    const rowJitter = byId('row-cs-texture-jitter');
    const setRow = (row, visible) => { if (row) row.style.display = visible ? 'flex' : 'none'; };
    if (mode === 'none') {
      setRow(rowColor, false); setRow(rowStrength, false); setRow(rowDensity, false);
      setRow(rowSize, false); setRow(rowOpacity, false); setRow(rowJitter, false);
      return;
    }
    setRow(rowColor, true); setRow(rowStrength, true); setRow(rowDensity, true);
    setRow(rowSize, true); setRow(rowOpacity, true); setRow(rowJitter, true);
    if (mode === 'grid') setRow(rowJitter, false);
  };

  const updateModeUI = () => {
    const isSketch = params.drawMode;
    const sketchCore = byId('section-sketch-core');
    const structure = byId('section-structure');
    const sketchBtn = byId('cs-mode-sketch');
    const genBtn = byId('cs-mode-generate');
    if (sketchCore) sketchCore.style.display = isSketch ? '' : 'none';
    if (structure) structure.style.display = isSketch ? 'none' : '';
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
  bindRange('cs-spread', 'val-cs-spread', (v) => { params.spread = parseInt(v, 10); return String(params.spread); });
  bindRange('cs-branching', 'val-cs-branching', (v) => { params.branching = parseInt(v, 10); return String(params.branching); });
  bindRange('cs-stroke', 'val-cs-stroke', (v) => { params.strokeW = parseInt(v, 10); return String(params.strokeW); });

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

  const updateOutlineUI = () => {
    const rowWidth = byId('row-cs-outline-width');
    const rowColor = byId('row-cs-outline-color');
    const show = params.outlineEnabled;
    if (rowWidth) rowWidth.style.display = show ? 'flex' : 'none';
    if (rowColor) rowColor.style.display = show ? 'flex' : 'none';
  };

  bindCheck('cs-fill-enabled', (checked) => { params.fillEnabled = checked; });
  bindCheck('cs-outline-enabled', (checked) => {
    params.outlineEnabled = checked;
    updateOutlineUI();
  });
  updateOutlineUI();

  bindRange('cs-outline-width', 'val-cs-outline-width', (v) => { params.outlineWidth = parseInt(v, 10); return String(params.outlineWidth); });

  const outlineColorEl = byId('cs-outline-color');
  if (outlineColorEl) {
    outlineColorEl.value = params.outlineColor;
    outlineColorEl.addEventListener('input', () => { params.outlineColor = outlineColorEl.value; requestUpdate(false); });
    outlineColorEl.addEventListener('change', () => requestUpdate(true));
  }

  const bg = byId('cs-bg');
  if (bg) {
    bg.addEventListener('input', () => { params.bg = bg.value; requestUpdate(false); });
    bg.addEventListener('change', () => requestUpdate(true));
  }
  const ink = byId('cs-ink');
  if (ink) {
    ink.addEventListener('input', () => { params.ink = ink.value; requestUpdate(false); });
    ink.addEventListener('change', () => requestUpdate(true));
  }

  const texColor = byId('cs-texture-color');
  if (texColor) {
    texColor.value = params.textureColor;
    texColor.addEventListener('input', () => { params.textureColor = texColor.value; requestUpdate(false); });
    texColor.addEventListener('change', () => requestUpdate(true));
  }

  const bgSketch = byId('cs-bg-sketch');
  if (bgSketch) {
    bgSketch.value = params.bg;
    bgSketch.addEventListener('input', () => {
      params.bg = bgSketch.value;
      if (bg) bg.value = bgSketch.value;
      requestUpdate(false);
    });
    bgSketch.addEventListener('change', () => requestUpdate(true));
  }
  const inkSketch = byId('cs-ink-sketch');
  if (inkSketch) {
    inkSketch.value = params.ink;
    inkSketch.addEventListener('input', () => {
      params.ink = inkSketch.value;
      if (ink) ink.value = inkSketch.value;
      requestUpdate(false);
    });
    inkSketch.addEventListener('change', () => requestUpdate(true));
  }
}
