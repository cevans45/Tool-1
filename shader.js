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

// ─── Prism Weave shader ──────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

function hslToRgb(h, s, l) {
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

function pseudoRandom(v) { return fract(sin(v * 12.9898 + 78.233) * 43758.5453); }
function fract(v) { return v - floor(v); }

// ─── Setup ───────────────────────────────────────────────────────

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

// ─── Draw dispatch ───────────────────────────────────────────────

function draw() {
  switch (activePreset) {
    case 'prism': drawPrism(); break;
    case 'cubes': drawCubes(); break;
    case 'organic': drawOrganic(); break;
    case 'bands': drawBands(); break;
    case 'spiral': drawSpiral(); break;
    case 'tunnel': drawTunnel(); break;
    case 'moire': drawMoire(); break;
    default: drawPrism();
  }
}

// ─── 1. Prism Weave ─────────────────────────────────────────────

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

// ─── 2. Nested Cubes ────────────────────────────────────────────

function drawCubes() {
  resetShader();
  background(0);

  const t = millis() / 1000.0;
  const maxCubes = floor(constrain(params.stripes * 16, 10, 120));
  const baseSize = min(width, height) * 0.9;
  const sf = pow(0.02, 1.0 / maxCubes);
  const angStep = PI / 18;
  const rotSpd = params.zoomSpeed * 8;
  const hueSpd = params.pulse * 2;
  const animSpd = constrain(params.pulse * 0.5, 0.05, 2.0);
  const baseHue = (t * hueSpd * 60 + params.hueShift * 360) % 360;

  const cycleLen = maxCubes / animSpd;
  const totalPhase = (t * animSpd) % (maxCubes * 6);
  const phase = floor(totalPhase / maxCubes) % 6;
  const progress = totalPhase % maxCubes;

  let startI = 0, endI = 0;
  switch (phase) {
    case 0: startI = 0; endI = progress; break;
    case 1: startI = 0; endI = maxCubes - progress; break;
    case 2: startI = 0; endI = progress; break;
    case 3: startI = progress; endI = maxCubes; break;
    case 4: startI = maxCubes - progress; endI = maxCubes; break;
    case 5: startI = 0; endI = maxCubes - progress; break;
  }

  const rotAngle = t * 0.6 * rotSpd;
  rotateX(rotAngle * 0.2);
  rotateY(rotAngle * 0.3);
  rotateZ(rotAngle * 0.1);

  noFill();
  strokeWeight(constrain(params.contrast * 1.5, 0.5, 5));

  for (let i = 0; i < maxCubes; i++) {
    if (i < startI || i >= endI) continue;
    const h = (baseHue + i * (360.0 / maxCubes)) % 360;
    const l = map(i, 0, maxCubes, 0.55, 0.8);
    const rgb = hslToRgb(h, 0.9 * params.saturation, l * params.brightness);
    stroke(rgb[0], rgb[1], rgb[2]);
    const sz = baseSize * pow(sf, i);
    push();
    rotateX(i * angStep * 0.2);
    rotateY(i * angStep * 0.3);
    rotateZ(i * angStep * 0.1);
    box(sz);
    pop();
  }
}

// ─── 3. Liquid Globe ────────────────────────────────────────────

function drawOrganic() {
  resetShader();
  background(5, 10, 20);

  const t = millis() / 1000.0;
  const camSpd = params.zoomSpeed * 0.5;
  const camDist = map(cos(t * camSpd), 1, -1, 800, 60);
  camera(0, 0, camDist, 0, 0, 0, 0, 1, 0);

  ambientLight(80, 80, 200);
  pointLight(255, 255, 255, 0, 0, 0);
  directionalLight(150, 200, 255, 1, 1, -1);

  rotateX(t * 0.4 * camSpd);
  rotateY(t * 0.6 * camSpd);
  rotateZ(t * 0.2 * camSpd);

  const detail = floor(constrain(params.stripes * 6, 12, 50));
  const baseR = 200;
  const nScale = params.warp * 1.5;
  const bri = params.brightness;

  for (let i = 0; i <= detail; i++) {
    const lat = map(i, 0, detail, 0, PI);
    beginShape(TRIANGLE_STRIP);
    for (let j = 0; j <= detail; j++) {
      const lon = map(j, 0, detail, 0, TWO_PI);
      for (let layer = 0; layer < 2; layer++) {
        const rOff = layer * 30;
        const xo = sin(lat) * cos(lon);
        const yo = sin(lat) * sin(lon);
        const zo = cos(lat);
        const n = noise(xo * nScale + t * 0.5, yo * nScale + t * 0.5, zo * nScale + t * 0.5);
        const deform = map(n, 0, 1, -80, 80);
        const r = baseR + rOff + deform;
        const x = r * sin(lat) * cos(lon);
        const y = r * sin(lat) * sin(lon);
        const z = r * cos(lat);
        const rc = map(n, 0, 1, 0, 255) * bri;
        const gc = map(sin(t + lat), -1, 1, 0, 255) * bri;
        const bc = map(cos(lon + t), -1, 1, 0, 255) * bri;
        noStroke();
        fill(rc, gc, bc, 100);
        vertex(x, y, z);
      }
    }
    endShape();
  }

  camera(0, 0, (height / 2) / tan(PI / 6), 0, 0, 0, 0, 1, 0);
}

// ─── 4. Noise Bands ─────────────────────────────────────────────

function drawBands() {
  resetShader();
  background(10);

  const t = millis() / 1000.0;
  const lineH = constrain(height * 0.005 * params.contrast, 1, 8);
  const noiseSpd = params.zoomSpeed * 0.5;
  const bri = params.brightness;
  const warpAmt = params.warp * 0.4;

  const colors = [
    [142, 80, 23], [210, 156, 52], [164, 14, 2],
    [40, 114, 127], [59, 81, 93], [15, 18, 12]
  ];

  push();
  translate(-width / 2, -height / 2);
  strokeCap(SQUARE);
  strokeWeight(lineH);
  noFill();

  let offer = 0;
  for (let y = 0; y <= height + lineH; y += lineH) {
    const mainW = map(noise(y / 100 + t * 3 * noiseSpd, t * noiseSpd), 0, 1,
      width * 0.05, width * 0.5) * warpAmt + width * 0.1;
    const half = mainW / 2;
    const mainX = width / 2;
    const leftover = (width - mainW) / 2;
    const secondaryW = map(noise(y / 100 + t * 3 * noiseSpd, t * noiseSpd, 3), 0, 1, 0, leftover);
    const left = mainX - half;
    const right = mainX + half;
    const tertiaryW = leftover - secondaryW;

    const cn = noise(mainX / 100 + t * noiseSpd, y / 150 + t * noiseSpd, t * 0.25);
    const ci = floor(cn * colors.length) % colors.length;
    const ci2 = (ci + 1) % colors.length;
    const mix = cn * colors.length - floor(cn * colors.length);
    const cr = lerp(colors[ci][0], colors[ci2][0], mix) * bri;
    const cg = lerp(colors[ci][1], colors[ci2][1], mix) * bri;
    const cb = lerp(colors[ci][2], colors[ci2][2], mix) * bri;

    if (offer % 2 === 1) {
      stroke(cr, cg, cb);
      line(mainX - half, y, mainX + half, y);
      const c2n = noise(tertiaryW * 0.01 + t * noiseSpd, y / 150 + t * noiseSpd);
      const c2i = floor(c2n * colors.length) % colors.length;
      stroke(colors[c2i][0] * bri, colors[c2i][1] * bri, colors[c2i][2] * bri);
      line(0, y, tertiaryW, y);
      line(width, y, width - tertiaryW, y);
    } else {
      stroke(cr * 0.8, cg * 0.8, cb * 0.8);
      line(left - secondaryW, y, left, y);
      line(right, y, right + secondaryW, y);
    }
    offer++;
  }
  pop();
}

// ─── 5. Spiral Field ────────────────────────────────────────────

function drawSpiral() {
  resetShader();

  push();
  translate(-width / 2, -height / 2);
  noStroke();
  fill(0, 0, 0, 25);
  rect(0, 0, width, height);
  pop();

  const t = millis() / 1000.0;
  const numParticles = floor(constrain(params.stripes * 1000, 500, 5000));
  const sMax = min(width, height) * 0.3;
  const bri = params.brightness;
  const spd = params.pulse;
  const hueOff = params.hueShift * 360;

  noStroke();

  for (let i = 0; i < numParticles; i++) {
    const ti = i * 0.01;
    const S = (i + t * spd * 80) % sMax;

    const A = (cos(ti * 3) - cos(ti * 6) + 9) * 0.45;
    const B = ti / 2 + (sin(ti * 3) - sin(ti * 6)) / 3;

    const h = (B * 57.3 * 10 + t * spd * 60 + hueOff) % 360;
    const rgb = hslToRgb(h, 0.7 * params.saturation, 0.55 * bri);
    fill(rgb[0], rgb[1], rgb[2]);

    const x = S * A * cos(B);
    const y = S * A * sin(B);
    const sz = abs(S * 0.18 * sin(ti * 11));
    if (sz > 0.3) circle(x, y, sz);
  }
}

// ─── 6. Warp Tunnel ─────────────────────────────────────────────

function drawTunnel() {
  resetShader();
  background(0);

  const t = millis() / 1000.0;
  const ringCount = floor(constrain(params.stripes * 15, 20, 120));
  const bri = params.brightness;
  const spd = params.pulse;
  const warpAmt = params.warp;
  const sides = floor(constrain(params.mirrorMin + 1, 3, 12));
  const hueOff = params.hueShift * 360;

  noFill();

  for (let i = 0; i < ringCount; i++) {
    const depth = ((i / ringCount) + t * spd * 0.25) % 1.0;
    const sz = map(depth, 0, 1, 5, max(width, height) * 1.4);
    const alpha = map(depth, 0, 1, 255, 0);

    const h = (i * (360.0 / ringCount) + t * spd * 50 + hueOff) % 360;
    const l = constrain(0.55 * bri * (1 - depth * 0.5), 0, 1);
    const rgb = hslToRgb(h, 0.85 * params.saturation, l);
    stroke(rgb[0], rgb[1], rgb[2], alpha);
    strokeWeight(constrain(params.contrast * 2 * (1 - depth), 0.5, 6));

    push();
    rotateZ(depth * warpAmt * 1.5 + t * 0.25);

    beginShape();
    for (let j = 0; j <= sides; j++) {
      const angle = (TWO_PI / sides) * j;
      vertex(cos(angle) * sz * 0.5, sin(angle) * sz * 0.5);
    }
    endShape(CLOSE);
    pop();
  }
}

// ─── 7. Moire Waves ─────────────────────────────────────────────

function drawMoire() {
  resetShader();
  background(240, 236, 230);

  const t = millis() / 1000.0;
  const numStripes = floor(constrain(params.stripes * 12, 15, 80));
  const numLayers = floor(constrain(params.mirrorMin, 2, 7));
  const noiseSpd = params.zoomSpeed * 0.5;
  const bri = params.brightness;
  const warpAmt = params.warp * 0.3;
  const hueOff = params.hueShift * 360;

  push();
  translate(-width / 2, -height / 2);
  noFill();
  strokeWeight(constrain(params.contrast * 2, 1, 6));

  const yd = constrain(height / 150, 2, 6);

  for (let layer = 0; layer < numLayers; layer++) {
    const h = (layer * (360.0 / numLayers) + hueOff) % 360;
    const rgb = hslToRgb(h, 0.85 * params.saturation, 0.45 * bri);
    stroke(rgb[0], rgb[1], rgb[2]);

    for (let i = 0; i < numStripes; i++) {
      beginShape();
      for (let y = 0; y < height; y += yd) {
        const baseX = map(i, 0, numStripes, 0, width);
        const nv = noise(
          i / 7 + layer * 100,
          y / (height * 0.5) + t * noiseSpd,
          t * 0.1 + layer
        );
        const x = baseX + (nv - 0.5) * width * warpAmt;
        vertex(x, y);
      }
      endShape();
    }
  }
  pop();
}

// ─── Control binding ─────────────────────────────────────────────

function bindControls() {
  const presetSel = document.getElementById('sh-preset');
  if (presetSel) {
    presetSel.addEventListener('change', () => {
      activePreset = presetSel.value;
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
