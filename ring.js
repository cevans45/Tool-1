// Recursive composer — per-shape controls + tone/exact system

const SHAPE_KEYS = ['circle', 'square', 'triangle'];

let orbitParams = {
  distribution: 'tone', // tone | exact
  total: 72,
  scalePct: 90,
  mirror: 1,
  mode: 'orbit', // horizontal | vertical | diagonal | orbit | chaos
  bg: '#f6f6f4',
  shapes: {
    circle: { tone: 50, count: 24, size: 28, speed: 60, color: '#ff2ca8' },
    square: { tone: 30, count: 24, size: 24, speed: 52, color: '#ffffff' },
    triangle: { tone: 20, count: 24, size: 36, speed: 66, color: '#ff2ca8' },
  },
};

let entities = [];
let orbitCanvasWidth = 600;

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh >= 0 && hh < 1) [r1, g1, b1] = [c, x, 0];
  else if (hh < 2) [r1, g1, b1] = [x, c, 0];
  else if (hh < 3) [r1, g1, b1] = [0, c, x];
  else if (hh < 4) [r1, g1, b1] = [0, x, c];
  else if (hh < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function desiredCounts() {
  if (orbitParams.distribution === 'exact') {
    return {
      circle: orbitParams.shapes.circle.count,
      square: orbitParams.shapes.square.count,
      triangle: orbitParams.shapes.triangle.count,
    };
  }
  const tones = SHAPE_KEYS.map((k) => max(0, orbitParams.shapes[k].tone));
  const toneTotal = tones.reduce((a, b) => a + b, 0) || 1;
  const raw = SHAPE_KEYS.map((k, i) => (orbitParams.total * tones[i]) / toneTotal);
  const counts = {};
  SHAPE_KEYS.forEach((k, i) => { counts[k] = floor(raw[i]); });
  let remainder = orbitParams.total - SHAPE_KEYS.reduce((n, k) => n + counts[k], 0);
  while (remainder > 0) {
    const idx = raw.indexOf(max(...raw));
    counts[SHAPE_KEYS[idx]] += 1;
    raw[idx] = -1;
    remainder--;
  }
  return counts;
}

function createEntities() {
  entities = [];
  const counts = desiredCounts();
  SHAPE_KEYS.forEach((shapeKey) => {
    for (let i = 0; i < counts[shapeKey]; i++) {
      const speedFactor = random(0.65, 1.35);
      const vx = random(-1, 1);
      const vy = random(-1, 1);
      const norm = max(0.0001, Math.hypot(vx, vy));
      entities.push({
        shape: shapeKey,
        x: random(width),
        y: random(height),
        vx: vx / norm,
        vy: vy / norm,
        angle: random(TWO_PI),
        radius: random(min(width, height) * 0.08, min(width, height) * 0.48),
        dir: random([-1, 1]),
        speedFactor,
      });
    }
  });
}

function resizeOrbitCanvas() {
  const availableW = max(280, windowWidth - 470);
  const availableH = max(280, windowHeight - 120);
  const base = min(availableW, availableH);
  const target = max(280, floor(base * (orbitParams.scalePct / 100)));
  orbitCanvasWidth = target;
  if (typeof resizeCanvas === 'function') {
    resizeCanvas(target, target);
  }
}

function setup() {
  const container = document.getElementById('orbit-canvas');
  if (!container) return;
  orbitCanvasWidth = max(280, min(windowWidth - 470, windowHeight - 120));
  const c = createCanvas(orbitCanvasWidth, orbitCanvasWidth);
  c.parent('orbit-canvas');
  rectMode(CENTER);
  noStroke();
  bindControls();
  createEntities();
}

function windowResized() {
  resizeOrbitCanvas();
  createEntities();
}

function bindRange(id, onInput, suffix = '') {
  const el = document.getElementById(id);
  const valueEl = document.getElementById(`value-${id}`);
  if (!el) return;
  el.addEventListener('input', () => {
    onInput(parseInt(el.value, 10));
    if (valueEl) valueEl.textContent = el.value + suffix;
  });
}

function setRowDisabled(id, disabled) {
  const row = document.getElementById(id);
  if (!row) return;
  row.classList.toggle('control-row--disabled', disabled);
  const input = row.querySelector('input');
  if (input) input.disabled = disabled;
}

function updateDistributionUI() {
  const isTone = orbitParams.distribution === 'tone';
  setRowDisabled('row-count-circle', isTone);
  setRowDisabled('row-count-square', isTone);
  setRowDisabled('row-count-triangle', isTone);
  setRowDisabled('row-tone-circle', !isTone);
  setRowDisabled('row-tone-square', !isTone);
  setRowDisabled('row-tone-triangle', !isTone);
}

function bindControls() {
  const distEl = document.getElementById('orbit-distribution');
  const modeEl = document.getElementById('orbit-mode');
  const bgEl = document.getElementById('orbit-bg');
  const randBtn = document.getElementById('btn-orbit-random-colors');

  bindRange('orbit-total', (v) => { orbitParams.total = v; createEntities(); });
  bindRange('orbit-scale', (v) => {
    orbitParams.scalePct = v;
    resizeOrbitCanvas();
    createEntities();
  }, '%');
  bindRange('orbit-mirror', (v) => { orbitParams.mirror = constrain(v, 1, 4); });

  SHAPE_KEYS.forEach((k) => {
    bindRange(`tone-${k}`, (v) => { orbitParams.shapes[k].tone = v; createEntities(); });
    bindRange(`count-${k}`, (v) => { orbitParams.shapes[k].count = v; createEntities(); });
    bindRange(`size-${k}`, (v) => { orbitParams.shapes[k].size = v; });
    bindRange(`speed-${k}`, (v) => { orbitParams.shapes[k].speed = v; });
    const colorEl = document.getElementById(`color-${k}`);
    if (colorEl) {
      colorEl.addEventListener('input', () => { orbitParams.shapes[k].color = colorEl.value; });
    }
  });

  if (distEl) {
    distEl.addEventListener('change', () => {
      orbitParams.distribution = distEl.value;
      updateDistributionUI();
      createEntities();
    });
  }
  if (modeEl) {
    modeEl.addEventListener('change', () => { orbitParams.mode = modeEl.value; });
  }
  if (bgEl) {
    bgEl.addEventListener('input', () => { orbitParams.bg = bgEl.value; });
  }
  if (randBtn) {
    randBtn.addEventListener('click', () => {
      const h = random(360);
      orbitParams.bg = hslToHex(h, random(8, 22), random(94, 98));
      orbitParams.shapes.circle.color = hslToHex(h + random(-30, 30), random(70, 95), random(45, 60));
      orbitParams.shapes.square.color = hslToHex(h + random(120, 180), random(10, 35), random(88, 98));
      orbitParams.shapes.triangle.color = hslToHex(h + random(10, 60), random(75, 95), random(45, 62));
      const bgEl2 = document.getElementById('orbit-bg');
      const c1 = document.getElementById('color-circle');
      const c2 = document.getElementById('color-square');
      const c3 = document.getElementById('color-triangle');
      if (bgEl2) bgEl2.value = orbitParams.bg;
      if (c1) c1.value = orbitParams.shapes.circle.color;
      if (c2) c2.value = orbitParams.shapes.square.color;
      if (c3) c3.value = orbitParams.shapes.triangle.color;
    });
  }

  updateDistributionUI();
}

function drawShapeByType(type, x, y, sizePx) {
  if (type === 'square') {
    rect(x, y, sizePx, sizePx);
    return;
  }
  if (type === 'triangle') {
    const h = sizePx * 1.15;
    triangle(x, y - h / 2, x - sizePx / 2, y + h / 2, x + sizePx / 2, y + h / 2);
    return;
  }
  circle(x, y, sizePx);
}

function drawMirrored(type, x, y, sizePx, colorHex) {
  fill(colorHex);
  const parts = [{ x, y }];
  if (orbitParams.mirror >= 2) parts.push({ x: width - x, y });
  if (orbitParams.mirror >= 3) parts.push({ x, y: height - y });
  if (orbitParams.mirror >= 4) parts.push({ x: width - x, y: height - y });
  parts.forEach((p) => drawShapeByType(type, p.x, p.y, sizePx));
}

function updateEntity(e, dt, mode) {
  const shapeCfg = orbitParams.shapes[e.shape];
  const speedPx = shapeCfg.speed * e.speedFactor;
  if (mode === 'orbit') {
    e.angle += dt * speedPx * 0.012 * e.dir;
    e.x = width / 2 + cos(e.angle) * e.radius;
    e.y = height / 2 + sin(e.angle) * e.radius;
    return;
  }
  if (mode === 'horizontal') {
    e.x += e.vx * speedPx * dt;
  } else if (mode === 'vertical') {
    e.y += e.vy * speedPx * dt;
  } else if (mode === 'diagonal') {
    e.x += e.vx * speedPx * dt;
    e.y += e.vy * speedPx * dt;
  } else {
    e.x += e.vx * speedPx * dt;
    e.y += e.vy * speedPx * dt;
    e.vx += random(-0.02, 0.02);
    e.vy += random(-0.02, 0.02);
    const n = max(0.0001, Math.hypot(e.vx, e.vy));
    e.vx /= n;
    e.vy /= n;
  }
  const s = shapeCfg.size;
  if (e.x < -s) e.x = width + s;
  if (e.x > width + s) e.x = -s;
  if (e.y < -s) e.y = height + s;
  if (e.y > height + s) e.y = -s;
}

function draw() {
  background(orbitParams.bg);
  const dt = deltaTime / 1000;
  const mode = orbitParams.mode;
  noStroke();

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    updateEntity(e, dt, mode);
    const cfg = orbitParams.shapes[e.shape];
    drawMirrored(e.shape, e.x, e.y, cfg.size, cfg.color);
  }
}

