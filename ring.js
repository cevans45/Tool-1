// Poster-like shape motion tool with multi-layer controls.

const orbitParams = {
  seed: 2025,
  mirror: 3, // 1..5 radial mirrored copies
  scalePct: 92,
  bg: '#050505',
  layers: [
    { shape: 'circle', dir: 'circle', count: 8, size: 120, speed: 45, radius: 220, rot: 0, color: '#ff2aa1' },
    { shape: 'square', dir: 'diag-ur', count: 10, size: 56, speed: 72, radius: 120, rot: 35, color: '#ffffff' },
    { shape: 'triangle', dir: 'left', count: 6, size: 88, speed: 30, radius: 280, rot: 0, color: '#ff2aa1' }
  ]
};

let actors = [];

function setup() {
  const container = document.getElementById('orbit-canvas');
  if (!container) return;
  const c = createCanvas(400, 400);
  c.parent('orbit-canvas');
  rectMode(CENTER);
  angleMode(RADIANS);
  noStroke();

  bindControls();
  rebuildScene();
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
  rebuildScene();
}

function bindControls() {
  bindInput('orbit-seed', (v) => { orbitParams.seed = int(v) || 0; rebuildScene(); });
  bindRange('orbit-scale', 'value-orbit-scale', (v) => {
    orbitParams.scalePct = int(v);
    return `${int(v)}%`;
  }, () => resizePosterCanvas());
  bindRange('orbit-mirror', 'value-orbit-mirror', (v) => {
    orbitParams.mirror = constrain(int(v), 1, 5);
    return String(orbitParams.mirror);
  });
  bindInput('orbit-bg', (v) => { orbitParams.bg = v; });

  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    bindInput(`orbit-l${n}-shape`, (v) => { orbitParams.layers[i].shape = v; });
    bindInput(`orbit-l${n}-dir`, (v) => { orbitParams.layers[i].dir = v; });
    bindRange(`orbit-l${n}-count`, `value-orbit-l${n}-count`, (v) => {
      orbitParams.layers[i].count = int(v);
      return String(orbitParams.layers[i].count);
    }, () => rebuildScene());
    bindRange(`orbit-l${n}-size`, `value-orbit-l${n}-size`, (v) => {
      orbitParams.layers[i].size = int(v);
      return String(int(v));
    });
    bindRange(`orbit-l${n}-speed`, `value-orbit-l${n}-speed`, (v) => {
      orbitParams.layers[i].speed = int(v);
      return String(int(v));
    });
    bindRange(`orbit-l${n}-radius`, `value-orbit-l${n}-radius`, (v) => {
      orbitParams.layers[i].radius = int(v);
      return String(int(v));
    });
    bindRange(`orbit-l${n}-rot`, `value-orbit-l${n}-rot`, (v) => {
      orbitParams.layers[i].rot = int(v);
      return `${int(v)}°`;
    });
    bindInput(`orbit-l${n}-color`, (v) => { orbitParams.layers[i].color = v; });
  }

  const seedBtn = document.getElementById('btn-orbit-random-seed');
  if (seedBtn) {
    seedBtn.addEventListener('click', () => {
      orbitParams.seed = floor(random(1_000_000_000));
      const seedEl = document.getElementById('orbit-seed');
      if (seedEl) seedEl.value = String(orbitParams.seed);
      rebuildScene();
    });
  }

  const paletteBtn = document.getElementById('btn-orbit-random-colors');
  if (paletteBtn) {
    paletteBtn.addEventListener('click', () => {
      const base = random(360);
      orbitParams.bg = toHexFromHsl(base, 18, 5);
      orbitParams.layers[0].color = toHexFromHsl((base + 320) % 360, 90, 56);
      orbitParams.layers[1].color = toHexFromHsl((base + 0) % 360, 10, 96);
      orbitParams.layers[2].color = toHexFromHsl((base + 300) % 360, 90, 56);
      const bg = document.getElementById('orbit-bg');
      if (bg) bg.value = orbitParams.bg;
      for (let i = 0; i < 3; i++) {
        const el = document.getElementById(`orbit-l${i + 1}-color`);
        if (el) el.value = orbitParams.layers[i].color;
      }
    });
  }
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

function rebuildScene() {
  randomSeed(int(orbitParams.seed));
  actors = [];
  for (let li = 0; li < orbitParams.layers.length; li++) {
    const layer = orbitParams.layers[li];
    for (let i = 0; i < layer.count; i++) {
      actors.push({
        layer: li,
        phase: random(TWO_PI),
        anchorX: random(width * 0.25, width * 0.75),
        anchorY: random(height * 0.25, height * 0.75),
        drift: random(0.6, 1.4),
      });
    }
  }
}

function draw() {
  background(orbitParams.bg);
  const t = millis() * 0.001;

  for (const actor of actors) {
    const layer = orbitParams.layers[actor.layer];
    const point = actorPoint(actor, layer, t);
    drawMirrored(point.x, point.y, radians(layer.rot), layer.shape, layer.size, layer.color);
  }
}

function actorPoint(actor, layer, t) {
  const speed = (layer.speed / 100) * actor.drift;
  const r = layer.radius;
  const tt = t * speed;

  let x = actor.anchorX;
  let y = actor.anchorY;
  if (layer.dir === 'circle') {
    x = width / 2 + cos(actor.phase + tt) * r;
    y = height / 2 + sin(actor.phase + tt) * r;
  } else {
    const vec = directionVector(layer.dir);
    x = actor.anchorX + vec.x * sin(actor.phase + tt) * r;
    y = actor.anchorY + vec.y * cos(actor.phase + tt) * r;
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

function drawMirrored(x, y, rot, shape, size, colorHex) {
  const m = constrain(orbitParams.mirror, 1, 5);
  fill(colorHex);
  for (let i = 0; i < m; i++) {
    const a = (TWO_PI * i) / m;
    push();
    translate(width / 2, height / 2);
    rotate(a);
    translate(x - width / 2, y - height / 2);
    rotate(rot + a);
    drawShape(shape, size);
    pop();
  }
}

function drawShape(shape, s) {
  if (shape === 'square') {
    rect(0, 0, s, s);
  } else if (shape === 'triangle') {
    const h = s * 1.1;
    triangle(0, -h / 2, -s / 2, h / 2, s / 2, h / 2);
  } else if (shape === 'diamond') {
    beginShape();
    vertex(0, -s / 2);
    vertex(s / 2, 0);
    vertex(0, s / 2);
    vertex(-s / 2, 0);
    endShape(CLOSE);
  } else {
    circle(0, 0, s);
  }
}

function toHexFromHsl(h, s, l) {
  colorMode(HSL, 360, 100, 100, 1);
  const c = color(h, s, l);
  colorMode(RGB, 255, 255, 255, 255);
  return `#${hex(red(c), 2)}${hex(green(c), 2)}${hex(blue(c), 2)}`;
}

