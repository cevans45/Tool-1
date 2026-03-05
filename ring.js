// Shape orbits tool — animated shapes with mirroring and modes

let orbitParams = {
  count: 24,
  speed: 60,       // pixels per second equivalent
  mode: 'orbit',   // horizontal | vertical | diagonal | orbit | mixed
  shape: 'circle', // circle | square | triangle | mixed
  size: 20,
  mirror: 1,       // 1..4
  scalePct: 90,
  bg: '#f6f6f4',
  color: '#111111',
};

let orbitShapes = [];
let orbitSelected = -1;
let orbitCanvasWidth;

function createOrbitShapes() {
  orbitShapes = [];
  const cols = Math.ceil(Math.sqrt(orbitParams.count));
  const rows = Math.ceil(orbitParams.count / cols);
  for (let i = 0; i < orbitParams.count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = map(c + 0.5, 0, cols, 0, width);
    const y = map(r + 0.5, 0, rows, 0, height);
    const angle = random(TWO_PI);
    const radius = min(width, height) * 0.25 + random(-30, 30);
    const dir = random([-1, 1]);
    const vx = random([-1, 1]);
    const vy = random([-1, 1]);
    orbitShapes.push({
      x,
      y,
      angle,
      radius,
      dir,
      vx,
      vy,
      sizeFactor: 1,
      speedFactor: 1,
      modeOverride: null,
      kindOverride: null,
    });
  }
  orbitSelected = orbitShapes.length ? 0 : -1;
}

function resizeOrbitCanvas() {
  const container = document.getElementById('orbit-canvas');
  if (!container) return;
  const bounds = container.getBoundingClientRect();
  const maxW = window.innerWidth - 420;
  const maxH = window.innerHeight - 140;
  const base = min(maxW, maxH);
  const scale = (orbitParams.scalePct || 90) / 100;
  const target = max(260, base * scale);
  orbitCanvasWidth = target;
  if (typeof resizeCanvas === 'function') {
    resizeCanvas(target, target);
  }
}

function setup() {
  const container = document.getElementById('orbit-canvas');
  if (!container) return;
  orbitCanvasWidth = min(windowWidth - 420, windowHeight - 140);
  orbitCanvasWidth = max(260, orbitCanvasWidth);
  const canvas = createCanvas(orbitCanvasWidth, orbitCanvasWidth);
  canvas.parent('orbit-canvas');
  rectMode(CENTER);
  angleMode(RADIANS);
  noStroke();

  bindOrbitControls();
  createOrbitShapes();
}

function windowResized() {
  resizeOrbitCanvas();
}

function bindOrbitControls() {
  const countEl = document.getElementById('orbit-count');
  const speedEl = document.getElementById('orbit-speed');
  const scaleEl = document.getElementById('orbit-scale');
  const mirrorEl = document.getElementById('orbit-mirror');
  const modeEl = document.getElementById('orbit-mode');
  const shapeEl = document.getElementById('orbit-shape');
  const sizeEl = document.getElementById('orbit-size');
  const bgEl = document.getElementById('orbit-bg');
  const colorEl = document.getElementById('orbit-color');
  const randBtn = document.getElementById('btn-orbit-random-colors');
  const selSizeEl = document.getElementById('orbit-selected-size');
  const selSpeedEl = document.getElementById('orbit-selected-speed');
  const selModeEl = document.getElementById('orbit-selected-mode');
  const selLabel = document.getElementById('label-selected-index');

  if (countEl) {
    countEl.addEventListener('input', () => {
      orbitParams.count = parseInt(countEl.value, 10);
      const v = document.getElementById('value-orbit-count');
      if (v) v.textContent = countEl.value;
      createOrbitShapes();
    });
  }
  if (speedEl) {
    speedEl.addEventListener('input', () => {
      orbitParams.speed = parseInt(speedEl.value, 10);
      const v = document.getElementById('value-orbit-speed');
      if (v) v.textContent = speedEl.value;
    });
  }
  if (scaleEl) {
    scaleEl.addEventListener('input', () => {
      const pct = parseInt(scaleEl.value, 10);
      orbitParams.scalePct = pct;
      const v = document.getElementById('value-orbit-scale');
      if (v) v.textContent = pct + '%';
      resizeOrbitCanvas();
    });
  }
  if (mirrorEl) {
    mirrorEl.addEventListener('input', () => {
      orbitParams.mirror = parseInt(mirrorEl.value, 10);
      const v = document.getElementById('value-orbit-mirror');
      if (v) v.textContent = mirrorEl.value;
    });
  }
  if (modeEl) {
    modeEl.addEventListener('change', () => {
      orbitParams.mode = modeEl.value;
    });
  }
  if (shapeEl) {
    shapeEl.addEventListener('change', () => {
      orbitParams.shape = shapeEl.value;
    });
  }
  if (sizeEl) {
    sizeEl.addEventListener('input', () => {
      orbitParams.size = parseInt(sizeEl.value, 10);
      const v = document.getElementById('value-orbit-size');
      if (v) v.textContent = sizeEl.value;
    });
  }
  if (bgEl) {
    bgEl.addEventListener('input', () => {
      orbitParams.bg = bgEl.value;
    });
  }
  if (colorEl) {
    colorEl.addEventListener('input', () => {
      orbitParams.color = colorEl.value;
    });
  }
  if (randBtn) {
    randBtn.addEventListener('click', () => {
      // Randomize foreground and background colors only.
      const hue = random(360);
      const sat = random(40, 90);
      const lit = random(35, 65);
      const fg = hslToCss(hue, sat, lit);
      const bg = hslToCss(hue, sat * 0.2, 96);
      orbitParams.color = fg;
      orbitParams.bg = bg;
      if (colorEl) colorEl.value = fg;
      if (bgEl) bgEl.value = bg;
    });
  }

  const updateSelectedLabel = () => {
    if (!selLabel) return;
    selLabel.textContent = orbitSelected >= 0 ? `Shape #${orbitSelected + 1}` : 'None';
  };

  const syncSelectedControls = () => {
    const s = orbitShapes[orbitSelected];
    if (!s) return;
    if (selSizeEl) {
      const v = Math.round(orbitParams.size * (s.sizeFactor || 1));
      selSizeEl.value = constrain(v, parseInt(selSizeEl.min, 10), parseInt(selSizeEl.max, 10));
      const out = document.getElementById('value-orbit-selected-size');
      if (out) out.textContent = selSizeEl.value;
    }
    if (selSpeedEl) {
      const v = (s.speedFactor || 1);
      selSpeedEl.value = Math.round(v * 100);
      const out = document.getElementById('value-orbit-selected-speed');
      if (out) out.textContent = (v.toFixed(2) + 'x');
    }
    if (selModeEl) {
      selModeEl.value = s.modeOverride || 'inherit';
    }
  };

  if (selSizeEl) {
    selSizeEl.addEventListener('input', () => {
      const s = orbitShapes[orbitSelected];
      if (!s) return;
      const absSize = parseInt(selSizeEl.value, 10);
      s.sizeFactor = absSize / orbitParams.size;
      const out = document.getElementById('value-orbit-selected-size');
      if (out) out.textContent = selSizeEl.value;
    });
  }

  if (selSpeedEl) {
    selSpeedEl.addEventListener('input', () => {
      const s = orbitShapes[orbitSelected];
      if (!s) return;
      const pct = parseInt(selSpeedEl.value, 10); // 25–400
      s.speedFactor = pct / 100;
      const out = document.getElementById('value-orbit-selected-speed');
      if (out) out.textContent = (s.speedFactor.toFixed(2) + 'x');
    });
  }

  if (selModeEl) {
    selModeEl.addEventListener('change', () => {
      const s = orbitShapes[orbitSelected];
      if (!s) return;
      const v = selModeEl.value;
      s.modeOverride = v === 'inherit' ? null : v;
    });
  }

  updateSelectedLabel();
  syncSelectedControls();
}

function hslToCss(h, s, l) {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function mousePressed() {
  const container = document.getElementById('orbit-canvas');
  if (!container) return;
  const bounds = container.getBoundingClientRect();
  const mx = mouseX;
  const my = mouseY;
  if (mx < 0 || my < 0 || mx > width || my > height) return;

  let closest = -1;
  let closestDist = Infinity;
  for (let i = 0; i < orbitShapes.length; i++) {
    const s = orbitShapes[i];
    const d = dist(mx, my, s.x, s.y);
    const radius = (orbitParams.size * (s.sizeFactor || 1)) * 0.7;
    if (d < radius && d < closestDist) {
      closestDist = d;
      closest = i;
    }
  }
  if (closest !== -1) {
    orbitSelected = closest;
    const selLabel = document.getElementById('label-selected-index');
    if (selLabel) {
      selLabel.textContent = `Shape #${orbitSelected + 1}`;
    }
  }
}

function draw() {
  background(orbitParams.bg);
  const t = millis() / 1000;
  const baseSpeed = orbitParams.speed / 200;

  for (let i = 0; i < orbitShapes.length; i++) {
    const s = orbitShapes[i];
    updateShapePosition(s, t, baseSpeed, i);
    const isSelected = i === orbitSelected;
    drawMirroredShape(s.x, s.y, isSelected);
  }
}

function updateShapePosition(s, t, baseSpeed, idx) {
  const globalMode = orbitParams.mode;
  let mode = globalMode;
  if (s.modeOverride) {
    mode = s.modeOverride;
  } else if (globalMode === 'mixed') {
    mode = ['horizontal', 'vertical', 'diagonal', 'orbit'][idx % 4];
  }

  const sp = baseSpeed * (1 + (idx % 7) * 0.15) * (s.speedFactor || 1);

  if (mode === 'orbit') {
    const localAngle = s.angle + t * sp * s.dir * TWO_PI;
    const r = s.radius;
    s.x = width / 2 + cos(localAngle) * r;
    s.y = height / 2 + sin(localAngle) * r;
  } else {
    if (mode === 'horizontal') {
      s.x += s.vx * sp * 120;
    } else if (mode === 'vertical') {
      s.y += s.vy * sp * 120;
    } else if (mode === 'diagonal') {
      s.x += s.vx * sp * 100;
      s.y += s.vy * sp * 100;
    }
    // Wrap around edges.
    const margin = orbitParams.size * (s.sizeFactor || 1);
    if (s.x < -margin) s.x = width + margin;
    if (s.x > width + margin) s.x = -margin;
    if (s.y < -margin) s.y = height + margin;
    if (s.y > height + margin) s.y = -margin;
  }
}

function drawMirroredShape(x, y, isSelected) {
  const m = orbitParams.mirror || 1;
  const positions = [{ x, y }];
  if (m >= 2) positions.push({ x: width - x, y });
  if (m >= 3) positions.push({ x, y: height - y });
  if (m >= 4) positions.push({ x: width - x, y: height - y });

  positions.forEach((p) => {
    if (isSelected) {
      stroke(orbitParams.color);
      strokeWeight(2);
      noFill();
      const pad = orbitParams.size * 0.6;
      rectMode(CENTER);
      rect(p.x, p.y, orbitParams.size + pad, orbitParams.size + pad);
      noStroke();
    }
    drawOrbitShape(p.x, p.y);
  });
}

function pickShapeForIndex() {
  if (orbitParams.shape !== 'mixed') return orbitParams.shape;
  const options = ['circle', 'square', 'triangle'];
  return random(options);
}

function drawOrbitShape(x, y) {
  const sz = orbitParams.size;
  const s = pickShapeForIndex();
  if (s === 'square') {
    rect(x, y, sz, sz);
  } else if (s === 'triangle') {
    const h = sz * 1.15;
    triangle(
      x,
      y - h / 2,
      x - sz / 2,
      y + h / 2,
      x + sz / 2,
      y + h / 2
    );
  } else {
    circle(x, y, sz);
  }
}

