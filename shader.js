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

  vec3 palette(float t) {
    vec3 a = vec3(0.56, 0.52, 0.48);
    vec3 b = vec3(0.40, 0.44, 0.46);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.01, 0.18, 0.42);
    return a + b * cos(6.28318 * (c * t + d));
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

    float grain = hash21(floor((p + 2.0) * 90.0) + u_seed * 0.13) * 0.06;
    float mixV = weave * 0.65 + star * 0.45 + ring * 0.55 + grain;

    vec3 colA = palette(t * 0.08 + r * 0.65 + u_seed * 0.01);
    vec3 colB = palette(0.35 + a * 0.20 - t * 0.04 + u_seed * 0.02);
    vec3 color = mix(colA, colB, clamp(mixV, 0.0, 1.0));

    float vignette = smoothstep(2.6, 0.15, r);
    color *= (0.22 + 1.25 * mixV) * vignette * u_brightness;

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
  const loopSeed = params.lockSeed ? float(params.fixedSeed) : float(floor(absoluteTime / cycleDuration));

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

