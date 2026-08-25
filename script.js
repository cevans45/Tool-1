/* Grid blobs design tool — connected nodes on a grid, inspired by pearl-style compositions
 * Uses seeded randomness so composition stays fixed when only colors change.
 *
 * The composition is built once into `comp` (nodes = particles, edges = bleed between them).
 * Each node also carries its geodesic distance from an endpoint of its blob, which lets the
 * animation travel *through* the structure instead of pulsing everything at once.
 */

let directions = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
let rows = 5;
let cols = 5;
let radius = 10;
let margin = 5;
let w;

// Built once per composition change; color/animation changes never regenerate it.
let comp = { layers: [] };
let compDirty = true;
let animTime = 0;
// The tab is the mode: Composition renders the clean still, Animation renders the charge
// (moving while playing, frozen on the current frame while paused).
let uiTab = 'composition';

let params = {
  rows: 5,
  cols: 5,
  density: 0.25,
  marginPct: 0.1,
  bg: '#e8e4d9',
  colors: ['#F1E9DA', '#2E294E', '#541388', '#FFD400', '#D90368'],
  strokeWeight: 0,
  seed: 123456789,
  layers: 5,
  shape: 'circle',      // circle | square | rounded | triangle
  roundness: 0.6,       // 0..1, only used for rounded
  anim: {
    playing: true,
    mode: 'current',    // current | static | storm | comet | breathe
    speed: 0.6,
    spread: 2.2,        // wave cycles along the length of each blob
    desync: 0.35,       // per-particle phase scatter, so nothing moves in unison
    reverse: false,
    pulse: 0.55,        // particle size swell as the charge passes
    jitter: 0.25,
    flicker: 0.45,
    bleed: 0.7,         // how hard the connections pinch between pulses
    sparks: 0.6,
    crackle: 0.35,
    trails: 0.25,
    glow: 0.5,
    spark: '#ffffff'
  }
};

// Below this presence a particle or connection drops out of the frame entirely.
const BLINK_OUT = 0.3;

// Per-style character. Sliders scale these; the style sets the personality.
const ANIM_MODES = {
  current: { wave: 0.85, staticW: 0.18, shape: 'cos', tight: 5, staticFreq: 0.9, jitterMul: 0.5, dropout: 0.05 },
  static: { wave: 0.28, staticW: 0.78, shape: 'cos', tight: 2, staticFreq: 3.4, jitterMul: 1.7, dropout: 0.25 },
  storm: { wave: 0.62, staticW: 0.42, shape: 'comet', tight: 8, staticFreq: 2.2, jitterMul: 1.2, dropout: 0.4 },
  comet: { wave: 1.0, staticW: 0.04, shape: 'comet', tight: 14, staticFreq: 0.6, jitterMul: 0.3, dropout: 0 },
  breathe: { wave: 1.0, staticW: 0.1, shape: 'cos', tight: 1.2, staticFreq: 0.35, jitterMul: 0.15, dropout: 0 }
};

function randomizeSeed() {
  // Keep seed in the same range as the UI input (0..999999999).
  const next = Math.floor(Math.random() * 1_000_000_000);
  params.seed = next;
  const seedEl = document.getElementById('param-seed');
  if (seedEl) seedEl.value = String(next);
}

function hslToHex(h, s, l) {
  // h: 0..360, s/l: 0..100
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

function randomPalette() {
  // Pleasant defaults: light background + saturated accents.
  const bg = hslToHex(Math.random() * 360, 25 + Math.random() * 15, 88 + Math.random() * 8);
  const baseHue = Math.random() * 360;
  const accents = Array.from({ length: 5 }, (_, i) => {
    const hue = (baseHue + i * (360 / 5) + (Math.random() * 30 - 15)) % 360;
    const sat = 65 + Math.random() * 25;
    const lit = 38 + Math.random() * 18;
    return hslToHex(hue, sat, lit);
  });
  return { bg, accents };
}

function randomizeColors() {
  const { bg, accents } = randomPalette();
  params.bg = bg;
  params.colors = accents;

  const bgEl = document.getElementById('param-bg');
  if (bgEl) bgEl.value = bg;
  for (let i = 0; i < accents.length; i++) {
    const el = document.getElementById(`param-color${i + 1}`);
    if (el) el.value = accents[i];
  }
}

function setup() {
  w = min(windowWidth - 320, windowHeight - 48);
  w = max(w, 300);
  const canvas = createCanvas(w, w);
  canvas.parent('sketch-container');

  rectMode(RADIUS);
  angleMode(DEGREES);

  randomizeSeed();
  randomizeColors();
  bindControls();
  bindTabs();
  bindAnimControls();
  bindInfoButton();
  compDirty = true;
  noLoop();
  redraw();
}

function bindInfoButton() {
  const btn = document.getElementById('info-btn');
  const overlay = document.getElementById('info-overlay');
  const closeBtn = document.getElementById('info-close');
  if (!btn || !overlay) return;
  btn.addEventListener('click', () => {
    overlay.hidden = false;
  });
  if (closeBtn) {
    closeBtn.addEventListener('click', () => { overlay.hidden = true; });
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
}

function isPlaying() {
  return uiTab === 'animation' && params.anim.playing;
}

function updateLoopState() {
  if (isPlaying()) {
    loop();
  } else {
    noLoop();
    redraw();
  }
}

// Re-render now when the loop is idle; while playing the draw loop already covers it.
function requestRender() {
  if (!isPlaying()) redraw();
}

function rebuild() {
  compDirty = true;
  requestRender();
}

function bindTabs() {
  const buttons = [
    ['composition', document.getElementById('tab-composition')],
    ['animation', document.getElementById('tab-animation')]
  ];
  const panes = Array.from(document.querySelectorAll('[data-tab]'));
  if (!panes.length) return;

  const show = (name) => {
    uiTab = name;
    panes.forEach((pane) => {
      pane.style.display = pane.dataset.tab === name ? '' : 'none';
    });
    buttons.forEach(([key, btn]) => {
      if (btn) btn.classList.toggle('is-active', key === name);
    });
    updateLoopState();
  };

  buttons.forEach(([key, btn]) => {
    if (btn) btn.addEventListener('click', () => show(key));
  });
  show('composition');
}

function bindControls() {
  const rowsEl = document.getElementById('param-rows');
  const colsEl = document.getElementById('param-cols');
  const densityEl = document.getElementById('param-density');
  const marginEl = document.getElementById('param-margin');
  const strokeEl = document.getElementById('param-stroke');
  const layersEl = document.getElementById('param-layers');
  const roundEl = document.getElementById('param-roundness');
  const roundRow = document.getElementById('row-roundness');
  const shapeEl = document.getElementById('param-shape');
  const seedEl = document.getElementById('param-seed');
  const bgEl = document.getElementById('param-bg');
  const colorEls = ['param-color1','param-color2','param-color3','param-color4','param-color5'];
  const randomColorsBtn = document.getElementById('btn-random-colors');

  if (rowsEl) {
    rowsEl.addEventListener('input', () => {
      params.rows = parseInt(rowsEl.value, 10);
      document.getElementById('value-rows').textContent = rowsEl.value;
      rebuild();
    });
  }
  if (colsEl) {
    colsEl.addEventListener('input', () => {
      params.cols = parseInt(colsEl.value, 10);
      document.getElementById('value-cols').textContent = colsEl.value;
      rebuild();
    });
  }
  if (densityEl) {
    densityEl.addEventListener('input', () => {
      params.density = parseInt(densityEl.value, 10) / 100;
      document.getElementById('value-density').textContent = densityEl.value + '%';
      rebuild();
    });
  }
  if (marginEl) {
    marginEl.addEventListener('input', () => {
      params.marginPct = parseInt(marginEl.value, 10) / 100;
      document.getElementById('value-margin').textContent = marginEl.value + '%';
      rebuild();
    });
  }
  if (strokeEl) {
    strokeEl.addEventListener('input', () => {
      params.strokeWeight = parseInt(strokeEl.value, 10);
      document.getElementById('value-stroke').textContent = strokeEl.value;
      requestRender();
    });
  }
  if (layersEl) {
    layersEl.addEventListener('input', () => {
      params.layers = parseInt(layersEl.value, 10);
      const val = document.getElementById('value-layers');
      if (val) val.textContent = layersEl.value;
      rebuild();
    });
  }
  const updateRoundnessEnabled = () => {
    if (!roundEl) return;
    const isRounded = (shapeEl ? shapeEl.value : params.shape) === 'rounded';
    roundEl.disabled = !isRounded;
    if (roundRow) {
      roundRow.classList.toggle('control-row--disabled', !isRounded);
    }
  };

  if (roundEl) {
    roundEl.addEventListener('input', () => {
      const pct = parseInt(roundEl.value, 10);
      params.roundness = pct / 100;
      const val = document.getElementById('value-roundness');
      if (val) val.textContent = pct + '%';
      requestRender();
    });
  }
  if (shapeEl) {
    shapeEl.addEventListener('change', () => {
      params.shape = shapeEl.value;
      updateRoundnessEnabled();
      requestRender();
    });
  }
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      params.seed = parseInt(seedEl.value, 10) || 0;
      rebuild();
    });
  }
  if (bgEl) {
    bgEl.addEventListener('input', () => {
      params.bg = bgEl.value;
      requestRender();
    });
  }
  colorEls.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        params.colors[i] = el.value;
        requestRender();
      });
    }
  });

  if (randomColorsBtn) {
    randomColorsBtn.addEventListener('click', () => {
      randomizeColors();
      requestRender();
    });
  }

  updateRoundnessEnabled();
}

function bindAnimControls() {
  const anim = params.anim;

  const toggleBtn = document.getElementById('btn-anim-toggle');
  const setPlaying = (on) => {
    anim.playing = on;
    if (toggleBtn) {
      toggleBtn.textContent = on ? 'Pause' : 'Play';
      toggleBtn.classList.toggle('is-active', on);
    }
    updateLoopState();
  };
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => setPlaying(!anim.playing));
  }

  const modeEl = document.getElementById('param-anim-mode');
  if (modeEl) {
    modeEl.addEventListener('change', () => {
      anim.mode = modeEl.value;
      requestRender();
    });
  }

  const reverseEl = document.getElementById('param-anim-reverse');
  if (reverseEl) {
    reverseEl.addEventListener('change', () => {
      anim.reverse = reverseEl.checked;
      requestRender();
    });
  }

  const pct = (v) => v + '%';
  const mult = (v) => (v / 100).toFixed(1) + '\u00d7';
  const plain = (v) => (v / 100).toFixed(1);

  const sliders = [
    ['speed', mult],
    ['spread', plain],
    ['desync', pct],
    ['pulse', pct],
    ['jitter', pct],
    ['flicker', pct],
    ['bleed', pct],
    ['sparks', pct],
    ['crackle', pct],
    ['trails', pct],
    ['glow', pct]
  ];
  sliders.forEach(([key, fmt]) => {
    const el = document.getElementById(`param-anim-${key}`);
    const val = document.getElementById(`value-anim-${key}`);
    if (!el) return;
    el.value = String(Math.round(anim[key] * 100));
    if (val) val.textContent = fmt(parseInt(el.value, 10));
    el.addEventListener('input', () => {
      const raw = parseInt(el.value, 10);
      anim[key] = raw / 100;
      if (val) val.textContent = fmt(raw);
      requestRender();
    });
  });

  const sparkEl = document.getElementById('param-anim-spark');
  if (sparkEl) {
    sparkEl.value = anim.spark;
    sparkEl.addEventListener('input', () => {
      anim.spark = sparkEl.value;
      requestRender();
    });
  }

  if (modeEl) modeEl.value = anim.mode;
  if (reverseEl) reverseEl.checked = anim.reverse;
  setPlaying(anim.playing);
}

/* ── Composition ────────────────────────────────────────────────── */

function buildComposition() {
  rows = params.rows;
  cols = params.cols;
  margin = width * params.marginPct;
  const cellW = (width - 2 * margin) / cols;
  const cellH = (height - 2 * margin) / rows;
  radius = min(cellW, cellH) / 2;

  randomSeed(int(params.seed));
  noiseSeed(int(params.seed));

  const numLayers = min(params.layers || params.colors.length, params.colors.length);
  const rasters = [];
  for (let L = 0; L < numLayers; L++) rasters.push(create_raster());

  // Graph build draws its own random numbers, so it runs on a separate stream — otherwise
  // it would shift the sequence and change the composition a given seed produces.
  randomSeed(int(params.seed) + 977);
  comp = { layers: rasters.map((grid, L) => buildLayer(grid, L)) };
  compDirty = false;
}

/** Breadth-first distances over the blob graph, plus visit order. */
function bfsDistances(start, adj, count) {
  const dist = new Array(count).fill(-1);
  dist[start] = 0;
  const order = [start];
  for (let head = 0; head < order.length; head++) {
    const cur = order[head];
    for (const nb of adj[cur]) {
      if (dist[nb] === -1) {
        dist[nb] = dist[cur] + 1;
        order.push(nb);
      }
    }
  }
  return { dist, order };
}

/** Wrap a raster into particles + bleed edges, with a flow distance per particle. */
function buildLayer(grid, layerIndex) {
  const index = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const nodes = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] !== 1) continue;
      index[row][col] = nodes.length;
      nodes.push({
        row,
        col,
        x: margin + radius + col * 2 * radius,
        y: margin + radius + row * 2 * radius,
        dist: 0,
        distNorm: 0,
        compPhase: 0,
        phase: random(),
        nx: col * 0.37 + layerIndex * 13.7,
        ny: row * 0.37 + layerIndex * 7.3,
        jx: random(500),
        jy: random(500),
        out: []
      });
    }
  }

  const adj = nodes.map(() => []);
  const edges = [];
  // Only forward links, so each bleed connection is stored once.
  const links = [[0, 1, 'h'], [1, 0, 'v'], [1, 1, 'dr'], [1, -1, 'dl']];
  for (const node of nodes) {
    const ai = index[node.row][node.col];
    for (const [dr, dc, kind] of links) {
      const nr = node.row + dr;
      const nc = node.col + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc] !== 1) continue;
      const bi = index[nr][nc];
      adj[ai].push(bi);
      adj[bi].push(ai);
      const edge = { a: ai, b: bi, kind };
      edges.push(edge);
      node.out.push(edge);
    }
  }

  // Per blob, run the charge from one end of its longest path to the other.
  const seen = new Array(nodes.length).fill(false);
  for (let i = 0; i < nodes.length; i++) {
    if (seen[i]) continue;
    const probe = bfsDistances(i, adj, nodes.length);
    let far = i;
    for (const idx of probe.order) {
      if (probe.dist[idx] > probe.dist[far]) far = idx;
    }
    const run = bfsDistances(far, adj, nodes.length);
    let maxDist = 1;
    for (const idx of run.order) maxDist = max(maxDist, run.dist[idx]);
    const compPhase = random();
    for (const idx of run.order) {
      seen[idx] = true;
      nodes[idx].dist = run.dist[idx];
      nodes[idx].distNorm = run.dist[idx] / maxDist;
      nodes[idx].compPhase = compPhase;
    }
  }

  for (const edge of edges) {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    // The bleed inherits the flow position between the two particles it joins.
    edge.distNorm = (a.distNorm + b.distNorm) / 2;
    edge.phase = (a.phase + b.phase) / 2;
    edge.compPhase = a.compPhase;
    edge.nx = (a.nx + b.nx) / 2 + 3.1;
    edge.ny = (a.ny + b.ny) / 2 + 8.7;
    // Sparks always run downstream.
    edge.flip = a.dist > b.dist;
  }

  return { grid, nodes, edges, state: nodes.map(() => ({ a: 0, level: 1, ox: 0, oy: 0 })) };
}

/* ── Animation ──────────────────────────────────────────────────── */

function animConfig() {
  const a = params.anim;
  const mode = ANIM_MODES[a.mode] || ANIM_MODES.current;
  return {
    on: uiTab === 'animation',
    spread: a.spread,
    desync: a.desync,
    reverse: !!a.reverse,
    wave: mode.wave,
    staticW: mode.staticW,
    shape: mode.shape,
    tight: mode.tight * (1 + a.crackle * 0.8),
    staticFreq: mode.staticFreq,
    dropout: mode.dropout * (0.4 + a.crackle * 1.6),
    jitter: a.jitter * mode.jitterMul,
    pulse: a.pulse,
    flicker: a.flicker,
    bleed: a.bleed,
    sparks: a.sparks,
    crackle: a.crackle,
    glow: a.glow,
    spark: a.spark
  };
}

/** How charged a particle or bleed edge is right now, 0..1. */
function activation(item, cfg) {
  const dir = cfg.reverse ? -1 : 1;
  const phase = item.distNorm * cfg.spread * dir - animTime + item.compPhase + item.phase * cfg.desync;
  const wrapped = phase - Math.floor(phase);
  const wave = cfg.shape === 'comet'
    ? Math.exp(-wrapped * cfg.tight)
    : Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * wrapped), cfg.tight);

  let a = cfg.wave * wave + cfg.staticW * noise(item.nx, item.ny, animTime * cfg.staticFreq * 1.6);
  if (cfg.crackle > 0) {
    const sparkle = noise(item.nx * 2.5 + 40, item.ny * 2.5 + 90, animTime * (3 + cfg.crackle * 12));
    a += cfg.crackle * (sparkle - 0.38) * 0.95;
  }
  return constrain(a, 0, 1);
}

/** How present a particle or edge is, 0..1. */
function chargeLevel(item, a, cfg) {
  let level = 1;
  if (cfg.flicker > 0) {
    const n = noise(item.nx * 1.7 + 5.5, item.ny * 1.7 + 2.1, animTime * (1.5 + cfg.crackle * 6));
    level = 1 - cfg.flicker * (1 - constrain(a * 1.15, 0, 1)) * (0.3 + n * 0.95);
  }
  if (cfg.dropout > 0) {
    const n = noise(item.nx * 2.3 + 70, item.ny * 2.3 + 33, animTime * (2.5 + cfg.crackle * 8));
    if (n < cfg.dropout * (1 - a) * 0.85) level = 0;
  }
  return constrain(level, 0, 1);
}

/* ── Draw ───────────────────────────────────────────────────────── */

function draw() {
  if (compDirty) buildComposition();

  const cfg = animConfig();
  if (isPlaying()) {
    animTime += min(deltaTime || 16, 60) / 1000 * params.anim.speed;
  }

  paintBackground(cfg);

  if (params.strokeWeight > 0) {
    strokeWeight(params.strokeWeight);
  } else {
    noStroke();
  }

  const palette = params.colors.map(hex => color(hex));
  for (let i = 0; i < comp.layers.length; i++) {
    if (cfg.on) {
      renderLayerAnimated(comp.layers[i], palette[i], cfg);
    } else {
      fill(palette[i]);
      stroke(palette[i]);
      renderLayerStatic(comp.layers[i]);
    }
  }

  drawingContext.shadowBlur = 0;
}

function paintBackground(cfg) {
  // Only smear frames while time is actually moving, so a paused frame stays clean
  // no matter how many times it gets redrawn.
  const trails = isPlaying() ? params.anim.trails : 0;
  if (trails <= 0.001) {
    background(params.bg);
    return;
  }
  // Partial wipe leaves the previous frames behind as a decaying trail.
  push();
  const veil = color(params.bg);
  veil.setAlpha(map(trails, 0, 1, 200, 12));
  noStroke();
  fill(veil);
  rectMode(CORNER);
  rect(0, 0, width, height);
  pop();
}

function renderLayerStatic(layer) {
  const diagonalsOn = params.shape === 'circle';
  for (const node of layer.nodes) {
    drawCellShape(node.x, node.y, radius);
    for (const edge of node.out) {
      if (!diagonalsOn && (edge.kind === 'dr' || edge.kind === 'dl')) continue;
      drawBleed(edge.kind, node.x, node.y, radius, 1, null);
    }
  }
}

function renderLayerAnimated(layer, baseColor, cfg) {
  const nodes = layer.nodes;
  const state = layer.state;
  const useStroke = params.strokeWeight > 0;

  const br = red(baseColor), bgr = green(baseColor), bb = blue(baseColor);
  const sparkColor = color(cfg.spark);
  const sr = red(sparkColor), sg = green(sparkColor), sb = blue(sparkColor);
  const canvasBg = color(params.bg);
  const kr = red(canvasBg), kg = green(canvasBg), kb = blue(canvasBg);
  const jitterFreq = 0.6 + cfg.staticFreq + cfg.crackle * 5;

  // Everything stays opaque: dimming mixes toward the background and heat mixes toward the
  // spark color, so overlapping particles and bleed still read as one solid blob.
  const paint = (mix, level) => {
    const fade = map(constrain(level, BLINK_OUT, 1), BLINK_OUT, 1, 0.4, 1);
    const m = constrain(mix, 0, 1);
    let r = kr + (br - kr) * fade;
    let g = kg + (bgr - kg) * fade;
    let b = kb + (bb - kb) * fade;
    r += (sr - r) * m;
    g += (sg - g) * m;
    b += (sb - b) * m;
    fill(r, g, b);
    if (useStroke) stroke(r, g, b);
  };

  // Pass 1: charge each particle, so the bleed can follow the particles it joins.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const s = state[i];
    s.a = activation(node, cfg);
    s.level = chargeLevel(node, s.a, cfg);
    if (cfg.jitter > 0) {
      const amp = radius * cfg.jitter * (0.3 + s.a * 0.9);
      s.ox = (noise(node.jx, animTime * jitterFreq) - 0.5) * 2 * amp;
      s.oy = (noise(node.jy, animTime * jitterFreq) - 0.5) * 2 * amp;
    } else {
      s.ox = 0;
      s.oy = 0;
    }
  }

  // Pass 2: bleed. Necks thin out between pulses and swell as the charge arrives.
  const diagonalsOn = params.shape === 'circle';
  for (const edge of layer.edges) {
    const sa = state[edge.a];
    const sb2 = state[edge.b];
    edge.charge = activation(edge, cfg);
    // A connection can only carry charge while both of its particles are present.
    edge.level = chargeLevel(edge, edge.charge, cfg) * min(sa.level, sb2.level);
    if (!diagonalsOn && (edge.kind === 'dr' || edge.kind === 'dl')) continue;
    if (edge.level < BLINK_OUT) continue;
    const ox = (sa.ox + sb2.ox) / 2;
    const oy = (sa.oy + sb2.oy) / 2;
    const thickness = 1 - cfg.bleed * 0.88 * (1 - edge.charge);
    paint(cfg.glow * edge.charge * 0.7, edge.level);
    drawBleed(edge.kind, nodes[edge.a].x + ox, nodes[edge.a].y + oy, radius, thickness, edge.charge);
  }

  // Pass 3: particles on top of their connections.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const s = state[i];
    if (s.level < BLINK_OUT) continue;
    const scale = 1 + cfg.pulse * (s.a - 0.35);
    const r = radius * max(0.05, scale);
    if (cfg.glow > 0 && s.a > 0.68) {
      drawingContext.shadowBlur = radius * 1.1 * cfg.glow * s.a;
      drawingContext.shadowColor = cfg.spark;
    } else {
      drawingContext.shadowBlur = 0;
    }
    paint(cfg.glow * s.a, s.level);
    drawCellShape(node.x + s.ox, node.y + s.oy, r);
  }
  drawingContext.shadowBlur = 0;

  // Pass 4: sparks riding downstream through the lines.
  if (cfg.sparks > 0.01) {
    for (const edge of layer.edges) {
      const a = edge.charge;
      if (a < 0.34) continue;
      const from = edge.flip ? nodes[edge.b] : nodes[edge.a];
      const to = edge.flip ? nodes[edge.a] : nodes[edge.b];
      const fromState = edge.flip ? state[edge.b] : state[edge.a];
      const toState = edge.flip ? state[edge.a] : state[edge.b];
      const travel = animTime * (1.2 + cfg.sparks * 2.4) + edge.phase * 1.7;
      const f = travel - Math.floor(travel);
      const x = lerp(from.x + fromState.ox, to.x + toState.ox, f);
      const y = lerp(from.y + fromState.oy, to.y + toState.oy, f);
      // Sparks fade in and out by size, keeping the fill opaque.
      const size = radius * (0.1 + 0.24 * cfg.sparks) * (0.5 + a) * min(1, (a - 0.34) * 4);
      if (size < 0.4) continue;
      if (cfg.glow > 0) {
        drawingContext.shadowBlur = size * 2.2 * cfg.glow;
        drawingContext.shadowColor = cfg.spark;
      }
      fill(sr, sg, sb);
      if (useStroke) stroke(sr, sg, sb);
      circle(x, y, size * 2);
    }
    drawingContext.shadowBlur = 0;
  }
}

/** Bleed between two adjacent particles: a bar for orthogonal, a fillet for diagonal. */
function drawBleed(kind, x, y, r, thickness, charge) {
  const t = constrain(thickness, 0.04, 1);
  if (kind === 'h') {
    rect(x + r, y, r, r * t);
  } else if (kind === 'v') {
    rect(x, y + r, r * t, r);
  } else if (kind === 'dr') {
    drawFilletRight(x, y, r, charge);
  } else {
    drawFilletLeft(x, y, r, charge);
  }
}

/** Concave corner joining a particle to its down-right neighbour. */
function drawFilletRight(x, y, r, charge) {
  const step = charge != null ? 4 : 1;
  push();
  translate(x, y);
  beginShape();
  vertex(0, r);
  for (let angle = -90; angle <= 0; angle += step) {
    vertex(r * cos(angle), r * (2 + sin(angle)));
  }
  vertex(r, 2 * r);
  vertex(2 * r, r);
  for (let angle = 90; angle <= 180; angle += step) {
    vertex(r * (2 + cos(angle)), r * sin(angle));
  }
  vertex(r, 0);
  endShape(CLOSE);
  pop();
}

/** Concave corner joining a particle to its down-left neighbour. */
function drawFilletLeft(x, y, r, charge) {
  const step = charge != null ? 4 : 1;
  push();
  translate(x, y);
  beginShape();
  vertex(-r, 0);
  for (let angle = 0; angle <= 90; angle += step) {
    vertex(r * (-2 + cos(angle)), r * sin(angle));
  }
  vertex(-2 * r, r);
  vertex(-r, 2 * r);
  for (let angle = 180; angle <= 270; angle += step) {
    vertex(r * cos(angle), r * (2 + sin(angle)));
  }
  vertex(0, r);
  endShape(CLOSE);
  pop();
}

function drawCellShape(x, y, r) {
  const shape = params.shape || 'circle';
  if (shape === 'square') {
    rect(x, y, r);
  } else if (shape === 'rounded') {
    const corner = r * (params.roundness != null ? params.roundness : 0.6);
    rect(x, y, r, r, corner);
  } else if (shape === 'triangle') {
    triangle(x, y - r, x - r, y + r, x + r, y + r);
  } else {
    circle(x, y, 2 * r);
  }
}

function create_raster() {
  var grid = new Array(rows);
  for (var i = 0; i < grid.length; i++) {
    grid[i] = new Array(cols);
  }
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      grid[row][col] = 0;
    }
  }

  const total = rows * cols;
  const numFilled = max(1, floor(total * params.density));
  const numSeeds = max(1, floor(random(2, 6)));
  const seeds = [];
  for (let s = 0; s < numSeeds; s++) {
    const r = floor(random(rows));
    const c = floor(random(cols));
    if (grid[r][c] === 0) {
      grid[r][c] = 1;
      seeds.push([r, c]);
    }
  }
  let filled = seeds.length;
  const stack = [...seeds];
  while (filled < numFilled && stack.length > 0) {
    const idx = floor(random(stack.length));
    const [r, c] = stack[idx];
    const neighbors = [];
    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 0) {
        neighbors.push([nr, nc]);
      }
    }
    if (neighbors.length === 0) {
      stack.splice(idx, 1);
      continue;
    }
    const pick = floor(random(neighbors.length));
    const [nr, nc] = neighbors[pick];
    grid[nr][nc] = 1;
    stack.push([nr, nc]);
    filled++;
  }
  while (filled < numFilled) {
    const r = floor(random(rows));
    const c = floor(random(cols));
    if (grid[r][c] === 0) {
      grid[r][c] = 1;
      filled++;
    }
  }
  return grid;
}
