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
  curveAmt: 55,
  genReach: 120,
  genTaper: 65,
  strokeTaper: 35,
  sketchTaper: 25,
  genWebbing: 45,
  branchEnabledGen: true,
  branching: 30,
  branchReachGen: 48,
  branchCountGen: 2,
  branchCurveGen: 50,
  sketchBranchEnabled: false,
  sketchBranching: 25,
  sketchBranchReach: 22,
  sketchBranchCount: 2,
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
  strokeStyle: 'line',
  sketchRoughness: 4,
  sketchDensity: 6,
  sketchReach: 50
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
  const margin = height * 0.1;

  const halfPaths = [];
  for (let i = 0; i < params.curveCount; i++) {
    const yCenter = random(margin, height - margin);

    // More varied directions and lengths, still mostly on the right half
    const angle = random(-HALF_PI * 0.85, HALF_PI * 0.85);
    const reachBase = max(40, params.genReach);
    const reach = random(reachBase * 0.7, reachBase * 1.5) * (0.6 + 0.4 * sp);

    const startX = halfW + random(-20, 40);
    const startY = yCenter + random(-height * 0.06, height * 0.06);
    const endX = startX + cos(angle) * reach;
    const endY = startY + sin(angle) * reach;

    const curveAmt = (params.curveAmt / 100) * (22 + 160 * sp);
    const cx1 = lerp(startX, endX, 0.33) + random(-curveAmt, curveAmt);
    const cy1 = lerp(startY, endY, 0.33) + random(-curveAmt, curveAmt);
    const cx2 = lerp(startX, endX, 0.66) + random(-curveAmt, curveAmt);
    const cy2 = lerp(startY, endY, 0.66) + random(-curveAmt, curveAmt);

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

  // Path-level branches removed; generate branches are now added at connection level

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

  const halfPathsFinal = warped;
  paths = [];
  for (const path of halfPathsFinal) {
    const mirrored = createMirroredPaths(path);
    for (const p of mirrored) paths.push(p);
  }

  renderPathsToBufferFromHalf(halfPathsFinal);
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
  const branchProb = (params.branching / 100) * 0.35;
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
      const baseLen = max(6, params.branchReachGen);
      const count = max(0, floor(params.branchCountGen));
      // Always spawn `count` branches when a branch event happens.
      for (let bi = 0; bi < count; bi++) {
        const len = baseLen * random(0.65, 1.35);
        const segs = floor(random(3, 7));
        const branch = [root.copy()];
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          // Curved branch: add a bend that increases toward the tip.
          const bend = (noise((root.x + s * 13) * 0.03, (root.y + s * 13) * 0.03, params.seed * 0.00003) - 0.5) * 2;
          branch.push(createVector(
            root.x + normal.x * len * t + tan.x * (bend * 14) * t,
            root.y + normal.y * len * t + tan.y * (bend * 14) * t
          ));
        }
        pathList.push(branch);
      }
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

function mirrorConnections(conns) {
  if (!params.mirrorX && !params.mirrorY) return conns;
  const out = conns.slice();
  const w = width, h = height;
  if (params.mirrorX) {
    for (const c of conns) out.push({ px: w - c.px, py: c.py, x: w - c.x, y: c.y, d: c.d, tm: c.tm });
  }
  if (params.mirrorY) {
    for (const c of conns) out.push({ px: c.px, py: h - c.py, x: c.x, y: h - c.y, d: c.d, tm: c.tm });
  }
  if (params.mirrorX && params.mirrorY) {
    for (const c of conns) out.push({ px: w - c.px, py: h - c.py, x: w - c.x, y: h - c.y, d: c.d, tm: c.tm });
  }
  return out;
}

function scratchLine(ctx, x1, y1, x2, y2, d, colorOverride, widthAdd, thicknessMul) {
  const reach = params.drawMode ? params.sketchReach : params.genReach;
  const taperByDistance = constrain(params.strokeTaper / 100, 0, 1);
  const distMul = lerp(1, constrain(1 - d / max(1, reach), 0.25, 1), taperByDistance);
  const finalThickness = (params.strokeW + (widthAdd || 0)) * distMul * (thicknessMul == null ? 1 : thicknessMul);
  const roughness = params.sketchRoughness;
  // Roughness now only affects texture, not stroke size
  const jitter = roughness * 0.9;
  const passes = params.sketchDensity;
  const useRound = roughness <= 2;
  const skipChance = roughness > 3 ? Math.min((roughness - 3) / 50, 0.18) : 0;

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

  if (params.strokeStyle === 'sprinkle') {
    const count = max(1, floor(passes * 0.6));
    for (let i = 0; i < count; i++) {
      const t = rng();
      const px = x1 + (x2 - x1) * t + (rng() - 0.5) * jitter * 1.5;
      const py = y1 + (y2 - y1) * t + (rng() - 0.5) * jitter * 1.5;
      const sz = finalThickness * (0.3 + rng() * 0.7);
      if (rng() > skipChance) {
        ctx.beginPath();
        ctx.arc(px, py, sz * 0.5, 0, 6.2832);
        ctx.fill();
      }
    }
  } else {
    for (let i = 0; i < passes; i++) {
      const jx1 = (rng() - 0.5) * jitter;
      const jy1 = (rng() - 0.5) * jitter;
      const jx2 = (rng() - 0.5) * jitter;
      const jy2 = (rng() - 0.5) * jitter;

      if (rng() > skipChance) {
        ctx.beginPath();
        ctx.lineWidth = finalThickness;
        ctx.lineCap = useRound ? 'round' : 'square';
        ctx.lineJoin = useRound ? 'round' : 'bevel';
        ctx.moveTo(x1 + jx1, y1 + jy1);
        ctx.lineTo(x2 + jx2, y2 + jy2);
        ctx.stroke();
      }
    }
  }

  ctx.globalCompositeOperation = 'source-over';
}

function drawConnections(ctx, connections, colorOverride, widthAdd) {
  for (const c of connections) {
    scratchLine(ctx, c.px, c.py, c.x, c.y, c.d, colorOverride, widthAdd, c.tm);
  }
}

function addBranchStubs(connections, reachPx, count, amount01) {
  if (!connections || connections.length === 0) return [];
  const out = [];
  const branchCount = max(0, floor(count));
  if (branchCount === 0) return out;

  // Softer probability so low slider values don't explode with branches
  const amt = constrain(amount01, 0, 1);
  const prob = amt * amt; // ease-in curve

  // Branch curvature for generate mode
  const curve01 = params.drawMode ? 0 : constrain((params.branchCurveGen || 0) / 100, 0, 1);

  for (const c of connections) {
    const seed = (Math.round(c.px * 29) * 374761 + Math.round(c.py * 29) * 668265 +
                  Math.round(c.x * 29) * 214748 + Math.round(c.y * 29) * 110351) | 0;
    const rng = makeRng(seed);
    if (rng() > prob) continue;

    const mx = (c.px + c.x) * 0.5;
    const my = (c.py + c.y) * 0.5;
    const dx = c.x - c.px;
    const dy = c.y - c.py;
    const mag = Math.hypot(dx, dy) || 1;
    const nx = -dy / mag;
    const ny = dx / mag;
    const tx = dx / mag;
    const ty = dy / mag;

    for (let i = 0; i < branchCount; i++) {
      const dir = rng() < 0.5 ? -1 : 1;
      const len = reachPx * (0.55 + 0.65 * rng());
      const baseJitter = (rng() - 0.5) * reachPx * 0.25;
      const bendSign = rng() < 0.5 ? -1 : 1;
      const bend = curve01 * len * 0.7 * bendSign;

      const bx = mx
        + nx * dir * len
        + tx * bend
        + baseJitter;
      const by = my
        + ny * dir * len
        + ty * bend
        + (rng() - 0.5) * reachPx * 0.25;
      const d = Math.hypot(bx - mx, by - my);
      out.push({ px: mx, py: my, x: bx, y: by, d });
    }
  }
  return out;
}

function drawWithOutlineFill(ctx, conns, doMirror) {
  const ow = params.outlineWidth * 2;
  const savedOp = params.drawOperation;

  const branches = (params.drawMode && params.sketchBranchEnabled)
    ? addBranchStubs(conns, params.sketchBranchReach, params.sketchBranchCount, params.sketchBranching / 100)
    : [];

  const base = branches.length ? conns.concat(branches) : conns;
  const full = doMirror ? mirrorConnections(base) : base;

  if (params.outlineEnabled) {
    params.drawOperation = 'ink';
    drawConnections(ctx, full, params.outlineColor, ow);
    if (!params.fillEnabled) {
      params.drawOperation = 'cut';
      drawConnections(ctx, full, null, 0);
    }
  }

  if (params.fillEnabled) {
    params.drawOperation = 'ink';
    drawConnections(ctx, full, null, 0);
  }

  params.drawOperation = savedOp;
}

function buildGenerateWebbing(pathList) {
  const reach = max(10, params.genReach);
  const amount = constrain(params.genWebbing / 100, 0, 1);
  if (amount <= 0) return [];

  const points = [];
  const stride = max(2, floor(map(amount, 0, 1, 18, 4)));
  for (const path of pathList) {
    for (let i = 0; i < path.length; i += stride) {
      const p = path[i];
      points.push({ x: p.x, y: p.y });
    }
  }
  if (points.length < 4) return [];

  const cell = reach;
  const buckets = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const ix = floor(p.x / cell);
    const iy = floor(p.y / cell);
    const key = `${ix},${iy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }

  const out = [];
  const maxLinks = floor(map(amount, 0, 1, 0, 140));
  let made = 0;
  for (let i = 0; i < points.length; i++) {
    if (made >= maxLinks) break;
    const p = points[i];
    const ix = floor(p.x / cell);
    const iy = floor(p.y / cell);
    const seed = (Math.round(p.x * 7) * 374761 + Math.round(p.y * 7) * 668265 + (params.seed | 0)) | 0;
    const rng = makeRng(seed);

    // Try a few candidate neighbor points nearby.
    for (let tries = 0; tries < 3; tries++) {
      const dxCell = floor(rng() * 3) - 1;
      const dyCell = floor(rng() * 3) - 1;
      const cand = buckets.get(`${ix + dxCell},${iy + dyCell}`);
      if (!cand || cand.length === 0) continue;
      const j = cand[floor(rng() * cand.length)];
      if (j === i) continue;
      const q = points[j];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 6 || d > reach) continue;
      out.push({ px: p.x, py: p.y, x: q.x, y: q.y, d, tm: 1 });
      made++;
      break;
    }
  }
  return out;
}

function addDrawPoint(x, y) {
  const p = { x, y };
  drawPoints.push(p);

  const ctx = drawBuffer.drawingContext;
  const startIndex = Math.max(0, drawPoints.length - 250);
  const dynamicConnect = params.sketchReach;

  const conns = [];
  for (let i = startIndex; i < drawPoints.length - 1; i++) {
    const prev = drawPoints[i];
    if (!prev) continue;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d < dynamicConnect) {
      conns.push({ px: prev.x, py: prev.y, x: p.x, y: p.y, d, tm: 1 });
    }
  }

  drawWithOutlineFill(ctx, conns, true);
}

function addBranchStubsForGenerate(connections) {
  if (!params.branchEnabledGen) return [];
  return addBranchStubs(connections, params.branchReachGen, params.branchCountGen, params.branching / 100);
}

function pathsToConnections(pathList) {
  const conns = [];
  for (const path of pathList) {
    if (path.length < 2) continue;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const t = i / (path.length - 1);
      const taper = constrain(params.genTaper / 100, 0, 1);
      const tm = 1 - taper * t;
      conns.push({ px: a.x, py: a.y, x: b.x, y: b.y, d, tm });
    }
  }
  return conns;
}

function renderPathsToBuffer(pathList) {
  drawBuffer.clear();
  const ctx = drawBuffer.drawingContext;
  const savedOp = params.drawOperation;
  const conns = pathsToConnections(pathList);
  const web = buildGenerateWebbing(pathList);
  const full = web.length ? conns.concat(web) : conns;
  drawWithOutlineFill(ctx, full, false);
  params.drawOperation = savedOp;
}

function renderPathsToBufferFromHalf(halfPaths) {
  drawBuffer.clear();
  const ctx = drawBuffer.drawingContext;
  const savedOp = params.drawOperation;

  const conns = pathsToConnections(halfPaths);
  const web = buildGenerateWebbing(halfPaths);
  let base = web.length ? conns.concat(web) : conns;

  const genBranches = params.branchEnabledGen
    ? addBranchStubs(
        base,
        params.branchReachGen,
        params.branchCountGen,
        Math.pow(constrain(params.branching / 100, 0, 1), 1.6)
      )
    : [];
  if (genBranches.length) base = base.concat(genBranches);

  const mirrored = mirrorConnections(base);

  const ow = params.outlineWidth * 2;
  if (params.outlineEnabled) {
    params.drawOperation = 'ink';
    drawConnections(ctx, mirrored, params.outlineColor, ow);
    if (!params.fillEnabled) {
      params.drawOperation = 'cut';
      drawConnections(ctx, mirrored, null, 0);
    }
  }
  if (params.fillEnabled) {
    params.drawOperation = 'ink';
    drawConnections(ctx, mirrored, null, 0);
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
  const dynamicConnect = params.sketchReach;
  const taper = constrain(params.sketchTaper / 100, 0, 1);
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      const t = seg.length > 1 ? (i / (seg.length - 1)) : 0;
      const tm = 1 - taper * t;
      const lookback = Math.max(0, i - 249);
      for (let j = lookback; j < i; j++) {
        const prev = seg[j];
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (d < dynamicConnect) {
          all.push({ px: prev.x, py: prev.y, x: p.x, y: p.y, d, tm });
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
  const conns = buildSketchConnections();
  drawWithOutlineFill(ctx, conns, true);
  params.drawOperation = savedOp;

  buildCurveHashFromPaths(getDrawnPathSegments());
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
  const ctx = drawingContext;
  const base = color(params.textureColor);
  const alpha = map(k * o, 0, 1, 10, 120);
  const stride = max(1, floor(map(d, 0, 1, 6, 1)));
  const spread = map(jt, 0, 1, 0.9, 6.5);
  const px = map(s, 0, 1, 0.8, 2.2);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  for (const path of sourcePaths) {
    for (let i = 0; i < path.length; i += stride) {
      const p = path[i];
      const seed = (Math.round(p.x * 7) * 374761 + Math.round(p.y * 7) * 668265 + (params.seed | 0)) | 0;
      const rng = makeRng(seed);

      const samples = floor(map(k * d, 0, 1, 1, 10));
      for (let j = 0; j < samples; j++) {
        const ox = (rng() - 0.5) * spread * 2;
        const oy = (rng() - 0.5) * spread * 2;

        const uvxA = (p.x + ox) * 0.017;
        const uvyA = (p.y + oy) * 0.017;
        const uvxB = (p.x + ox) * 0.021;
        const uvyB = (p.y + oy) * 0.021;
        const uvxC = (p.x + ox) * 0.013;
        const uvyC = (p.y + oy) * 0.013;

        const grainR = (hash01(uvxA, uvyA, params.seed * 0.001) - 0.5) * 2;
        const grainG = (hash01(uvxB, uvyB, params.seed * 0.001 + 7.1) - 0.5) * 2;
        const grainB = (hash01(uvxC, uvyC, params.seed * 0.001 + 3.7) - 0.5) * 2;

        const rr = constrain(red(base) + grainR * 255 * 0.06, 0, 255);
        const gg = constrain(green(base) + grainG * 255 * 0.06, 0, 255);
        const bb = constrain(blue(base) + grainB * 255 * 0.06, 0, 255);

        ctx.fillStyle = `rgba(${rr.toFixed(0)},${gg.toFixed(0)},${bb.toFixed(0)},${(alpha / 255).toFixed(3)})`;
        ctx.fillRect(p.x + ox, p.y + oy, px, px);
      }
    }
  }

  ctx.restore();
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
  bindRange('cs-curve-amt', 'val-cs-curve-amt', (v) => { params.curveAmt = parseInt(v, 10); return String(params.curveAmt); });
  bindRange('cs-spread', 'val-cs-spread', (v) => { params.spread = parseInt(v, 10); return String(params.spread); });
  bindRange('cs-gen-reach', 'val-cs-gen-reach', (v) => { params.genReach = parseInt(v, 10); return String(params.genReach); });
  bindRange('cs-gen-taper', 'val-cs-gen-taper', (v) => { params.genTaper = parseInt(v, 10); return String(params.genTaper); });
  bindRange('cs-gen-webbing', 'val-cs-gen-webbing', (v) => { params.genWebbing = parseInt(v, 10); return String(params.genWebbing); });
  bindCheck('cs-branch-enabled-gen', (checked) => {
    params.branchEnabledGen = checked;
    updateGenBranchUI();
  });
  bindRange('cs-branching', 'val-cs-branching', (v) => { params.branching = parseInt(v, 10); return String(params.branching); });
  bindRange('cs-branch-reach-gen', 'val-cs-branch-reach-gen', (v) => { params.branchReachGen = parseInt(v, 10); return String(params.branchReachGen); });
  bindRange('cs-branch-count-gen', 'val-cs-branch-count-gen', (v) => { params.branchCountGen = parseInt(v, 10); return String(params.branchCountGen); });
  bindRange('cs-branch-curve-gen', 'val-cs-branch-curve-gen', (v) => { params.branchCurveGen = parseInt(v, 10); return String(params.branchCurveGen); });

  const strokeStyleEl = byId('cs-stroke-style');
  if (strokeStyleEl) {
    strokeStyleEl.value = params.strokeStyle;
    strokeStyleEl.addEventListener('change', () => {
      params.strokeStyle = strokeStyleEl.value;
      requestUpdate(true);
    });
  }

  bindRange('cs-stroke', 'val-cs-stroke', (v) => {
    params.strokeW = parseInt(v, 10);
    const genEl = byId('cs-stroke-gen');
    if (genEl) genEl.value = v;
    setValue('val-cs-stroke-gen', String(params.strokeW));
    return String(params.strokeW);
  });
  bindRange('cs-stroke-gen', 'val-cs-stroke-gen', (v) => {
    params.strokeW = parseInt(v, 10);
    const skEl = byId('cs-stroke');
    if (skEl) skEl.value = v;
    setValue('val-cs-stroke', String(params.strokeW));
    return String(params.strokeW);
  });

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
  bindRange('cs-sketch-taper', 'val-cs-sketch-taper', (v) => { params.sketchTaper = parseInt(v, 10); return String(params.sketchTaper); });
  bindRange('cs-stroke-taper', 'val-cs-stroke-taper', (v) => { params.strokeTaper = parseInt(v, 10); return String(params.strokeTaper); });
  bindCheck('cs-branch-enabled-sketch', (checked) => { params.sketchBranchEnabled = checked; updateSketchBranchUI(); });
  bindRange('cs-branching-sketch', 'val-cs-branching-sketch', (v) => { params.sketchBranching = parseInt(v, 10); return String(params.sketchBranching); });
  bindRange('cs-branch-reach-sketch', 'val-cs-branch-reach-sketch', (v) => { params.sketchBranchReach = parseInt(v, 10); return String(params.sketchBranchReach); });
  bindRange('cs-branch-count-sketch', 'val-cs-branch-count-sketch', (v) => { params.sketchBranchCount = parseInt(v, 10); return String(params.sketchBranchCount); });

  updateSketchBranchUI();
  updateGenBranchUI();

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

  function updateSketchBranchUI() {
    const show = !!params.sketchBranchEnabled;
    const rowAmt = byId('row-cs-branching-sketch');
    const rowReach = byId('row-cs-branch-reach-sketch');
    const rowCount = byId('row-cs-branch-count-sketch');
    if (rowAmt) rowAmt.style.display = show ? 'flex' : 'none';
    if (rowReach) rowReach.style.display = show ? 'flex' : 'none';
    if (rowCount) rowCount.style.display = show ? 'flex' : 'none';
  }

  function updateGenBranchUI() {
    const show = !!params.branchEnabledGen;
    const rowReach = byId('row-cs-branch-reach-gen');
    const rowCount = byId('row-cs-branch-count-gen');
    const rowCurve = byId('row-cs-branch-curve-gen');
    if (rowReach) rowReach.style.display = show ? 'flex' : 'none';
    if (rowCount) rowCount.style.display = show ? 'flex' : 'none';
    if (rowCurve) rowCurve.style.display = show ? 'flex' : 'none';
  }

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
