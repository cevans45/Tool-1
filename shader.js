let theShader;
let activePreset = 'prism';

const params = {
  cycleDuration: 78.5,
  blackHold: 0.0,
  fadeIn: 2.0,
  fadeOut: 5.0,
  zoomMin: 0.1,
  zoomMax: 3.0,
  zoomSpeed: 0.1,
  mirrorMin: 3.0,
  mirrorSpan: 6.0,
  rotationStartPct: 60.0,
  rotationMaxDeg: 90.0,
  brightness: 0.8,
  warp: 1.2,
  stripes: 5.0,
  pulse: 0.9,
  grain: 0.06,
  weaveAmt: 0.65,
  starAmt: 0.45,
  ringAmt: 0.55,
  contrast: 1.2,
  vignette: 2.6,
  useGrain: true,
  useDots: false,
  textureMode: 'grain',
  cellularity: 0.8,
  cellDensity: 120.0,
  cellSoftness: 0.14,
  cellShift: 0.3,
  hueShift: 0.0,
  paletteSpread: 1.0,
  saturation: 1.0,
  tintAmount: 0.0,
  tintColor: [1.0, 0.1647, 0.6314],
  grainSeed: 0.0,
  baseSeed: 0.0,
  lockSeed: false,
  fixedSeed: 0.0,
};

const fx = {
  bloom: { petals: 6, breath: 0.5, jag: 0.3, inner: 0.4, spoke: 0.25, mirror: false },
  grid:  { ripple: 8, connect: 0.5, nodes: 0.5, damp: 0.3, diagonal: 0, mirror: false },
  ember: { trail: 30, field: 2, size: 0.3, wind: 0.4, glow: 0.5, mirror: false },
  mirrorS: { depth: 30, flicker: 0.4, edge: 0.5, twist: 0.2, gap: 0.15, shards: 6 },
  lattice: { wave: 6, morph: 0.5, phase: 0, glow: 0.4, gap: 0.5, mirror: false },
  silk: { curl: 0.5, ribbon: 0.3, layers: 3, fade: 0.3, cross: 0.2, mirror: false },
};

/* ── Prism Weave GLSL ─────────────────────────────────────────── */

const vert = `
  precision highp float;
  attribute vec3 aPosition;
  void main() { gl_Position = vec4(aPosition, 1.0); }
`;

const frag = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time, u_zoom, u_opacity, u_seed, u_rotation;
  uniform float u_mirror_min, u_mirror_span, u_brightness, u_warp, u_stripes, u_pulse;
  uniform float u_grain, u_weave, u_star, u_ring, u_contrast, u_vignette;
  uniform float u_use_grain, u_use_dots, u_grain_seed, u_pix_d;
  uniform float u_cellularity, u_cell_density, u_cell_softness, u_cell_shift;
  uniform float u_hue_shift, u_palette_spread, u_saturation;
  uniform vec3 u_tint_color;
  uniform float u_tint_amount;

  vec3 palette(float t) {
    vec3 a = vec3(0.56, 0.52, 0.48);
    vec3 b = vec3(0.40, 0.44, 0.46);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.01, 0.18, 0.42) * u_palette_spread;
    return a + b * cos(6.28318 * (c * (t + u_hue_shift) + d));
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float rand(vec2 n) {
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
  }
  vec2 fold(vec2 p, float n) {
    float r = length(p);
    float a = atan(p.y, p.x) - 1.5708;
    float tau = 6.28318;
    a = mod(a, tau / n) - tau / (n * 2.0);
    a = abs(a);
    return vec2(cos(a), sin(a)) * r;
  }
  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.y, u_resolution.x);
    float span = max(1.0, floor(u_mirror_span));
    float numMirrors = max(2.0, floor(u_mirror_min + mod(u_seed, span)));
    p = fold(p, numMirrors);
    float cosR = cos(u_rotation); float sinR = sin(u_rotation);
    p = vec2(p.x * cosR - p.y * sinR, p.x * sinR + p.y * cosR);
    p *= u_zoom;
    float t = u_time * 0.25;
    float r = length(p);
    float a = atan(p.y, p.x);
    vec2 w = p;
    w += vec2(sin((a * 3.0 + t) * u_warp) * 0.12, cos((r * 8.0 - t * 0.7) * u_warp) * 0.10);
    float stripeA = sin((a * u_stripes + t * 1.5) + w.x * 3.0);
    float stripeB = cos((r * (u_stripes * 1.6) - t * 2.1) + w.y * 2.6);
    float weave = smoothstep(-0.22, 0.22, stripeA * stripeB);
    float star = smoothstep(0.25, 0.0, abs(sin(a * (numMirrors + 1.0) + r * 6.0 - t * 1.3)));
    float ring = smoothstep(0.28, 0.0, abs(fract(r * 4.0 - t * u_pulse) - 0.5));
    vec2 q = w; float mass = 0.0;
    vec2 shift = vec2(0.78 + 0.08 * sin(t + u_seed * 0.03), 0.86 + 0.09 * cos(t * 0.9 + u_seed * 0.02));
    for (int i = 0; i < 4; i++) { q = abs(q) / max(dot(q, q), 0.08) - shift; mass += exp(-2.2 * length(q)); }
    mass = clamp(mass / 2.8, 0.0, 1.0);
    float gA = hash21(floor(p * 220.0 + vec2(u_seed * 0.13, u_time * 35.0)));
    float fieldGrain = (gA - 0.5) * u_grain * 0.25 * u_use_grain;
    vec2 cellUv = fract((w + 2.0 + vec2(u_cell_shift)) * u_cell_density) - 0.5;
    float cellDist = length(cellUv);
    float cellRadius = 0.42 * (0.6 + 0.4 * sin(t + r * 4.0));
    float cell = smoothstep(cellRadius, max(0.0, cellRadius - u_cell_softness), cellDist);
    float mixV = mass * 1.25 + weave * (u_weave * 0.55) + star * u_star + ring * u_ring + fieldGrain * 0.45 + cell * u_cellularity * u_use_dots;
    vec3 colA = palette(t * 0.08 + r * 0.65 + u_seed * 0.01);
    vec3 colB = palette(0.35 + a * 0.20 - t * 0.04 + u_seed * 0.02);
    vec3 color = mix(colA, colB, clamp(mixV, 0.0, 1.0));
    mixV = pow(clamp(mixV, 0.0, 1.6), u_contrast);
    float vignette = smoothstep(u_vignette, 0.15, r);
    color *= (0.22 + 1.25 * mixV) * vignette * u_brightness;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, u_saturation);
    color = mix(color, color * (u_tint_color * 1.2), u_tint_amount);
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float grainR = mix(-u_grain, u_grain, fract(u_grain_seed + rand(uv * 1234.5678 + u_time * 0.013)));
    float grainG = mix(-u_grain, u_grain, fract(u_grain_seed + rand(uv * 876.54321 + u_time * 0.017)));
    float grainB = mix(-u_grain, u_grain, fract(u_grain_seed + rand(uv * 3214.5678 + u_time * 0.011)));
    color += vec3(grainR, grainG, grainB) * u_use_grain;
    gl_FragColor = vec4(color * u_opacity, 1.0);
  }
`;

/* ── Helpers ──────────────────────────────────────────────────── */

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = constrain(s, 0, 1);
  l = constrain(l, 0, 1);
  const c = (1 - abs(2 * l - 1)) * s;
  const x = c * (1 - abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function pseudoRandom(v) {
  const x = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/* ── Setup ────────────────────────────────────────────────────── */

function setup() {
  const c = createCanvas(calcW(), calcH(), WEBGL);
  const container = document.getElementById('shader-canvas');
  if (container) c.parent('shader-canvas');
  pixelDensity(1);
  noStroke();
  theShader = createShader(vert, frag);
  params.baseSeed = floor(random(1e9));
  params.grainSeed = random(100);
  params.fixedSeed = params.baseSeed;
  const si = document.getElementById('sh-seed');
  if (si) si.value = String(params.fixedSeed);
  bindControls();
}

function calcW() { return max(360, windowWidth - 440); }
function calcH() { return max(320, windowHeight - 120); }
function windowResized() { resizeCanvas(calcW(), calcH()); }

/* ── Panel switching ──────────────────────────────────────────── */

function switchFxPanel(preset) {
  document.querySelectorAll('.preset-fx').forEach(el => {
    el.style.display = 'none';
  });
  const panel = document.getElementById('fx-' + preset);
  if (panel) panel.style.display = '';
}

/* ── Draw dispatch ────────────────────────────────────────────── */

function draw() {
  switch (activePreset) {
    case 'prism':   drawPrism(); break;
    case 'bloom':   drawBloom(); break;
    case 'grid':    drawGrid(); break;
    case 'ember':   drawEmber(); break;
    case 'mirror':  drawMirror(); break;
    case 'lattice': drawLattice(); break;
    case 'silk':    drawSilk(); break;
    default:        drawPrism();
  }
}

/* ── 1. Prism Weave (GLSL shader) ────────────────────────────── */

function drawPrism() {
  shader(theShader);
  const absoluteTime = millis() / 1000.0;
  const cycleDuration = max(5.0, params.cycleDuration);
  const t = absoluteTime % cycleDuration;
  const loopSeed = params.lockSeed
    ? float(params.fixedSeed)
    : float(params.baseSeed + floor(absoluteTime / cycleDuration));

  const zoomPulse = sin(t * params.zoomSpeed);
  const currentZoom = map(zoomPulse, 1, -1, params.zoomMin, params.zoomMax);

  let rotationAngle = 0.0;
  const rotationStart = cycleDuration * (params.rotationStartPct / 100.0);
  if (t > rotationStart) {
    const dir = pseudoRandom(loopSeed * 999.0) > 0.5 ? 1.0 : -1.0;
    const k = constrain((t - rotationStart) / max(0.001, cycleDuration - rotationStart), 0, 1);
    rotationAngle = dir * radians(params.rotationMaxDeg) * k;
  }

  const fadeInEnd = params.blackHold + params.fadeIn;
  const fadeOutStart = max(fadeInEnd, cycleDuration - params.fadeOut);
  let opacity = 1.0;
  if (t < params.blackHold) opacity = 0.0;
  else if (t < fadeInEnd) opacity = map(t, params.blackHold, fadeInEnd, 0, 1);
  else if (t > fadeOutStart) opacity = map(t, fadeOutStart, cycleDuration, 1, 0);

  theShader.setUniform('u_resolution', [width, height]);
  theShader.setUniform('u_time', t);
  theShader.setUniform('u_zoom', currentZoom);
  theShader.setUniform('u_opacity', opacity);
  theShader.setUniform('u_seed', loopSeed);
  theShader.setUniform('u_rotation', rotationAngle);
  theShader.setUniform('u_mirror_min', params.mirrorMin);
  theShader.setUniform('u_mirror_span', params.mirrorSpan);
  theShader.setUniform('u_brightness', params.brightness);
  theShader.setUniform('u_warp', params.warp);
  theShader.setUniform('u_stripes', params.stripes);
  theShader.setUniform('u_pulse', params.pulse);
  theShader.setUniform('u_grain', params.grain);
  theShader.setUniform('u_weave', params.weaveAmt);
  theShader.setUniform('u_star', params.starAmt);
  theShader.setUniform('u_ring', params.ringAmt);
  theShader.setUniform('u_contrast', params.contrast);
  theShader.setUniform('u_vignette', params.vignette);
  theShader.setUniform('u_use_grain', params.useGrain ? 1.0 : 0.0);
  theShader.setUniform('u_use_dots', params.useDots ? 1.0 : 0.0);
  theShader.setUniform('u_pix_d', pixelDensity());
  theShader.setUniform('u_cellularity', params.cellularity);
  theShader.setUniform('u_cell_density', params.cellDensity);
  theShader.setUniform('u_cell_softness', params.cellSoftness);
  theShader.setUniform('u_cell_shift', params.cellShift);
  theShader.setUniform('u_hue_shift', params.hueShift);
  theShader.setUniform('u_palette_spread', params.paletteSpread);
  theShader.setUniform('u_saturation', params.saturation);
  theShader.setUniform('u_tint_color', params.tintColor);
  theShader.setUniform('u_tint_amount', params.tintAmount);
  theShader.setUniform('u_grain_seed', params.grainSeed);
  quad(-1, -1, 1, -1, 1, 1, -1, 1);
}

/* ── 2. Fractal Bloom ─────────────────────────────────────────── */

function drawBloom() {
  resetShader();
  background(0);

  const t = millis() / 1000.0;
  const B = fx.bloom;
  const spd = params.pulse * 0.8;
  const bri = params.brightness;
  const warpAmt = params.warp;
  const layers = floor(constrain(params.stripes * 3, 4, 24));
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const petals = B.petals;
  const breathAmp = B.breath;
  const jagAmt = B.jag;
  const innerAmt = B.inner;
  const spokeAlpha = B.spoke * 255;
  const doMirror = B.mirror;

  const sw = constrain(params.contrast * 1.2, 0.3, 4);
  noFill();
  strokeWeight(sw);

  const maxR = min(width, height) * 0.44;

  const drawHalf = (xFlip) => {
    push();
    if (xFlip) scale(-1, 1);

    for (let ring = 0; ring < layers; ring++) {
      const ringT = ring / layers;
      const breathPhase = t * spd * (1 + ring * 0.12) + ring * 0.8;
      const breathScale = 1 - breathAmp * 0.4 + breathAmp * 0.4 * sin(breathPhase);
      const r = maxR * ringT * breathScale;

      const petalScale = petals + floor(ring * 0.3);
      const h = (hueOff + ring * (360 / layers) + t * spd * 22) % 360;
      const l = constrain((0.3 + ringT * 0.35) * bri, 0, 1);
      const fadeA = map(ringT, 0, 1, 240, 70);
      const clr = hsl(h, 0.75 * sat, l);
      stroke(clr[0], clr[1], clr[2], fadeA);

      beginShape();
      for (let a = 0; a <= TWO_PI; a += TWO_PI / 100) {
        const petalWave = sin(a * petalScale + t * spd * 0.9) * warpAmt * 18;
        const jagWave = sin(a * (petalScale * 3) - t * spd * 2) * jagAmt * 25 * ringT;
        const d = r + petalWave + jagWave;
        vertex(cos(a) * d, sin(a) * d);
      }
      endShape(CLOSE);

      if (innerAmt > 0.05 && ring > 2 && ring % 2 === 0) {
        const subR = r * 0.3 * innerAmt;
        const h2 = (h + 140) % 360;
        const clr2 = hsl(h2, 0.6 * sat, l * 0.85);
        stroke(clr2[0], clr2[1], clr2[2], fadeA * 0.45 * innerAmt);
        beginShape();
        for (let a = 0; a <= TWO_PI; a += TWO_PI / 60) {
          const w2 = sin(a * petalScale * 2 - t * spd * 1.5) * warpAmt * 10 * innerAmt;
          vertex(cos(a) * (subR + w2), sin(a) * (subR + w2));
        }
        endShape(CLOSE);
      }
    }

    if (spokeAlpha > 2) {
      for (let sp = 0; sp < petals * 2; sp++) {
        const angle = (TWO_PI / (petals * 2)) * sp + t * spd * 0.12;
        const h = (hueOff + sp * 30 + t * 25) % 360;
        const clr = hsl(h, 0.4 * sat, 0.5 * bri);
        stroke(clr[0], clr[1], clr[2], spokeAlpha * 0.4);
        const outerR = maxR * (0.5 + 0.5 * sin(t * spd + sp * 0.8));
        line(0, 0, cos(angle) * outerR, sin(angle) * outerR);
      }
    }
    pop();
  };

  drawHalf(false);
  if (doMirror) drawHalf(true);
}

/* ── 3. Liquid Grid ───────────────────────────────────────────── */

function drawGrid() {
  resetShader();
  background(8, 10, 18);

  const t = millis() / 1000.0;
  const G = fx.grid;
  const cols = floor(constrain(params.stripes * 5, 6, 40));
  const rows = floor(cols * (height / width));
  const spd = params.pulse * 1.5;
  const warpAmt = params.warp * 30;
  const bri = params.brightness;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const sw = constrain(params.contrast * 0.8, 0.3, 3);
  const rippleFreq = G.ripple;
  const connectRange = G.connect * 4;
  const nodeGlow = G.nodes;
  const dampAmt = G.damp;
  const diagAmt = G.diagonal;
  const doMirror = G.mirror;

  const connectDist = min(width, height) / cols * connectRange;

  const drawHalf = (xFlip) => {
    push();
    if (xFlip) scale(-1, 1);
    translate(-width / 2, -height / 2);

    const cellW = width / (cols - 1);
    const cellH = height / (rows - 1);
    const pts = [];

    for (let r = 0; r < rows; r++) {
      pts[r] = [];
      for (let c = 0; c < cols; c++) {
        const baseX = c * cellW;
        const baseY = r * cellH;
        const distFromCenter = dist(baseX, baseY, width / 2, height / 2);
        const normDist = distFromCenter / (min(width, height) * 0.7);
        const dampMul = 1 - dampAmt * normDist;

        const wave1 = sin(baseX * 0.008 * rippleFreq / 8 + t * spd * 0.7)
                     * cos(baseY * 0.006 * rippleFreq / 8 - t * spd * 0.5);
        const wave2 = cos(baseX * 0.012 - t * spd * 0.3 + baseY * 0.005)
                     * sin(t * spd * 0.8);
        const ripple = sin(normDist * rippleFreq - t * spd * 2) * (1 - normDist * 0.5);

        const dx = (wave1 * warpAmt + ripple * warpAmt * 0.6) * dampMul;
        const dy = (wave2 * warpAmt + ripple * warpAmt * 0.4) * dampMul;

        pts[r][c] = { x: baseX + dx, y: baseY + dy, normDist };
      }
    }

    strokeWeight(sw);
    noFill();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = pts[r][c];

        const drawLink = (q, hueExtra) => {
          const d = dist(p.x, p.y, q.x, q.y);
          const tension = constrain(d / connectDist, 0, 1);
          const h = (hueOff + p.normDist * 180 + hueExtra + t * 25 * spd) % 360;
          const l = constrain((0.4 + tension * 0.3) * bri, 0, 1);
          const a = map(tension, 0, 1, 200, 20);
          const clr = hsl(h, 0.7 * sat, l);
          stroke(clr[0], clr[1], clr[2], a);
          line(p.x, p.y, q.x, q.y);
        };

        if (c < cols - 1) drawLink(pts[r][c + 1], 0);
        if (r < rows - 1) drawLink(pts[r + 1][c], 90);

        if (diagAmt > 0.05) {
          strokeWeight(sw * 0.5 * diagAmt);
          if (c < cols - 1 && r < rows - 1) drawLink(pts[r + 1][c + 1], 45);
          if (c > 0 && r < rows - 1) drawLink(pts[r + 1][c - 1], 135);
          strokeWeight(sw);
        }

        if (nodeGlow > 0.05) {
          const dotSize = (2 + sin(t * spd * 2 + p.normDist * 10) * 1.5) * nodeGlow * 2;
          const h = (hueOff + p.normDist * 220 + t * 30) % 360;
          const clr = hsl(h, 0.9 * sat, constrain(0.65 * bri, 0, 1));
          noStroke();
          fill(clr[0], clr[1], clr[2], 160 * nodeGlow);
          ellipse(p.x, p.y, dotSize, dotSize);
          strokeWeight(sw);
          noFill();
        }
      }
    }
    pop();
  };

  drawHalf(false);
  if (doMirror) drawHalf(true);
}

/* ── 4. Ember Drift ───────────────────────────────────────────── */

let emberPositions = null;

function initEmbers(count) {
  emberPositions = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    emberPositions[idx]     = (Math.random() - 0.5) * 2;
    emberPositions[idx + 1] = (Math.random() - 0.5) * 2;
    emberPositions[idx + 2] = Math.random() * TWO_PI;
    emberPositions[idx + 3] = 0.3 + Math.random() * 0.7;
  }
}

function drawEmber() {
  resetShader();

  const t = millis() / 1000.0;
  const E = fx.ember;
  const count = floor(constrain(params.stripes * 600, 200, 4000));
  const spd = params.pulse;
  const turbulence = params.warp * 0.5;
  const bri = params.brightness;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;

  const trailFade = floor(constrain(5 + (80 - E.trail) * 0.8, 5, 60));
  const fieldLayers = E.field;
  const baseSize = E.size * 10;
  const windShift = E.wind;
  const glowAmt = E.glow;
  const doMirror = E.mirror;

  if (!emberPositions || emberPositions.length !== count * 4) {
    initEmbers(count);
  }

  push();
  translate(-width / 2, -height / 2);
  noStroke();
  fill(0, 0, 0, trailFade);
  rect(0, 0, width, height);
  pop();

  noStroke();
  const dt = 0.016 * spd;
  const hw = width * 0.5;
  const hh = height * 0.5;

  const drawParticles = (xFlip) => {
    for (let i = 0; i < count; i++) {
      const idx = i * 4;
      let px = emberPositions[idx];
      let py = emberPositions[idx + 1];
      const phase = emberPositions[idx + 2];
      const energy = emberPositions[idx + 3];

      if (!xFlip) {
        let fX = sin(py * 3.2 + t * 0.6 * windShift) * cos(px * 2.8 - t * 0.4);
        let fY = cos(px * 3.1 - t * 0.5) * sin(py * 2.6 + t * 0.7 * windShift);

        if (fieldLayers >= 2) {
          fX += sin(px * 1.7 + py * 2.1 + t * 0.9) * turbulence * 0.6;
          fY += cos(py * 1.9 - px * 2.3 + t * 0.8) * turbulence * 0.6;
        }
        if (fieldLayers >= 3) {
          fX += cos(py * 5.3 - t * 1.2 + px) * turbulence * 0.3;
          fY += sin(px * 4.7 + t * 1.1 - py) * turbulence * 0.3;
        }
        if (fieldLayers >= 4) {
          fX += sin(px * py * 2 + t) * turbulence * 0.2;
          fY += cos(px * py * 2.5 - t * 0.7) * turbulence * 0.2;
        }
        if (fieldLayers >= 5) {
          const r2 = px * px + py * py;
          fX += sin(r2 * 4 + t * 0.5) * turbulence * 0.15;
          fY += cos(r2 * 3 - t * 0.6) * turbulence * 0.15;
        }

        px += fX * dt * energy;
        py += fY * dt * energy;

        if (px < -1.1) px += 2.2;
        if (px > 1.1) px -= 2.2;
        if (py < -1.1) py += 2.2;
        if (py > 1.1) py -= 2.2;

        emberPositions[idx] = px;
        emberPositions[idx + 1] = py;
      }

      let screenX = (xFlip ? -px : px) * hw;
      let screenY = py * hh;

      const speed = energy * spd;
      const h = (hueOff + phase * 57.3 + speed * 80 + t * 15) % 360;
      const l = constrain(0.4 + speed * 0.15, 0, 0.8) * bri;
      const sz = constrain(baseSize * (0.3 + energy * 0.7) * (0.8 + 0.2 * sin(t + phase)), 0.5, baseSize);
      const clr = hsl(h, 0.8 * sat, l);
      const alpha = 140 + energy * 100;

      if (glowAmt > 0.1) {
        const gc = hsl(h, 0.4 * sat, constrain(l * 1.3, 0, 1));
        fill(gc[0], gc[1], gc[2], alpha * 0.2 * glowAmt);
        ellipse(screenX, screenY, sz * 3 * glowAmt, sz * 3 * glowAmt);
      }

      fill(clr[0], clr[1], clr[2], alpha);
      ellipse(screenX, screenY, sz, sz);
    }
  };

  drawParticles(false);
  if (doMirror) drawParticles(true);
}

/* ── 5. Mirror Shards ─────────────────────────────────────────── */

function drawMirror() {
  resetShader();
  background(0);

  const t = millis() / 1000.0;
  const M = fx.mirrorS;
  const spd = params.pulse * 0.6;
  const bri = params.brightness;
  const warpAmt = params.warp;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const sw = constrain(params.contrast * 1.5, 0.5, 5);

  const folds = M.shards;
  const density = M.depth;
  const flickerAmt = M.flicker;
  const edgeGlow = M.edge;
  const twistAmt = M.twist;
  const gapAmt = M.gap;

  noFill();
  strokeWeight(sw);

  const maxR = min(width, height) * 0.48;

  for (let f = 0; f < folds; f++) {
    const sectorAngle = TWO_PI / folds;
    const baseAngle = sectorAngle * f + t * spd * 0.2;

    push();
    rotateZ(baseAngle);

    for (let ring = 1; ring <= density; ring++) {
      const ringNorm = ring / density;
      const r = maxR * ringNorm;

      const flickerPhase = sin(t * spd * 3 + ring * 0.6 + f * 1.3) * flickerAmt;
      const actualR = r * (0.85 + 0.15 * sin(t * spd * 1.5 + ring * 0.4));

      const gapShrink = 1 - gapAmt * 0.3;
      const angularSpread = sectorAngle * 0.92 * gapShrink;
      const startA = -angularSpread / 2;

      const twist = twistAmt * ringNorm * sin(t * spd * 0.8 + f) * 0.5;

      const h = (hueOff + ring * (360 / density) + f * (360 / folds) + t * spd * 30) % 360;
      const baseBri = constrain((0.3 + ringNorm * 0.4 + flickerPhase * 0.2) * bri, 0, 1);
      const fadeAlpha = map(ringNorm, 0, 1, 220, 50);
      const clr = hsl(h, 0.75 * sat, baseBri);
      stroke(clr[0], clr[1], clr[2], fadeAlpha);

      beginShape();
      const steps = 30;
      for (let s = 0; s <= steps; s++) {
        const sa = startA + (angularSpread / steps) * s + twist;
        const noiseVal = sin(sa * density * 0.5 + t * spd + ring * 0.3) * warpAmt * 12;
        const jitter = cos(sa * ring * 2 + t * spd * 2.5) * warpAmt * 5 * ringNorm;
        const d = actualR + noiseVal + jitter;
        vertex(cos(sa) * d, sin(sa) * d);
      }
      endShape();

      if (edgeGlow > 0.1 && ring % 3 === 0) {
        const edgeClr = hsl((h + 60) % 360, 0.5 * sat, constrain(baseBri * 1.3, 0, 1));
        stroke(edgeClr[0], edgeClr[1], edgeClr[2], fadeAlpha * 0.3 * edgeGlow);
        const d1 = actualR * (1 + edgeGlow * 0.08);
        const d2 = actualR * (1 - edgeGlow * 0.08);
        beginShape();
        for (let s = 0; s <= steps; s++) {
          const sa = startA + (angularSpread / steps) * s + twist;
          vertex(cos(sa) * d1, sin(sa) * d1);
        }
        endShape();
        beginShape();
        for (let s = 0; s <= steps; s++) {
          const sa = startA + (angularSpread / steps) * s + twist;
          vertex(cos(sa) * d2, sin(sa) * d2);
        }
        endShape();
      }

      if (ring % 5 === 0) {
        const midA = twist;
        const innerR = maxR * max(0, (ring - 4) / density);
        const clr2 = hsl((h + 90) % 360, 0.4 * sat, baseBri * 0.6);
        stroke(clr2[0], clr2[1], clr2[2], fadeAlpha * 0.25);
        line(cos(midA) * innerR, sin(midA) * innerR,
             cos(midA) * actualR, sin(midA) * actualR);
      }
    }
    pop();
  }
}

/* ── 6. Phase Lattice ─────────────────────────────────────────── */

function drawLattice() {
  resetShader();
  background(5, 5, 15);

  const t = millis() / 1000.0;
  const L = fx.lattice;
  const gridN = floor(constrain(params.stripes * 4, 5, 30));
  const spd = params.pulse * 2.0;
  const bri = params.brightness;
  const warpAmt = params.warp;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const shapeSize = constrain(params.contrast * 8, 3, 25);
  const folds = floor(constrain(params.mirrorMin, 2, 8));

  const waveFreq = L.wave;
  const morphAmt = L.morph;
  const phaseOffset = L.phase;
  const glowAmt = L.glow;
  const spacingMul = 0.5 + L.gap;
  const doMirror = L.mirror;

  const drawHalf = (xFlip) => {
    push();
    if (xFlip) scale(-1, 1);
    translate(-width / 2, -height / 2);
    noStroke();

    const cellW = (width / gridN) * spacingMul;
    const cellH = (height / gridN) * spacingMul;
    const offsetX = (width - cellW * gridN) / 2;
    const offsetY = (height - cellH * gridN) / 2;
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = dist(0, 0, cx, cy);

    for (let r = 0; r < gridN; r++) {
      for (let c = 0; c < gridN; c++) {
        const px = offsetX + cellW * (c + 0.5);
        const py = offsetY + cellH * (r + 0.5);
        const d = dist(px, py, cx, cy);
        const normD = d / maxDist;

        const wavePhase = normD * waveFreq - t * spd + phaseOffset * (PI / 180);
        const rotation = sin(wavePhase) * PI * (0.3 + morphAmt * 0.5);
        const scale2 = 0.5 + 0.5 * cos(wavePhase * 0.7 + 0.5);

        const h = (hueOff + normD * 240 + rotation * 57.3 + t * spd * 15) % 360;
        const l = constrain((0.3 + abs(sin(wavePhase)) * 0.4) * bri, 0, 1);
        const clr = hsl(h, 0.8 * sat, l);
        fill(clr[0], clr[1], clr[2], 200);

        if (glowAmt > 0.05) {
          const gc = hsl(h, 0.3 * sat, constrain(l * 1.4, 0, 1));
          fill(gc[0], gc[1], gc[2], 40 * glowAmt);
          ellipse(px, py, shapeSize * scale2 * 3 * glowAmt, shapeSize * scale2 * 3 * glowAmt);
          fill(clr[0], clr[1], clr[2], 200);
        }

        push();
        translate(px, py);
        rotateZ(rotation);

        const sz = shapeSize * scale2;
        const sides = floor(folds + morphAmt * sin(t * spd * 0.5 + normD * 4) * 2);
        const actualSides = max(3, sides);
        beginShape();
        for (let v = 0; v < actualSides; v++) {
          const a = (TWO_PI / actualSides) * v - HALF_PI;
          vertex(cos(a) * sz, sin(a) * sz);
        }
        endShape(CLOSE);
        pop();
      }
    }

    strokeWeight(constrain(params.contrast * 0.3, 0.2, 1.5));
    for (let r = 0; r < gridN; r++) {
      for (let c = 0; c < gridN; c++) {
        const px = offsetX + cellW * (c + 0.5);
        const py = offsetY + cellH * (r + 0.5);
        const d = dist(px, py, cx, cy);
        const normD = d / maxDist;
        const wavePhase = normD * waveFreq - t * spd + phaseOffset * (PI / 180);

        const h = (hueOff + normD * 240 + t * spd * 15 + 180) % 360;
        const clr = hsl(h, 0.4 * sat, constrain(0.6 * bri, 0, 1));
        stroke(clr[0], clr[1], clr[2], 40 + abs(sin(wavePhase)) * 50);
        noFill();

        if (c < gridN - 1) {
          const qx = offsetX + cellW * (c + 1.5);
          line(px, py, qx, py);
        }
        if (r < gridN - 1) {
          const qy = offsetY + cellH * (r + 1.5);
          line(px, py, px, qy);
        }
      }
    }
    pop();
  };

  drawHalf(false);
  if (doMirror) drawHalf(true);
}

/* ── 7. Silk Threads ──────────────────────────────────────────── */

function drawSilk() {
  resetShader();
  background(2, 2, 8);

  const t = millis() / 1000.0;
  const S = fx.silk;
  const ribbonCount = floor(constrain(params.stripes * 6, 4, 40));
  const spd = params.pulse * 0.5;
  const bri = params.brightness;
  const warpAmt = params.warp * 1.5;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;

  const curlTight = S.curl * 3;
  const ribbonW = S.ribbon * 12;
  const threadLayers = S.layers;
  const edgeFade = S.fade;
  const crossAmt = S.cross;
  const doMirror = S.mirror;

  noFill();

  const drawHalf = (xFlip) => {
    push();
    if (xFlip) scale(-1, 1);

    for (let layerG = 0; layerG < threadLayers; layerG++) {
      const layerOff = layerG * 0.5;

      for (let r = 0; r < floor(ribbonCount / threadLayers); r++) {
        const rIdx = layerG * floor(ribbonCount / threadLayers) + r;
        const rNorm = rIdx / ribbonCount;
        const freq1 = 0.3 + rNorm * curlTight;
        const freq2 = 0.5 + (1 - rNorm) * curlTight * 0.8;
        const phase = rNorm * PI * 4 + t * spd * 0.3 + layerOff;

        const h = (hueOff + rNorm * 300 + layerG * 80 + t * spd * 20) % 360;
        const l = constrain((0.3 + rNorm * 0.35) * bri, 0, 1);
        const alpha = map(rNorm, 0, 1, 180, 50);
        const clr = hsl(h, 0.7 * sat, l);
        stroke(clr[0], clr[1], clr[2], alpha);

        const thickness = ribbonW * (0.4 + 0.6 * sin(t * spd + rIdx));
        strokeWeight(max(0.5, thickness));

        beginShape();
        noFill();
        const segments = 90;
        for (let s = 0; s <= segments; s++) {
          const sNorm = s / segments;
          const alongX = (sNorm - 0.5) * width * 1.2;

          const y1 = sin(sNorm * TWO_PI * freq1 + phase + t * spd)
                   * height * 0.25;
          const y2 = cos(sNorm * TWO_PI * freq2 - phase * 0.7 + t * spd * 1.3)
                   * height * 0.18;
          const warpY = sin(sNorm * 12 + t * spd * 2 + rIdx) * warpAmt * 15;

          let baseY = y1 + y2 + warpY;

          if (edgeFade > 0.05) {
            const edgeDist = min(sNorm, 1 - sNorm) * 2;
            baseY *= constrain(edgeDist / edgeFade, 0, 1);
          }

          const lateralShift = sin(t * spd * 0.7 + rIdx * 2.1 + layerOff)
                             * height * 0.2 * rNorm;

          curveVertex(alongX, baseY + lateralShift);
        }
        endShape();
      }
    }

    if (crossAmt > 0.05) {
      const crossCount = floor(ribbonCount * 0.25 * crossAmt);
      for (let cr = 0; cr < crossCount; cr++) {
        const rNorm = cr / max(1, crossCount);
        const h = (hueOff + rNorm * 300 + 150 + t * spd * 15) % 360;
        const clr = hsl(h, 0.5 * sat, constrain(0.3 * bri, 0, 1));
        stroke(clr[0], clr[1], clr[2], 35 * crossAmt);
        strokeWeight(max(0.5, ribbonW * 0.3));

        beginShape();
        noFill();
        const segs = 70;
        for (let s = 0; s <= segs; s++) {
          const sNorm = s / segs;
          const alongY = (sNorm - 0.5) * height * 1.2;
          const xWave = sin(sNorm * TWO_PI * curlTight + t * spd * 0.8 + cr)
                      * width * 0.2 * warpAmt;
          const xShift = cos(t * spd * 0.4 + cr * 3) * width * 0.15;
          curveVertex(xWave + xShift, alongY);
        }
        endShape();
      }
    }
    pop();
  };

  drawHalf(false);
  if (doMirror) drawHalf(true);
}

/* ── Control binding ──────────────────────────────────────────── */

function bindControls() {
  const presetSel = document.getElementById('sh-preset');
  if (presetSel) {
    presetSel.addEventListener('change', () => {
      activePreset = presetSel.value;
      emberPositions = null;
      switchFxPanel(activePreset);
    });
  }

  // Shared controls
  bindRange('sh-cycle', 'val-sh-cycle', v => { params.cycleDuration = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-black', 'val-sh-black', v => { params.blackHold = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-fade-in', 'val-sh-fade-in', v => { params.fadeIn = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-fade-out', 'val-sh-fade-out', v => { params.fadeOut = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-zoom-min', 'val-sh-zoom-min', v => { params.zoomMin = parseInt(v, 10) / 100; return params.zoomMin.toFixed(2); });
  bindRange('sh-zoom-max', 'val-sh-zoom-max', v => { params.zoomMax = parseInt(v, 10) / 100; return params.zoomMax.toFixed(2); });
  bindRange('sh-zoom-speed', 'val-sh-zoom-speed', v => { params.zoomSpeed = parseInt(v, 10) / 100; return params.zoomSpeed.toFixed(2); });
  bindRange('sh-mirror-min', 'val-sh-mirror-min', v => { params.mirrorMin = parseFloat(v); return String(v); });
  bindRange('sh-mirror-span', 'val-sh-mirror-span', v => { params.mirrorSpan = parseFloat(v); return String(v); });
  bindRange('sh-rot-start', 'val-sh-rot-start', v => { params.rotationStartPct = parseFloat(v); return `${int(v)}%`; });
  bindRange('sh-rot-max', 'val-sh-rot-max', v => { params.rotationMaxDeg = parseFloat(v); return `${int(v)}°`; });
  bindRange('sh-bright', 'val-sh-bright', v => { params.brightness = parseInt(v, 10) / 100; return params.brightness.toFixed(2); });
  bindRange('sh-warp', 'val-sh-warp', v => { params.warp = parseInt(v, 10) / 100; return params.warp.toFixed(2); });
  bindRange('sh-stripes', 'val-sh-stripes', v => { params.stripes = parseFloat(v); return String(v); });
  bindRange('sh-pulse', 'val-sh-pulse', v => { params.pulse = parseInt(v, 10) / 100; return params.pulse.toFixed(2); });
  bindRange('sh-hue', 'val-sh-hue', v => { params.hueShift = parseInt(v, 10) / 360; return `${int(v)}°`; });
  bindRange('sh-spread', 'val-sh-spread', v => { params.paletteSpread = parseInt(v, 10) / 100; return params.paletteSpread.toFixed(2); });
  bindRange('sh-sat', 'val-sh-sat', v => { params.saturation = parseInt(v, 10) / 100; return params.saturation.toFixed(2); });
  bindRange('sh-tint', 'val-sh-tint', v => { params.tintAmount = parseInt(v, 10) / 100; return params.tintAmount.toFixed(2); });

  // Prism-specific
  bindRange('sh-grain', 'val-sh-grain', v => { params.grain = parseInt(v, 10) / 100; return params.grain.toFixed(2); });
  bindRange('sh-weave', 'val-sh-weave', v => { params.weaveAmt = parseInt(v, 10) / 100; return params.weaveAmt.toFixed(2); });
  bindRange('sh-star', 'val-sh-star', v => { params.starAmt = parseInt(v, 10) / 100; return params.starAmt.toFixed(2); });
  bindRange('sh-ring', 'val-sh-ring', v => { params.ringAmt = parseInt(v, 10) / 100; return params.ringAmt.toFixed(2); });
  bindRange('sh-contrast', 'val-sh-contrast', v => { params.contrast = parseInt(v, 10) / 100; return params.contrast.toFixed(2); });
  bindRange('sh-vignette', 'val-sh-vignette', v => { params.vignette = parseInt(v, 10) / 100; return params.vignette.toFixed(2); });
  bindRange('sh-cellularity', 'val-sh-cellularity', v => { params.cellularity = parseInt(v, 10) / 100; return params.cellularity.toFixed(2); });
  bindRange('sh-cell-density', 'val-sh-cell-density', v => { params.cellDensity = parseFloat(v); return String(v); });
  bindRange('sh-cell-softness', 'val-sh-cell-softness', v => { params.cellSoftness = parseInt(v, 10) / 100; return params.cellSoftness.toFixed(2); });
  bindRange('sh-cell-shift', 'val-sh-cell-shift', v => { params.cellShift = parseInt(v, 10) / 100; return params.cellShift.toFixed(2); });

  // Bloom effects
  bindRange('bl-petals', 'val-bl-petals', v => { fx.bloom.petals = parseInt(v, 10); return String(v); });
  bindRange('bl-breath', 'val-bl-breath', v => { fx.bloom.breath = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('bl-jag', 'val-bl-jag', v => { fx.bloom.jag = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('bl-inner', 'val-bl-inner', v => { fx.bloom.inner = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('bl-spoke', 'val-bl-spoke', v => { fx.bloom.spoke = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindCheck('bl-mirror', v => { fx.bloom.mirror = v; });

  // Grid effects
  bindRange('gr-ripple', 'val-gr-ripple', v => { fx.grid.ripple = parseInt(v, 10); return String(v); });
  bindRange('gr-connect', 'val-gr-connect', v => { fx.grid.connect = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('gr-nodes', 'val-gr-nodes', v => { fx.grid.nodes = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('gr-damp', 'val-gr-damp', v => { fx.grid.damp = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('gr-diagonal', 'val-gr-diagonal', v => { fx.grid.diagonal = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindCheck('gr-mirror', v => { fx.grid.mirror = v; });

  // Ember effects
  bindRange('em-trail', 'val-em-trail', v => { fx.ember.trail = parseInt(v, 10); return String(v); });
  bindRange('em-field', 'val-em-field', v => { fx.ember.field = parseInt(v, 10); return String(v); });
  bindRange('em-size', 'val-em-size', v => { fx.ember.size = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('em-wind', 'val-em-wind', v => { fx.ember.wind = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('em-glow', 'val-em-glow', v => { fx.ember.glow = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindCheck('em-mirror', v => { fx.ember.mirror = v; });

  // Mirror Shards effects
  bindRange('mi-depth', 'val-mi-depth', v => { fx.mirrorS.depth = parseInt(v, 10); return String(v); });
  bindRange('mi-flicker', 'val-mi-flicker', v => { fx.mirrorS.flicker = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('mi-edge', 'val-mi-edge', v => { fx.mirrorS.edge = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('mi-twist', 'val-mi-twist', v => { fx.mirrorS.twist = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('mi-gap', 'val-mi-gap', v => { fx.mirrorS.gap = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('mi-shards', 'val-mi-shards', v => { fx.mirrorS.shards = parseInt(v, 10); return String(v); });

  // Lattice effects
  bindRange('la-wave', 'val-la-wave', v => { fx.lattice.wave = parseInt(v, 10); return String(v); });
  bindRange('la-morph', 'val-la-morph', v => { fx.lattice.morph = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('la-phase', 'val-la-phase', v => { fx.lattice.phase = parseInt(v, 10); return `${v}°`; });
  bindRange('la-glow', 'val-la-glow', v => { fx.lattice.glow = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('la-gap', 'val-la-gap', v => { fx.lattice.gap = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindCheck('la-mirror', v => { fx.lattice.mirror = v; });

  // Silk effects
  bindRange('si-curl', 'val-si-curl', v => { fx.silk.curl = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('si-ribbon', 'val-si-ribbon', v => { fx.silk.ribbon = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('si-layers', 'val-si-layers', v => { fx.silk.layers = parseInt(v, 10); return String(v); });
  bindRange('si-fade', 'val-si-fade', v => { fx.silk.fade = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindRange('si-cross', 'val-si-cross', v => { fx.silk.cross = parseInt(v, 10) / 100; return (parseInt(v, 10) / 100).toFixed(2); });
  bindCheck('si-mirror', v => { fx.silk.mirror = v; });

  // Misc shared
  const lock = document.getElementById('sh-lock-seed');
  if (lock) lock.addEventListener('change', () => { params.lockSeed = !!lock.checked; });
  const fixed = document.getElementById('sh-seed');
  if (fixed) fixed.addEventListener('input', () => { params.fixedSeed = parseInt(fixed.value || '0', 10) || 0; });
  const tint = document.getElementById('sh-tint-color');
  if (tint) tint.addEventListener('input', () => { params.tintColor = hexToRgb01(tint.value); });

  const textureMode = document.getElementById('sh-texture-mode');
  const syncTM = () => {
    const mode = textureMode ? textureMode.value : 'grain';
    params.textureMode = mode;
    params.useGrain = mode === 'grain' || mode === 'both';
    params.useDots = mode === 'dots' || mode === 'both';
    updateTextureModeUI();
  };
  if (textureMode) textureMode.addEventListener('change', syncTM);
  syncTM();

  switchFxPanel('prism');
}

function bindRange(id, valueId, onInput) {
  const input = document.getElementById(id);
  const value = document.getElementById(valueId);
  if (!input) return;
  const apply = () => { const txt = onInput(input.value); if (value) value.textContent = txt; };
  input.addEventListener('input', apply);
  apply();
}

function bindCheck(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => { onChange(!!el.checked); });
}

function hexToRgb01(hexValue) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexValue || '');
  if (!m) return [1.0, 1.0, 1.0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function updateTextureModeUI() {
  const grainRow = document.getElementById('row-sh-grain');
  const dotsRows = document.querySelectorAll('.dots-row');
  if (grainRow) grainRow.style.display = params.useGrain ? 'flex' : 'none';
  dotsRows.forEach(row => { row.style.display = params.useDots ? 'flex' : 'none'; });
}
