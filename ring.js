// Poster-like shape motion tool with up to 4 declared shapes.

const orbitParams = {
  seed: 2025,
  mirror: 3,       // 1..5
  scalePct: 92,
  shapeCount: 4,   // 1..4 declared shapes
  bg: '#050505',
  shapes: [
    { shape: 'circle', dir: 'circle', size: 120, speed: 45, radius: 220, rot: 0, spin: 18, color: '#ff2aa1', phase: 0.0 },
    { shape: 'square', dir: 'diag-ur', size: 56, speed: 72, radius: 120, rot: 35, spin: -24, color: '#ffffff', phase: 1.3 },
    { shape: 'triangle', dir: 'left', size: 88, speed: 30, radius: 280, rot: 0, spin: 12, color: '#ff2aa1', phase: 2.2 },
    { shape: 'circle', dir: 'right', size: 48, speed: 90, radius: 160, rot: 10, spin: 22, color: '#ffffff', phase: 0.7 }
  ]
};

let sceneBuffer;

function setup() {
  const container = document.getElementById('orbit-canvas');
  if (!container) return;
  const c = createCanvas(400, 400);
  c.parent('orbit-canvas');
  rectMode(CENTER);
  angleMode(RADIANS);
  noStroke();
  sceneBuffer = createGraphics(400, 400);
  sceneBuffer.rectMode(CENTER);
  sceneBuffer.angleMode(RADIANS);
  sceneBuffer.noStroke();

  bindControls();
  resizePosterCanvas();
}

function windowResized() {
  resizePosterCanvas();
}

function resizePosterCanvas() {
  const maxW = window.innerWidth - 420;
  const maxH = window.innerHeight - 140;
  const base = min(maxW, maxH);
  const target = max(260, base * (orbitParams.scalePct / 100));
  resizeCanvas(target, target);
  sceneBuffer = createGraphics(target, target);
  sceneBuffer.rectMode(CENTER);
  sceneBuffer.angleMode(RADIANS);
  sceneBuffer.noStroke();
}

function bindControls() {
  bindInput('orbit-seed', (v) => { orbitParams.seed = int(v) || 0; });
  bindRange('orbit-scale', 'value-orbit-scale', (v) => {
    orbitParams.scalePct = int(v);
    return `${int(v)}%`;
  }, () => resizePosterCanvas());
  bindRange('orbit-mirror', 'value-orbit-mirror', (v) => {
    orbitParams.mirror = constrain(int(v), 1, 5);
    return String(orbitParams.mirror);
  });
  bindRange('orbit-shape-count', 'value-orbit-shape-count', (v) => {
    orbitParams.shapeCount = constrain(int(v), 1, 4);
    return String(orbitParams.shapeCount);
  }, updateShapeSectionState);
  bindInput('orbit-bg', (v) => { orbitParams.bg = v; });

  for (let i = 0; i < 4; i++) {
    const n = i + 1;
    bindInput(`orbit-s${n}-shape`, (v) => { orbitParams.shapes[i].shape = v; });
    bindInput(`orbit-s${n}-dir`, (v) => { orbitParams.shapes[i].dir = v; });
    bindRange(`orbit-s${n}-size`, `value-orbit-s${n}-size`, (v) => {
      orbitParams.shapes[i].size = int(v);
      return String(int(v));
    });
    bindRange(`orbit-s${n}-speed`, `value-orbit-s${n}-speed`, (v) => {
      orbitParams.shapes[i].speed = int(v);
      return String(int(v));
    });
    bindRange(`orbit-s${n}-radius`, `value-orbit-s${n}-radius`, (v) => {
      orbitParams.shapes[i].radius = int(v);
      return String(int(v));
    });
    bindRange(`orbit-s${n}-rot`, `value-orbit-s${n}-rot`, (v) => {
      orbitParams.shapes[i].rot = int(v);
      return `${int(v)}°`;
    });
    bindRange(`orbit-s${n}-spin`, `value-orbit-s${n}-spin`, (v) => {
      orbitParams.shapes[i].spin = int(v);
      return String(int(v));
    });
    bindInput(`orbit-s${n}-color`, (v) => { orbitParams.shapes[i].color = v; });
  }

  const seedBtn = document.getElementById('btn-orbit-random-seed');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      orbitParams.seed = floor(random(1_000_000_000));
      const seedEl = document.getElementById('orbit-seed');
      if (seedEl) seedEl.value = String(orbitParams.seed);
    });
  }

  const paletteBtn = document.getElementById('btn-orbit-random-colors');
  if (paletteBtn) {
    paletteBtn.addEventListener('click', () => {
      const base = random(360);
      orbitParams.bg = toHexFromHsl(base, 18, 5);
      orbitParams.shapes[0].color = toHexFromHsl((base + 320) % 360, 90, 56);
      orbitParams.shapes[1].color = toHexFromHsl((base + 0) % 360, 10, 96);
      orbitParams.shapes[2].color = toHexFromHsl((base + 300) % 360, 90, 56);
      orbitParams.shapes[3].color = toHexFromHsl((base + 340) % 360, 40, 92);
      const bg = document.getElementById('orbit-bg');
      if (bg) bg.value = orbitParams.bg;
      for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`orbit-s${i + 1}-color`);
        if (el) el.value = orbitParams.shapes[i].color;
      }
    });
  }

  updateShapeSectionState();
}

function bindInput(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  const evt = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(evt, () => onChange(el.value));
}

function bindRange(id, valueId, mapFn, afterFn) {
  const el = document.getElementById(id);
  const val = document.getElementById(valueId);
  if (!el) return;
  const apply = () => {
    const text = mapFn(el.value);
    if (val) val.textContent = text;
    if (afterFn) afterFn();
  };
  el.addEventListener('input', apply);
  apply();
}

function updateShapeSectionState() {
  for (let i = 0; i < 4; i++) {
    const section = document.getElementById(`shape-${i + 1}-section`);
    if (!section) continue;
    const active = i < orbitParams.shapeCount;
    section.classList.toggle('control-row--disabled', !active);
    const controls = section.querySelectorAll('input, select');
    controls.forEach((control) => {
      control.disabled = !active;
    });
  }
}

function draw() {
  const t = millis() * 0.001;
  drawSceneToBuffer(t);
  drawMirroredCanvas();
}

function drawSceneToBuffer(t) {
  sceneBuffer.clear();
  sceneBuffer.background(orbitParams.bg);
  randomSeed(int(orbitParams.seed));
  for (let i = 0; i < orbitParams.shapeCount; i++) {
    const shapeDef = orbitParams.shapes[i];
    const point = shapePoint(shapeDef, i, t);
    const spin = radians((shapeDef.spin || 0) * t);
    const baseRot = radians(shapeDef.rot || 0);
    drawShapeAt(sceneBuffer, point.x, point.y, baseRot + spin, shapeDef.shape, shapeDef.size, shapeDef.color);
  }
}

function shapePoint(shapeDef, index, t) {
  const speed = shapeDef.speed / 100;
  const r = shapeDef.radius;
  const phase = shapeDef.phase + index * 1.77;
  const tt = t * speed + phase;
  let x = width / 2;
  let y = height / 2;

  if (shapeDef.dir === 'circle') {
    x = width / 2 + cos(tt) * r;
    y = height / 2 + sin(tt) * r;
  } else {
    const vec = directionVector(shapeDef.dir);
    x = width / 2 + vec.x * sin(tt) * r;
    y = height / 2 + vec.y * sin(tt) * r;
  }
  return { x, y };
}

function directionVector(dir) {
  if (dir === 'up') return { x: 0, y: -1 };
  if (dir === 'down') return { x: 0, y: 1 };
  if (dir === 'left') return { x: -1, y: 0 };
  if (dir === 'right') return { x: 1, y: 0 };
  if (dir === 'diag-ur') return { x: 0.71, y: -0.71 };
  if (dir === 'diag-ul') return { x: -0.71, y: -0.71 };
  if (dir === 'diag-dr') return { x: 0.71, y: 0.71 };
  if (dir === 'diag-dl') return { x: -0.71, y: 0.71 };
  return { x: 1, y: 0 };
}

function drawMirroredCanvas() {
  background(orbitParams.bg);
  const m = constrain(orbitParams.mirror, 1, 5);
  drawImageTransformed(sceneBuffer, false, false, 0);
  if (m >= 2) drawImageTransformed(sceneBuffer, true, false, 0);
  if (m >= 3) drawImageTransformed(sceneBuffer, false, true, 0);
  if (m >= 4) drawImageTransformed(sceneBuffer, true, true, 0);
  if (m >= 5) drawImageTransformed(sceneBuffer, true, false, HALF_PI);
}

function drawImageTransformed(img, flipX, flipY, rotateBy) {
  push();
  translate(width / 2, height / 2);
  rotate(rotateBy);
  scale(flipX ? -1 : 1, flipY ? -1 : 1);
  imageMode(CENTER);
  image(img, 0, 0, width, height);
  pop();
}

function drawShapeAt(g, x, y, rot, shape, size, colorHex) {
  g.push();
  g.translate(x, y);
  g.rotate(rot);
  g.fill(colorHex);
  drawShape(g, shape, size);
  g.pop();
}

function drawShape(g, shape, s) {
  if (shape === 'square') {
    g.rect(0, 0, s, s);
  } else if (shape === 'triangle') {
    const h = s * 1.1;
    g.triangle(0, -h / 2, -s / 2, h / 2, s / 2, h / 2);
  } else if (shape === 'diamond') {
    g.beginShape();
    g.vertex(0, -s / 2);
    g.vertex(s / 2, 0);
    g.vertex(0, s / 2);
    g.vertex(-s / 2, 0);
    g.endShape(CLOSE);
  } else {
    g.circle(0, 0, s);
  }
}

function toHexFromHsl(h, s, l) {
  colorMode(HSL, 360, 100, 100, 1);
  const c = color(h, s, l);
  colorMode(RGB, 255, 255, 255, 255);
  return `#${hex(red(c), 2)}${hex(green(c), 2)}${hex(blue(c), 2)}`;
}

