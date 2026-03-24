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

/* ── 1. Prism Weave (GLSL shader — original) ─────────────────── */

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
  const spd = params.pulse * 0.8;
  const bri = params.brightness;
  const warpAmt = params.warp;
  const layers = floor(constrain(params.stripes * 3, 4, 24));
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const sw = constrain(params.contrast * 1.2, 0.3, 4);
  const folds = floor(constrain(params.mirrorMin, 2, 12));

  noFill();
  strokeWeight(sw);

  const maxR = min(width, height) * 0.42;

  for (let ring = 0; ring < layers; ring++) {
    const ringT = ring / layers;
    const breathPhase = t * spd * (1 + ring * 0.15) + ring * 0.7;
    const breathScale = 0.7 + 0.3 * sin(breathPhase);
    const r = maxR * ringT * breathScale;

    const wobble = sin(t * spd * 0.6 + ring * 1.3) * warpAmt * 15;
    const petals = folds + floor(ring * 0.5);
    const h = (hueOff + ring * (360 / layers) + t * spd * 20) % 360;
    const l = constrain(0.35 + ringT * 0.3, 0, 1) * bri;
    const c = hsl(h, 0.75 * sat, l);
    const fadeAlpha = map(ringT, 0, 1, 255, 80);
    stroke(c[0], c[1], c[2], fadeAlpha);

    beginShape();
    for (let a = 0; a <= TWO_PI; a += TWO_PI / 120) {
      const petalWave = sin(a * petals + t * spd * 0.9) * wobble;
      const jag = sin(a * (petals * 3) - t * spd * 2) * warpAmt * 4 * ringT;
      const dist = r + petalWave + jag;
      vertex(cos(a) * dist, sin(a) * dist);
    }
    endShape(CLOSE);

    if (ring > 2 && ring % 3 === 0) {
      const subPetals = petals * 2;
      const subR = r * 0.35;
      const h2 = (h + 120) % 360;
      const c2 = hsl(h2, 0.6 * sat, l * 0.9);
      stroke(c2[0], c2[1], c2[2], fadeAlpha * 0.5);
      beginShape();
      for (let a = 0; a <= TWO_PI; a += TWO_PI / 80) {
        const wave = sin(a * subPetals - t * spd * 1.5) * warpAmt * 8;
        vertex(cos(a) * (subR + wave), sin(a) * (subR + wave));
      }
      endShape(CLOSE);
    }
  }

  for (let spoke = 0; spoke < folds; spoke++) {
    const angle = (TWO_PI / folds) * spoke + t * spd * 0.15;
    const h = (hueOff + spoke * (360 / folds) + t * 30) % 360;
    const c = hsl(h, 0.5 * sat, 0.5 * bri);
    stroke(c[0], c[1], c[2], 40);
    const outerR = maxR * (0.6 + 0.4 * sin(t * spd + spoke));
    line(0, 0, cos(angle) * outerR, sin(angle) * outerR);
  }
}

/* ── 3. Liquid Grid ───────────────────────────────────────────── */

function drawGrid() {
  resetShader();
  background(8, 10, 18);

  const t = millis() / 1000.0;
  const cols = floor(constrain(params.stripes * 5, 6, 40));
  const rows = floor(cols * (height / width));
  const spd = params.pulse * 1.5;
  const warpAmt = params.warp * 30;
  const bri = params.brightness;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const sw = constrain(params.contrast * 0.8, 0.3, 3);
  const connectDist = min(width, height) / cols * 2.2;

  push();
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

      const wave1 = sin(baseX * 0.008 + t * spd * 0.7) * cos(baseY * 0.006 - t * spd * 0.5);
      const wave2 = cos(baseX * 0.012 - t * spd * 0.3 + baseY * 0.005) * sin(t * spd * 0.8);
      const ripple = sin(normDist * 8 - t * spd * 2) * (1 - normDist * 0.5);

      const dx = (wave1 * warpAmt + ripple * warpAmt * 0.6) * (1 + normDist * 0.3);
      const dy = (wave2 * warpAmt + ripple * warpAmt * 0.4) * (1 + normDist * 0.3);

      pts[r][c] = { x: baseX + dx, y: baseY + dy, normDist };
    }
  }

  strokeWeight(sw);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = pts[r][c];

      if (c < cols - 1) {
        const q = pts[r][c + 1];
        const d = dist(p.x, p.y, q.x, q.y);
        const tension = constrain(d / connectDist, 0, 1);
        const h = (hueOff + p.normDist * 180 + t * 25 * spd) % 360;
        const l = constrain((0.4 + tension * 0.3) * bri, 0, 1);
        const a = map(tension, 0, 1, 200, 30);
        const clr = hsl(h, 0.7 * sat, l);
        stroke(clr[0], clr[1], clr[2], a);
        line(p.x, p.y, q.x, q.y);
      }

      if (r < rows - 1) {
        const q = pts[r + 1][c];
        const d = dist(p.x, p.y, q.x, q.y);
        const tension = constrain(d / connectDist, 0, 1);
        const h = (hueOff + p.normDist * 180 + 90 + t * 25 * spd) % 360;
        const l = constrain((0.4 + tension * 0.3) * bri, 0, 1);
        const a = map(tension, 0, 1, 200, 30);
        const clr = hsl(h, 0.7 * sat, l);
        stroke(clr[0], clr[1], clr[2], a);
        line(p.x, p.y, q.x, q.y);
      }

      const dotSize = 2 + sin(t * spd * 2 + p.normDist * 10) * 1.5;
      const h = (hueOff + p.normDist * 220 + t * 30) % 360;
      const clr = hsl(h, 0.9 * sat, constrain(0.65 * bri, 0, 1));
      noStroke();
      fill(clr[0], clr[1], clr[2], 180);
      ellipse(p.x, p.y, dotSize, dotSize);
      strokeWeight(sw);
      noFill();
    }
  }
  pop();
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
  const count = floor(constrain(params.stripes * 600, 200, 4000));
  const spd = params.pulse;
  const turbulence = params.warp * 0.5;
  const bri = params.brightness;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const trailOpacity = floor(constrain(15 + (1 - params.grain * 4) * 30, 5, 50));

  if (!emberPositions || emberPositions.length !== count * 4) {
    initEmbers(count);
  }

  push();
  translate(-width / 2, -height / 2);
  noStroke();
  fill(0, 0, 0, trailOpacity);
  rect(0, 0, width, height);
  pop();

  noStroke();
  const dt = 0.016 * spd;
  const hw = width * 0.5;
  const hh = height * 0.5;

  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    let px = emberPositions[idx];
    let py = emberPositions[idx + 1];
    const phase = emberPositions[idx + 2];
    const energy = emberPositions[idx + 3];

    const fieldX = sin(py * 3.2 + t * 0.6) * cos(px * 2.8 - t * 0.4)
                 + sin(px * 1.7 + py * 2.1 + t * 0.9) * turbulence;
    const fieldY = cos(px * 3.1 - t * 0.5) * sin(py * 2.6 + t * 0.7)
                 + cos(py * 1.9 - px * 2.3 + t * 0.8) * turbulence;

    px += fieldX * dt * energy;
    py += fieldY * dt * energy;

    if (px < -1.1) px += 2.2;
    if (px > 1.1) px -= 2.2;
    if (py < -1.1) py += 2.2;
    if (py > 1.1) py -= 2.2;

    emberPositions[idx] = px;
    emberPositions[idx + 1] = py;

    const screenX = px * hw;
    const screenY = py * hh;

    const speed = sqrt(fieldX * fieldX + fieldY * fieldY);
    const h = (hueOff + phase * 57.3 + speed * 120 + t * 15) % 360;
    const l = constrain(0.45 + speed * 0.2, 0, 0.85) * bri;
    const sz = constrain(1 + energy * 3 * speed, 0.5, 5);
    const clr = hsl(h, 0.8 * sat, l);
    fill(clr[0], clr[1], clr[2], 180 + energy * 75);
    ellipse(screenX, screenY, sz, sz);
  }
}

/* ── 5. Mirror Shards ─────────────────────────────────────────── */

function drawMirror() {
  resetShader();
  background(0);

  const t = millis() / 1000.0;
  const folds = floor(constrain(params.mirrorMin, 2, 16));
  const spd = params.pulse * 0.6;
  const bri = params.brightness;
  const warpAmt = params.warp;
  const density = floor(constrain(params.stripes * 8, 6, 50));
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const sw = constrain(params.contrast * 1.5, 0.5, 5);

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

      const breathe = sin(t * spd * 1.5 + ring * 0.4 + f * 0.7);
      const actualR = r * (0.85 + 0.15 * breathe);

      const angularSpread = sectorAngle * 0.92;
      const startA = -angularSpread / 2;

      const h = (hueOff + ring * (360 / density) + f * (360 / folds) + t * spd * 30) % 360;
      const l = constrain((0.3 + ringNorm * 0.4 + breathe * 0.1) * bri, 0, 1);
      const a = map(ringNorm, 0, 1, 220, 60);
      const clr = hsl(h, 0.75 * sat, l);
      stroke(clr[0], clr[1], clr[2], a);

      beginShape();
      const steps = 30;
      for (let s = 0; s <= steps; s++) {
        const sa = startA + (angularSpread / steps) * s;
        const noiseVal = sin(sa * density * 0.5 + t * spd + ring * 0.3) * warpAmt * 12;
        const jitter = cos(sa * ring * 2 + t * spd * 2.5) * warpAmt * 5 * ringNorm;
        const d = actualR + noiseVal + jitter;
        vertex(cos(sa) * d, sin(sa) * d);
      }
      endShape();

      if (ring % 4 === 0) {
        const midA = 0;
        const innerR = maxR * ((ring - 3) / density);
        const clr2 = hsl((h + 60) % 360, 0.5 * sat, l * 0.7);
        stroke(clr2[0], clr2[1], clr2[2], a * 0.4);
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
  const gridN = floor(constrain(params.stripes * 4, 5, 30));
  const spd = params.pulse * 2.0;
  const bri = params.brightness;
  const warpAmt = params.warp;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const shapeSize = constrain(params.contrast * 8, 3, 25);
  const folds = floor(constrain(params.mirrorMin, 2, 8));

  push();
  translate(-width / 2, -height / 2);
  noStroke();

  const cellW = width / gridN;
  const cellH = height / gridN;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = dist(0, 0, cx, cy);

  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const px = cellW * (c + 0.5);
      const py = cellH * (r + 0.5);
      const d = dist(px, py, cx, cy);
      const normD = d / maxDist;

      const wavePhase = normD * warpAmt * 6 - t * spd;
      const rotation = sin(wavePhase) * PI * 0.5;
      const scale = 0.6 + 0.4 * cos(wavePhase * 0.7 + 0.5);

      const h = (hueOff + normD * 240 + rotation * 57.3 + t * spd * 15) % 360;
      const l = constrain((0.35 + abs(sin(wavePhase)) * 0.4) * bri, 0, 1);
      const clr = hsl(h, 0.8 * sat, l);
      fill(clr[0], clr[1], clr[2], 200);

      push();
      translate(px, py);
      rotateZ(rotation);

      const sz = shapeSize * scale;
      const sides = folds;
      beginShape();
      for (let v = 0; v < sides; v++) {
        const a = (TWO_PI / sides) * v - HALF_PI;
        vertex(cos(a) * sz, sin(a) * sz);
      }
      endShape(CLOSE);
      pop();
    }
  }

  strokeWeight(constrain(params.contrast * 0.3, 0.2, 1.5));

  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const px = cellW * (c + 0.5);
      const py = cellH * (r + 0.5);
      const d = dist(px, py, cx, cy);
      const normD = d / maxDist;
      const wavePhase = normD * warpAmt * 6 - t * spd;

      const h = (hueOff + normD * 240 + t * spd * 15 + 180) % 360;
      const clr = hsl(h, 0.4 * sat, constrain(0.6 * bri, 0, 1));
      stroke(clr[0], clr[1], clr[2], 50 + abs(sin(wavePhase)) * 60);

      if (c < gridN - 1) {
        const qx = cellW * (c + 1.5);
        const qy = py;
        noFill();
        line(px, py, qx, qy);
      }
      if (r < gridN - 1) {
        const qx = px;
        const qy = cellH * (r + 1.5);
        noFill();
        line(px, py, qx, qy);
      }
    }
  }
  pop();
}

/* ── 7. Silk Threads ──────────────────────────────────────────── */

function drawSilk() {
  resetShader();
  background(2, 2, 8);

  const t = millis() / 1000.0;
  const ribbons = floor(constrain(params.stripes * 6, 4, 40));
  const spd = params.pulse * 0.5;
  const bri = params.brightness;
  const warpAmt = params.warp * 1.5;
  const hueOff = params.hueShift * 360;
  const sat = params.saturation;
  const sw = constrain(params.contrast * 2, 0.5, 8);

  noFill();

  push();
  const halfW = width * 0.5;
  const halfH = height * 0.5;

  for (let r = 0; r < ribbons; r++) {
    const rNorm = r / ribbons;
    const freq1 = 0.3 + rNorm * 0.7;
    const freq2 = 0.5 + (1 - rNorm) * 0.6;
    const phase = rNorm * PI * 4 + t * spd * 0.3;

    const h = (hueOff + rNorm * 300 + t * spd * 20) % 360;
    const l = constrain((0.35 + rNorm * 0.3) * bri, 0, 1);
    const alpha = map(rNorm, 0, 1, 180, 60);
    const clr = hsl(h, 0.7 * sat, l);
    stroke(clr[0], clr[1], clr[2], alpha);

    const thickness = sw * (0.5 + 0.5 * sin(t * spd + r));
    strokeWeight(thickness);

    beginShape();
    noFill();
    const segments = 100;
    for (let s = 0; s <= segments; s++) {
      const sNorm = s / segments;
      const alongX = (sNorm - 0.5) * width * 1.2;

      const y1 = sin(sNorm * TWO_PI * freq1 + phase + t * spd) * halfH * 0.6;
      const y2 = cos(sNorm * TWO_PI * freq2 - phase * 0.7 + t * spd * 1.3) * halfH * 0.4;
      const warpY = sin(sNorm * 12 + t * spd * 2 + r) * warpAmt * 15;

      const baseY = (y1 + y2 + warpY) * (0.8 + 0.2 * sin(t * spd * 0.5 + r * 0.8));

      const lateralShift = sin(t * spd * 0.7 + r * 2.1) * halfH * 0.3 * rNorm;

      curveVertex(alongX, baseY + lateralShift);
    }
    endShape();
  }

  for (let crossR = 0; crossR < floor(ribbons * 0.3); crossR++) {
    const rNorm = crossR / (ribbons * 0.3);
    const h = (hueOff + rNorm * 300 + 150 + t * spd * 15) % 360;
    const clr = hsl(h, 0.5 * sat, constrain(0.3 * bri, 0, 1));
    stroke(clr[0], clr[1], clr[2], 40);
    strokeWeight(sw * 0.3);

    beginShape();
    noFill();
    const segs = 80;
    for (let s = 0; s <= segs; s++) {
      const sNorm = s / segs;
      const alongY = (sNorm - 0.5) * height * 1.2;
      const xWave = sin(sNorm * TWO_PI * 2 + t * spd * 0.8 + crossR) * halfW * 0.4 * warpAmt;
      const xShift = cos(t * spd * 0.4 + crossR * 3) * halfW * 0.2;
      curveVertex(xWave + xShift, alongY);
    }
    endShape();
  }
  pop();
}

/* ── Control binding ──────────────────────────────────────────── */

function bindControls() {
  const presetSel = document.getElementById('sh-preset');
  if (presetSel) {
    presetSel.addEventListener('change', () => {
      activePreset = presetSel.value;
      emberPositions = null;
    });
  }

  bindRange('sh-cycle', 'val-sh-cycle', (v) => { params.cycleDuration = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-black', 'val-sh-black', (v) => { params.blackHold = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-fade-in', 'val-sh-fade-in', (v) => { params.fadeIn = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-fade-out', 'val-sh-fade-out', (v) => { params.fadeOut = parseFloat(v); return `${int(v)}s`; });
  bindRange('sh-zoom-min', 'val-sh-zoom-min', (v) => { params.zoomMin = parseInt(v, 10) / 100; return params.zoomMin.toFixed(2); });
  bindRange('sh-zoom-max', 'val-sh-zoom-max', (v) => { params.zoomMax = parseInt(v, 10) / 100; return params.zoomMax.toFixed(2); });
  bindRange('sh-zoom-speed', 'val-sh-zoom-speed', (v) => { params.zoomSpeed = parseInt(v, 10) / 100; return params.zoomSpeed.toFixed(2); });
  bindRange('sh-mirror-min', 'val-sh-mirror-min', (v) => { params.mirrorMin = parseFloat(v); return String(v); });
  bindRange('sh-mirror-span', 'val-sh-mirror-span', (v) => { params.mirrorSpan = parseFloat(v); return String(v); });
  bindRange('sh-rot-start', 'val-sh-rot-start', (v) => { params.rotationStartPct = parseFloat(v); return `${int(v)}%`; });
  bindRange('sh-rot-max', 'val-sh-rot-max', (v) => { params.rotationMaxDeg = parseFloat(v); return `${int(v)}°`; });
  bindRange('sh-bright', 'val-sh-bright', (v) => { params.brightness = parseInt(v, 10) / 100; return params.brightness.toFixed(2); });
  bindRange('sh-warp', 'val-sh-warp', (v) => { params.warp = parseInt(v, 10) / 100; return params.warp.toFixed(2); });
  bindRange('sh-stripes', 'val-sh-stripes', (v) => { params.stripes = parseFloat(v); return String(v); });
  bindRange('sh-pulse', 'val-sh-pulse', (v) => { params.pulse = parseInt(v, 10) / 100; return params.pulse.toFixed(2); });
  bindRange('sh-grain', 'val-sh-grain', (v) => { params.grain = parseInt(v, 10) / 100; return params.grain.toFixed(2); });
  bindRange('sh-weave', 'val-sh-weave', (v) => { params.weaveAmt = parseInt(v, 10) / 100; return params.weaveAmt.toFixed(2); });
  bindRange('sh-star', 'val-sh-star', (v) => { params.starAmt = parseInt(v, 10) / 100; return params.starAmt.toFixed(2); });
  bindRange('sh-ring', 'val-sh-ring', (v) => { params.ringAmt = parseInt(v, 10) / 100; return params.ringAmt.toFixed(2); });
  bindRange('sh-contrast', 'val-sh-contrast', (v) => { params.contrast = parseInt(v, 10) / 100; return params.contrast.toFixed(2); });
  bindRange('sh-vignette', 'val-sh-vignette', (v) => { params.vignette = parseInt(v, 10) / 100; return params.vignette.toFixed(2); });
  bindRange('sh-cellularity', 'val-sh-cellularity', (v) => { params.cellularity = parseInt(v, 10) / 100; return params.cellularity.toFixed(2); });
  bindRange('sh-cell-density', 'val-sh-cell-density', (v) => { params.cellDensity = parseFloat(v); return String(v); });
  bindRange('sh-cell-softness', 'val-sh-cell-softness', (v) => { params.cellSoftness = parseInt(v, 10) / 100; return params.cellSoftness.toFixed(2); });
  bindRange('sh-cell-shift', 'val-sh-cell-shift', (v) => { params.cellShift = parseInt(v, 10) / 100; return params.cellShift.toFixed(2); });
  bindRange('sh-hue', 'val-sh-hue', (v) => { params.hueShift = parseInt(v, 10) / 360; return `${int(v)}°`; });
  bindRange('sh-spread', 'val-sh-spread', (v) => { params.paletteSpread = parseInt(v, 10) / 100; return params.paletteSpread.toFixed(2); });
  bindRange('sh-sat', 'val-sh-sat', (v) => { params.saturation = parseInt(v, 10) / 100; return params.saturation.toFixed(2); });
  bindRange('sh-tint', 'val-sh-tint', (v) => { params.tintAmount = parseInt(v, 10) / 100; return params.tintAmount.toFixed(2); });

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
}

function bindRange(id, valueId, onInput) {
  const input = document.getElementById(id);
  const value = document.getElementById(valueId);
  if (!input) return;
  const apply = () => { const txt = onInput(input.value); if (value) value.textContent = txt; };
  input.addEventListener('input', apply);
  apply();
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
  dotsRows.forEach((row) => { row.style.display = params.useDots ? 'flex' : 'none'; });
}
