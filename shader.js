let theShader;

const params = {
  cycleDuration: 78.5,
  blackHold: 1.0,
  fadeIn: 15.0,
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
  stripes: 8.0,
  pulse: 0.9,
  grain: 0.06,
  weaveAmt: 0.65,
  starAmt: 0.45,
  ringAmt: 0.55,
  contrast: 1.2,
  vignette: 2.6,
  cellularity: 0.8,
  cellDensity: 120.0,
  cellSoftness: 0.14,
  cellShift: 0.3,
  hueShift: 0.0,
  paletteSpread: 1.0,
  saturation: 1.0,
  tintAmount: 0.0,
  tintColor: [1.0, 0.1647, 0.6314],
  baseSeed: 0.0,
  lockSeed: false,
  fixedSeed: 0.0,
};

const vert = `
  precision highp float;
  attribute vec3 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 1.0);
  }
`;

const frag = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_zoom;
  uniform float u_opacity;
  uniform float u_seed;
  uniform float u_rotation;
  uniform float u_mirror_min;
  uniform float u_mirror_span;
  uniform float u_brightness;
  uniform float u_warp;
  uniform float u_stripes;
  uniform float u_pulse;
  uniform float u_grain;
  uniform float u_weave;
  uniform float u_star;
  uniform float u_ring;
  uniform float u_contrast;
  uniform float u_vignette;
  uniform float u_cellularity;
  uniform float u_cell_density;
  uniform float u_cell_softness;
  uniform float u_cell_shift;
  uniform float u_hue_shift;
  uniform float u_palette_spread;
  uniform float u_saturation;
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

    float cosR = cos(u_rotation);
    float sinR = sin(u_rotation);
    p = vec2(p.x * cosR - p.y * sinR, p.x * sinR + p.y * cosR);

    p *= u_zoom;

    float t = u_time * 0.25;
    float r = length(p);
    float a = atan(p.y, p.x);

    // Domain-warped coordinate field: distinct from the old recursive fold look.
    vec2 w = p;
    w += vec2(
      sin((a * 3.0 + t) * u_warp) * 0.12,
      cos((r * 8.0 - t * 0.7) * u_warp) * 0.10
    );

    float stripeA = sin((a * u_stripes + t * 1.5) + w.x * 3.0);
    float stripeB = cos((r * (u_stripes * 1.6) - t * 2.1) + w.y * 2.6);
    float weave = smoothstep(-0.12, 0.12, stripeA * stripeB);

    float star = smoothstep(0.25, 0.0, abs(sin(a * (numMirrors + 1.0) + r * 6.0 - t * 1.3)));
    float ring = smoothstep(0.28, 0.0, abs(fract(r * 4.0 - t * u_pulse) - 0.5));

    float grain = hash21(floor((p + 2.0) * 90.0) + u_seed * 0.13) * u_grain;

    // Dot/cell modulation integrated into the same texture field.
    vec2 cellUv = fract((w + 2.0 + vec2(u_cell_shift)) * u_cell_density) - 0.5;
    float cellDist = length(cellUv);
    float cellRadius = 0.42 * (0.6 + 0.4 * sin(t + r * 4.0));
    float cell = smoothstep(cellRadius, max(0.0, cellRadius - u_cell_softness), cellDist);

    float mixV = weave * u_weave + star * u_star + ring * u_ring + grain + cell * u_cellularity;

    vec3 colA = palette(t * 0.08 + r * 0.65 + u_seed * 0.01);
    vec3 colB = palette(0.35 + a * 0.20 - t * 0.04 + u_seed * 0.02);
    vec3 color = mix(colA, colB, clamp(mixV, 0.0, 1.0));

    mixV = pow(max(mixV, 0.0), u_contrast);
    float vignette = smoothstep(u_vignette, 0.15, r);
    color *= (0.22 + 1.25 * mixV) * vignette * u_brightness;

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, u_saturation);
    color = mix(color, color * (u_tint_color * 1.2), u_tint_amount);

    gl_FragColor = vec4(color * u_opacity, 1.0);
  }
`;

function setup() {
  const canvas = createCanvas(calcShaderWidth(), calcShaderHeight(), WEBGL);
  const container = document.getElementById('shader-canvas');
  if (container) canvas.parent('shader-canvas');
  pixelDensity(1);
  noStroke();
  theShader = createShader(vert, frag);
  params.baseSeed = Math.floor(Math.random() * 1_000_000_000);
  params.fixedSeed = params.baseSeed;
  const seedInput = document.getElementById('sh-seed');
  if (seedInput) seedInput.value = String(params.fixedSeed);
  bindControls();
}

function calcShaderWidth() {
  return max(360, windowWidth - 440);
}

function calcShaderHeight() {
  return max(320, windowHeight - 120);
}

function draw() {
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
    const direction = pseudoRandom(loopSeed * 999.0) > 0.5 ? 1.0 : -1.0;
    const k = constrain((t - rotationStart) / max(0.001, cycleDuration - rotationStart), 0, 1);
    rotationAngle = direction * radians(params.rotationMaxDeg) * k;
  }

  const fadeInEnd = params.blackHold + params.fadeIn;
  const fadeOutStart = max(fadeInEnd, cycleDuration - params.fadeOut);

  let opacity = 1.0;
  if (t < params.blackHold) {
    opacity = 0.0;
  } else if (t < fadeInEnd) {
    opacity = map(t, params.blackHold, fadeInEnd, 0.0, 1.0);
  } else if (t > fadeOutStart) {
    opacity = map(t, fadeOutStart, cycleDuration, 1.0, 0.0);
  }

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
  theShader.setUniform('u_cellularity', params.cellularity);
  theShader.setUniform('u_cell_density', params.cellDensity);
  theShader.setUniform('u_cell_softness', params.cellSoftness);
  theShader.setUniform('u_cell_shift', params.cellShift);
  theShader.setUniform('u_hue_shift', params.hueShift);
  theShader.setUniform('u_palette_spread', params.paletteSpread);
  theShader.setUniform('u_saturation', params.saturation);
  theShader.setUniform('u_tint_color', params.tintColor);
  theShader.setUniform('u_tint_amount', params.tintAmount);

  quad(-1, -1, 1, -1, 1, 1, -1, 1);
}

function windowResized() {
  resizeCanvas(calcShaderWidth(), calcShaderHeight());
}

function pseudoRandom(v) {
  return fract(sin(v * 12.9898 + 78.233) * 43758.5453);
}

function fract(v) {
  return v - floor(v);
}

function bindControls() {
  bindRange('sh-cycle', 'val-sh-cycle', (v) => {
    params.cycleDuration = parseFloat(v);
    return `${int(v)}s`;
  });
  bindRange('sh-black', 'val-sh-black', (v) => {
    params.blackHold = parseFloat(v);
    return `${int(v)}s`;
  });
  bindRange('sh-fade-in', 'val-sh-fade-in', (v) => {
    params.fadeIn = parseFloat(v);
    return `${int(v)}s`;
  });
  bindRange('sh-fade-out', 'val-sh-fade-out', (v) => {
    params.fadeOut = parseFloat(v);
    return `${int(v)}s`;
  });

  bindRange('sh-zoom-min', 'val-sh-zoom-min', (v) => {
    params.zoomMin = parseInt(v, 10) / 100;
    return params.zoomMin.toFixed(2);
  });
  bindRange('sh-zoom-max', 'val-sh-zoom-max', (v) => {
    params.zoomMax = parseInt(v, 10) / 100;
    return params.zoomMax.toFixed(2);
  });
  bindRange('sh-zoom-speed', 'val-sh-zoom-speed', (v) => {
    params.zoomSpeed = parseInt(v, 10) / 100;
    return params.zoomSpeed.toFixed(2);
  });
  bindRange('sh-mirror-min', 'val-sh-mirror-min', (v) => {
    params.mirrorMin = parseFloat(v);
    return String(v);
  });
  bindRange('sh-mirror-span', 'val-sh-mirror-span', (v) => {
    params.mirrorSpan = parseFloat(v);
    return String(v);
  });

  bindRange('sh-rot-start', 'val-sh-rot-start', (v) => {
    params.rotationStartPct = parseFloat(v);
    return `${int(v)}%`;
  });
  bindRange('sh-rot-max', 'val-sh-rot-max', (v) => {
    params.rotationMaxDeg = parseFloat(v);
    return `${int(v)}°`;
  });
  bindRange('sh-bright', 'val-sh-bright', (v) => {
    params.brightness = parseInt(v, 10) / 100;
    return params.brightness.toFixed(2);
  });
  bindRange('sh-warp', 'val-sh-warp', (v) => {
    params.warp = parseInt(v, 10) / 100;
    return params.warp.toFixed(2);
  });
  bindRange('sh-stripes', 'val-sh-stripes', (v) => {
    params.stripes = parseFloat(v);
    return String(v);
  });
  bindRange('sh-pulse', 'val-sh-pulse', (v) => {
    params.pulse = parseInt(v, 10) / 100;
    return params.pulse.toFixed(2);
  });
  bindRange('sh-grain', 'val-sh-grain', (v) => {
    params.grain = parseInt(v, 10) / 100;
    return params.grain.toFixed(2);
  });
  bindRange('sh-weave', 'val-sh-weave', (v) => {
    params.weaveAmt = parseInt(v, 10) / 100;
    return params.weaveAmt.toFixed(2);
  });
  bindRange('sh-star', 'val-sh-star', (v) => {
    params.starAmt = parseInt(v, 10) / 100;
    return params.starAmt.toFixed(2);
  });
  bindRange('sh-ring', 'val-sh-ring', (v) => {
    params.ringAmt = parseInt(v, 10) / 100;
    return params.ringAmt.toFixed(2);
  });
  bindRange('sh-contrast', 'val-sh-contrast', (v) => {
    params.contrast = parseInt(v, 10) / 100;
    return params.contrast.toFixed(2);
  });
  bindRange('sh-vignette', 'val-sh-vignette', (v) => {
    params.vignette = parseInt(v, 10) / 100;
    return params.vignette.toFixed(2);
  });
  bindRange('sh-cellularity', 'val-sh-cellularity', (v) => {
    params.cellularity = parseInt(v, 10) / 100;
    return params.cellularity.toFixed(2);
  });
  bindRange('sh-cell-density', 'val-sh-cell-density', (v) => {
    params.cellDensity = parseFloat(v);
    return String(v);
  });
  bindRange('sh-cell-softness', 'val-sh-cell-softness', (v) => {
    params.cellSoftness = parseInt(v, 10) / 100;
    return params.cellSoftness.toFixed(2);
  });
  bindRange('sh-cell-shift', 'val-sh-cell-shift', (v) => {
    params.cellShift = parseInt(v, 10) / 100;
    return params.cellShift.toFixed(2);
  });
  bindRange('sh-hue', 'val-sh-hue', (v) => {
    params.hueShift = parseInt(v, 10) / 360;
    return `${int(v)}°`;
  });
  bindRange('sh-spread', 'val-sh-spread', (v) => {
    params.paletteSpread = parseInt(v, 10) / 100;
    return params.paletteSpread.toFixed(2);
  });
  bindRange('sh-sat', 'val-sh-sat', (v) => {
    params.saturation = parseInt(v, 10) / 100;
    return params.saturation.toFixed(2);
  });
  bindRange('sh-tint', 'val-sh-tint', (v) => {
    params.tintAmount = parseInt(v, 10) / 100;
    return params.tintAmount.toFixed(2);
  });

  const lock = document.getElementById('sh-lock-seed');
  if (lock) {
    lock.addEventListener('change', () => {
      params.lockSeed = !!lock.checked;
    });
  }
  const fixed = document.getElementById('sh-seed');
  if (fixed) {
    fixed.addEventListener('input', () => {
      params.fixedSeed = parseInt(fixed.value || '0', 10) || 0;
    });
  }
  const tint = document.getElementById('sh-tint-color');
  if (tint) {
    tint.addEventListener('input', () => {
      params.tintColor = hexToRgb01(tint.value);
    });
  }
}

function bindRange(id, valueId, onInput) {
  const input = document.getElementById(id);
  const value = document.getElementById(valueId);
  if (!input) return;
  const apply = () => {
    const txt = onInput(input.value);
    if (value) value.textContent = txt;
  };
  input.addEventListener('input', apply);
  apply();
}

function hexToRgb01(hexValue) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexValue || '');
  if (!m) return [1.0, 1.0, 1.0];
  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255
  ];
}

