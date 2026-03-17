/* Grid blobs design tool — connected nodes on a grid, inspired by pearl-style compositions
 * Uses seeded randomness so composition stays fixed when only colors change.
 */

let directions = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
let raster = [];
let rows = 5;
let cols = 5;
let radius = 10;
let margin = 5;
let w;

// Composition is generated once per draw using p5's seeded random; color changes don't regenerate it.
let cachedRasters = [];

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
  roundness: 0.6,       // 0..1, used by rounded/mix
  layout: 'organic',    // organic | radial | striped
  connection: 'orthogonal', // none | orthogonal | all
  jitter: 0.1,          // 0..1 position offset inside each cell
  sizeJitter: 0.18,     // 0..1 random size variation per cell
  layerOffset: 0.16,    // 0..1 per-layer translation
  ringBias: 0.0,        // -1..1 center vs edge weighting
  stripeFreq: 4,
  holeChance: 0.06,     // 0..1
  alpha: 0.92           // 0..1 layer opacity
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

  bindControls();
  bindInfoButton();
  randomizeSeed();
  randomizeColors();
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
  const layoutEl = document.getElementById('param-layout');
  const connectionEl = document.getElementById('param-connection');
  const jitterEl = document.getElementById('param-jitter');
  const sizeJitterEl = document.getElementById('param-size-jitter');
  const layerOffsetEl = document.getElementById('param-layer-offset');
  const ringBiasEl = document.getElementById('param-ring-bias');
  const stripeFreqEl = document.getElementById('param-stripe-freq');
  const holeChanceEl = document.getElementById('param-hole-chance');
  const alphaEl = document.getElementById('param-alpha');
  const seedEl = document.getElementById('param-seed');
  const randomSeedBtn = document.getElementById('btn-random-seed');
  const bgEl = document.getElementById('param-bg');
  const colorEls = ['param-color1','param-color2','param-color3','param-color4','param-color5'];
  const randomColorsBtn = document.getElementById('btn-random-colors');

  if (rowsEl) {
    rowsEl.addEventListener('input', () => {
      params.rows = parseInt(rowsEl.value, 10);
      document.getElementById('value-rows').textContent = rowsEl.value;
      redraw();
    });
  }
  if (colsEl) {
    colsEl.addEventListener('input', () => {
      params.cols = parseInt(colsEl.value, 10);
      document.getElementById('value-cols').textContent = colsEl.value;
      redraw();
    });
  }
  if (densityEl) {
    densityEl.addEventListener('input', () => {
      params.density = parseInt(densityEl.value, 10) / 100;
      document.getElementById('value-density').textContent = densityEl.value + '%';
      redraw();
    });
  }
  if (marginEl) {
    marginEl.addEventListener('input', () => {
      params.marginPct = parseInt(marginEl.value, 10) / 100;
      document.getElementById('value-margin').textContent = marginEl.value + '%';
      redraw();
    });
  }
  if (strokeEl) {
    strokeEl.addEventListener('input', () => {
      params.strokeWeight = parseInt(strokeEl.value, 10);
      document.getElementById('value-stroke').textContent = strokeEl.value;
      redraw();
    });
  }
  if (layersEl) {
    layersEl.addEventListener('input', () => {
      params.layers = parseInt(layersEl.value, 10);
      const val = document.getElementById('value-layers');
      if (val) val.textContent = layersEl.value;
      redraw();
    });
  }
  const updateRoundnessEnabled = () => {
    if (!roundEl) return;
    const shape = shapeEl ? shapeEl.value : params.shape;
    const isRounded = shape === 'rounded' || shape === 'mix';
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
      redraw();
    });
  }
  if (shapeEl) {
    shapeEl.addEventListener('change', () => {
      params.shape = shapeEl.value;
      updateRoundnessEnabled();
      redraw();
    });
  }
  if (layoutEl) {
    layoutEl.addEventListener('change', () => {
      params.layout = layoutEl.value;
      redraw();
    });
  }
  if (connectionEl) {
    connectionEl.addEventListener('change', () => {
      params.connection = connectionEl.value;
      redraw();
    });
  }
  if (jitterEl) {
    jitterEl.addEventListener('input', () => {
      const pct = parseInt(jitterEl.value, 10);
      params.jitter = pct / 100;
      const val = document.getElementById('value-jitter');
      if (val) val.textContent = pct + '%';
      redraw();
    });
  }
  if (sizeJitterEl) {
    sizeJitterEl.addEventListener('input', () => {
      const pct = parseInt(sizeJitterEl.value, 10);
      params.sizeJitter = pct / 100;
      const val = document.getElementById('value-size-jitter');
      if (val) val.textContent = pct + '%';
      redraw();
    });
  }
  if (layerOffsetEl) {
    layerOffsetEl.addEventListener('input', () => {
      const pct = parseInt(layerOffsetEl.value, 10);
      params.layerOffset = pct / 100;
      const val = document.getElementById('value-layer-offset');
      if (val) val.textContent = pct + '%';
      redraw();
    });
  }
  if (ringBiasEl) {
    ringBiasEl.addEventListener('input', () => {
      const n = parseInt(ringBiasEl.value, 10);
      params.ringBias = n / 100;
      const val = document.getElementById('value-ring-bias');
      if (val) val.textContent = String(n);
      redraw();
    });
  }
  if (stripeFreqEl) {
    stripeFreqEl.addEventListener('input', () => {
      params.stripeFreq = parseInt(stripeFreqEl.value, 10);
      const val = document.getElementById('value-stripe-freq');
      if (val) val.textContent = stripeFreqEl.value;
      redraw();
    });
  }
  if (holeChanceEl) {
    holeChanceEl.addEventListener('input', () => {
      const pct = parseInt(holeChanceEl.value, 10);
      params.holeChance = pct / 100;
      const val = document.getElementById('value-hole-chance');
      if (val) val.textContent = pct + '%';
      redraw();
    });
  }
  if (alphaEl) {
    alphaEl.addEventListener('input', () => {
      const pct = parseInt(alphaEl.value, 10);
      params.alpha = pct / 100;
      const val = document.getElementById('value-alpha');
      if (val) val.textContent = pct + '%';
      redraw();
    });
  }
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      params.seed = parseInt(seedEl.value, 10) || 0;
      redraw();
    });
  }
  if (randomSeedBtn) {
    randomSeedBtn.addEventListener('click', () => {
      randomizeSeed();
      redraw();
    });
  }
  if (bgEl) {
    bgEl.addEventListener('input', () => {
      params.bg = bgEl.value;
      redraw();
    });
  }
  colorEls.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        params.colors[i] = el.value;
        redraw();
      });
    }
  });

  if (randomColorsBtn) {
    randomColorsBtn.addEventListener('click', () => {
      randomizeColors();
      redraw();
    });
  }

  updateRoundnessEnabled();
}

function draw() {
  rows = params.rows;
  cols = params.cols;
  margin = width * params.marginPct;
  const cellW = (width - 2 * margin) / cols;
  const cellH = (height - 2 * margin) / rows;
  radius = min(cellW, cellH) / 2;

  randomSeed(int(params.seed));
  cachedRasters = [];
  const numLayers = min(params.layers || params.colors.length, params.colors.length);
  for (let L = 0; L < numLayers; L++) {
    cachedRasters.push(create_raster(L));
  }

  background(params.bg);
  if (params.strokeWeight > 0) {
    strokeWeight(params.strokeWeight);
  } else {
    noStroke();
  }

  const palette = params.colors.map(hex => color(hex));
  for (let i = 0; i < cachedRasters.length; i++) {
    const c = color(palette[i]);
    c.setAlpha(255 * params.alpha);
    fill(c);
    stroke(c);
    const offScale = radius * params.layerOffset;
    const ox = (hash01(i + 1, 17, int(params.seed)) - 0.5) * 2 * offScale;
    const oy = (hash01(i + 1, 31, int(params.seed)) - 0.5) * 2 * offScale;
    draw_raster(cachedRasters[i], i, ox, oy);
  }
}

function draw_raster(raster, layerIndex, offX, offY) {
  const connectOrtho = params.connection === 'orthogonal' || params.connection === 'all';
  const connectDiag = params.connection === 'all';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let x = margin + radius + col * 2 * radius + offX;
      let y = margin + radius + row * 2 * radius + offY;
      const jAmt = radius * params.jitter;
      x += (hash01(row, col, 101 + layerIndex * 13 + int(params.seed)) - 0.5) * 2 * jAmt;
      y += (hash01(row, col, 202 + layerIndex * 17 + int(params.seed)) - 0.5) * 2 * jAmt;
      const sizeN = hash01(row, col, 303 + layerIndex * 19 + int(params.seed));
      const localRadius = max(1, radius * (1 + (sizeN - 0.5) * 2 * params.sizeJitter));

      if (raster[row][col] == 1) {
        drawCellShape(x, y, localRadius, row, col, layerIndex);

        if (connectOrtho && col + 1 < cols) {
          if (raster[row][col + 1] == 1) {
            rect(x + localRadius, y, localRadius);
          }
        }

        if (connectOrtho && row + 1 < rows) {
          if (raster[row + 1][col] == 1) {
            rect(x, y + localRadius, localRadius);
          }
        }

        if (connectDiag && (row + 1 < rows) && (col + 1 < cols)) {
          if (raster[row + 1][col + 1] == 1) {
            push();
            translate(x, y);
            beginShape();
            vertex(0, localRadius);
            for (let angle = -90; angle <= 0; angle += 1) {
              vertex(localRadius * cos(angle), localRadius * (2 + sin(angle)));
            }
            vertex(localRadius, 2 * localRadius);
            vertex(2 * localRadius, localRadius);
            for (let angle = 90; angle <= 180; angle += 1) {
              vertex(localRadius * (2 + cos(angle)), localRadius * (0 + sin(angle)));
            }
            vertex(localRadius, 0);
            endShape(CLOSE);
            pop();
          }
        }
        if (connectDiag && (row + 1 < rows) && (col - 1 >= 0)) {
          if (raster[row + 1][col - 1] == 1) {
            push();
            translate(x, y);
            beginShape();
            vertex(-localRadius, 0);
            for (let angle = 0; angle <= 90; angle += 1) {
              vertex(localRadius * (-2 + cos(angle)), localRadius * (0 + sin(angle)));
            }
            vertex(-2 * localRadius, localRadius);
            vertex(-localRadius, 2 * localRadius);
            for (let angle = 180; angle <= 270; angle += 1) {
              vertex(localRadius * (0 + cos(angle)), localRadius * (2 + sin(angle)));
            }
            vertex(0, localRadius);
            endShape(CLOSE);
            pop();
          }
        }
      }
    }
  }
}

function drawCellShape(x, y, localRadius, row, col, layerIndex) {
  let shape = params.shape || 'circle';
  if (shape === 'mix') {
    const opts = ['circle', 'square', 'rounded', 'triangle'];
    const pick = floor(hash01(row, col, layerIndex + int(params.seed) + 999) * opts.length) % opts.length;
    shape = opts[pick];
  }
  if (shape === 'square') {
    rect(x, y, localRadius);
  } else if (shape === 'rounded') {
    const corner = localRadius * (params.roundness != null ? params.roundness : 0.6);
    rect(x, y, localRadius, localRadius, corner);
  } else if (shape === 'triangle') {
    triangle(
      x,
      y - localRadius,
      x - localRadius,
      y + localRadius,
      x + localRadius,
      y + localRadius
    );
  } else {
    circle(x, y, 2 * localRadius);
  }
}

function create_raster(layerIndex) {
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
    const first = chooseWeightedCell(grid, layerIndex);
    const r = first[0];
    const c = first[1];
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
    const weighted = neighbors.map(([nr, nc]) => ({ r: nr, c: nc, w: cellPriority(nr, nc, layerIndex) }));
    const choice = pickWeighted(weighted);
    const nr = choice.r;
    const nc = choice.c;
    grid[nr][nc] = 1;
    stack.push([nr, nc]);
    filled++;
  }
  while (filled < numFilled) {
    const loose = chooseWeightedCell(grid, layerIndex);
    const r = loose[0];
    const c = loose[1];
    if (grid[r][c] === 0) {
      grid[r][c] = 1;
      filled++;
    }
  }

  if (params.holeChance > 0) {
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        if (grid[row][col] !== 1) continue;
        const surrounded =
          grid[row - 1][col] === 1 &&
          grid[row + 1][col] === 1 &&
          grid[row][col - 1] === 1 &&
          grid[row][col + 1] === 1;
        if (surrounded && random() < params.holeChance) {
          grid[row][col] = 0;
        }
      }
    }
  }

  return grid;
}

function chooseWeightedCell(grid, layerIndex) {
  const picks = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col] === 0) {
        picks.push({ r: row, c: col, w: cellPriority(row, col, layerIndex) });
      }
    }
  }
  const pick = pickWeighted(picks);
  return [pick.r, pick.c];
}

function pickWeighted(items) {
  let sum = 0;
  for (const it of items) sum += max(0.0001, it.w);
  let t = random(sum);
  for (const it of items) {
    t -= max(0.0001, it.w);
    if (t <= 0) return it;
  }
  return items[items.length - 1];
}

function cellPriority(row, col, layerIndex) {
  const cx = (cols - 1) * 0.5;
  const cy = (rows - 1) * 0.5;
  const dx = (col - cx) / max(1, cols - 1);
  const dy = (row - cy) / max(1, rows - 1);
  const dist = constrain(sqrt(dx * dx + dy * dy) * 1.8, 0, 1);

  let weight = 1.0;
  if (params.layout === 'radial') {
    const target = map(params.ringBias, -1, 1, 0.1, 0.8);
    const falloff = max(0.08, 1.0 - abs(dist - target) * 2.5);
    weight *= falloff * 2.0;
  } else if (params.layout === 'striped') {
    const phase = (col / max(1, cols - 1)) * TWO_PI * params.stripeFreq + layerIndex * 0.8;
    const stripe = (sin(phase) + 1) * 0.5;
    weight *= 0.35 + stripe * 1.8;
  } else {
    if (params.ringBias >= 0) {
      weight *= 0.4 + dist * (1.2 + params.ringBias);
    } else {
      weight *= 0.4 + (1 - dist) * (1.2 + abs(params.ringBias));
    }
  }

  const noise = 0.8 + hash01(row, col, 511 + layerIndex * 23 + int(params.seed)) * 0.6;
  return max(0.0001, weight * noise);
}

function hash01(a, b, c) {
  const n = sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return n - floor(n);
}
