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

  vec3 getRainbow(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (t + d));
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

    float t = u_time * 0.05;
    vec3 color = vec3(0.0);

    vec2 shift = vec2(0.8 + sin(u_seed * 1.5) * 0.1, 0.8 + cos(u_seed * 0.7) * 0.1);

    for (int i = 0; i < 7; i++) {
      p = abs(p) / dot(p, p) - (shift + sin(t * 2.0 + u_seed) * 0.05);

      float dust = smoothstep(0.3, 0.0, length(fract(p * 2.0) - 0.5));
      float colorShift = t + float(i) * 0.1 + length(p) * 0.2 + u_seed * 0.1;
      vec3 dustColor = getRainbow(colorShift);

      float intensity = pow(float(i + 1), 1.5);
      color += dustColor * dust * intensity * 0.2;

      float line = 0.1 / abs(p.x + p.y + sin(t * 10.0 + float(i) + u_seed));
      color += getRainbow(colorShift + 0.5) * line * 0.5;
    }

    color *= u_brightness;
    color *= smoothstep(5.0, 0.0, length(p));

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

