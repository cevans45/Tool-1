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
  dotsEnabled: false,
  dotsDensity: 120.0,
  dotsScale: 0.018,
  dotsSpeed: 0.010,
  dotsRadius: 0.24,
  dotsOpacity: 0.45,
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
  uniform float u_dots_enabled;
  uniform float u_dots_density;
  uniform float u_dots_scale;
  uniform float u_dots_speed;
  uniform float u_dots_radius;
  uniform float u_dots_opacity;
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

  float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  vec3 dotPalette(float v) {
    vec3 white = vec3(0.98);
    vec3 black = vec3(0.05);
    vec3 blue = vec3(0.11, 0.27, 0.45);
    vec3 red = vec3(0.92, 0.09, 0.10);

    if (v < 0.22) return white;
    if (v < 0.34) return red;
    if (v < 0.52) return white;
    if (v < 0.66) return blue;
    if (v < 0.82) return black;
    return white;
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
    float mixV = weave * u_weave + star * u_star + ring * u_ring + grain;

    vec3 colA = palette(t * 0.08 + r * 0.65 + u_seed * 0.01);
    vec3 colB = palette(0.35 + a * 0.20 - t * 0.04 + u_seed * 0.02);
    vec3 color = mix(colA, colB, clamp(mixV, 0.0, 1.0));

    mixV = pow(max(mixV, 0.0), u_contrast);
    float vignette = smoothstep(u_vignette, 0.15, r);
    color *= (0.22 + 1.25 * mixV) * vignette * u_brightness;

    // Optional living-dot layer inspired by Rorschach cells.
    if (u_dots_enabled > 0.5) {
      vec2 q = p;
      float ca = cos(-2.35619449); // -3*PI/4
      float sa = sin(-2.35619449);
      q = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);

      // Mirror around vertical axis to reinforce bilateral feel.
      q.x = abs(q.x);

      float n = noise3(vec3(q * u_dots_scale * 100.0, u_time * u_dots_speed * 100.0 + u_seed * 0.07));
      vec3 dc = dotPalette(n);

      // Radius fades near color transitions to mimic "cell breakups".
      float interval = fract(n * 8.0);
      float radiusScale = 1.0 - abs(interval * 2.0 - 1.0);
      float rad = u_dots_radius * radiusScale;

      vec2 gv = fract((q + 2.0) * u_dots_density) - 0.5;
      float d = length(gv);
      float dotMask = smoothstep(rad, max(0.0, rad - 0.08), d);

      color = mix(color, dc, dotMask * u_dots_opacity);
    }

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
  theShader.setUniform('u_dots_enabled', params.dotsEnabled ? 1.0 : 0.0);
  theShader.setUniform('u_dots_density', params.dotsDensity);
  theShader.setUniform('u_dots_scale', params.dotsScale);
  theShader.setUniform('u_dots_speed', params.dotsSpeed);
  theShader.setUniform('u_dots_radius', params.dotsRadius);
  theShader.setUniform('u_dots_opacity', params.dotsOpacity);
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
  bindRange('sh-dots-density', 'val-sh-dots-density', (v) => {
    params.dotsDensity = parseFloat(v);
    return String(v);
  });
  bindRange('sh-dots-scale', 'val-sh-dots-scale', (v) => {
    params.dotsScale = parseInt(v, 10) / 1000;
    return params.dotsScale.toFixed(3);
  });
  bindRange('sh-dots-speed', 'val-sh-dots-speed', (v) => {
    params.dotsSpeed = parseInt(v, 10) / 1000;
    return params.dotsSpeed.toFixed(3);
  });
  bindRange('sh-dots-radius', 'val-sh-dots-radius', (v) => {
    params.dotsRadius = parseInt(v, 10) / 100;
    return params.dotsRadius.toFixed(2);
  });
  bindRange('sh-dots-opacity', 'val-sh-dots-opacity', (v) => {
    params.dotsOpacity = parseInt(v, 10) / 100;
    return params.dotsOpacity.toFixed(2);
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
  const dotsEnable = document.getElementById('sh-dots-enable');
  if (dotsEnable) {
    dotsEnable.addEventListener('change', () => {
      params.dotsEnabled = !!dotsEnable.checked;
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

