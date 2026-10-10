/* Sigil Live — GPU render layer.
 *
 * This file is the FFGL port boundary. FRAG_SRC is written so it can be dropped into an
 * FFGL source plugin's ProcessOpenGL with the uniform names unchanged, and PARAMS doubles
 * as the UI schema here and the SetParamInfof manifest there. Keep the two in sync: every
 * uniform the shader reads must have a PARAMS entry, and nothing else may reach the shader.
 *
 * The shader consumes one baked RGBA8 "atlas" produced by sigil-live.js:
 *   R = signed distance to the nearest sigil stroke or glyph, encoded 0.5 + d/(2*SDF_RANGE)
 *   G = s, the travel coordinate (arc length along the sigil path, character order in text)
 *   B = kind, 0.5 for sigil and 1.0 for text, so the two can be mixed independently
 *   A = coverage, the gritty hand-drawn raster from the authoring pass
 *
 * Splitting distance from coverage is what lets the grain of the original stroke survive
 * while glow, charge and warp stay smooth: effects read R, ink reads A.
 */

const SDF_RANGE = 0.12; // signed distance encoded over +/-12% of atlas height

const PARAMS = [
    // key, label, group, min, max, default, kind
    { key: 'thickness', label: 'Weight', group: 'Shape', min: -0.5, max: 0.5, def: 0, step: 0.01 },
    { key: 'softness', label: 'Softness', group: 'Shape', min: 0, max: 1, def: 0.12, step: 0.01 },
    { key: 'sigilMix', label: 'Sigil', group: 'Shape', min: 0, max: 1, def: 1, step: 0.01 },
    { key: 'textMix', label: 'Text', group: 'Shape', min: 0, max: 1, def: 1, step: 0.01 },
    { key: 'grit', label: 'Grit', group: 'Shape', min: 0, max: 1, def: 1, step: 0.01 },

    { key: 'chargeAmount', label: 'Amount', group: 'Charge', min: 0, max: 1, def: 0.7, step: 0.01 },
    { key: 'chargeSpeed', label: 'Speed', group: 'Charge', min: -4, max: 4, def: 0.6, step: 0.01 },
    { key: 'chargeCount', label: 'Repeats', group: 'Charge', min: 1, max: 12, def: 2, step: 1 },
    { key: 'chargeWidth', label: 'Width', group: 'Charge', min: 0.02, max: 1, def: 0.25, step: 0.01 },
    { key: 'chargeShape', label: 'Comet', group: 'Charge', min: 0, max: 1, def: 0.7, step: 0.01 },
    { key: 'chargeSwell', label: 'Swell', group: 'Charge', min: 0, max: 1, def: 0.35, step: 0.01 },

    { key: 'warpAmount', label: 'Amount', group: 'Warp', min: 0, max: 1, def: 0.2, step: 0.01 },
    { key: 'warpScale', label: 'Scale', group: 'Warp', min: 0.5, max: 12, def: 3, step: 0.1 },
    { key: 'warpSpeed', label: 'Speed', group: 'Warp', min: 0, max: 3, def: 0.5, step: 0.01 },
    { key: 'warpMode', label: 'Mode', group: 'Warp', min: 0, max: 3, def: 0, step: 1,
      options: ['Flow', 'Swirl', 'Ripple', 'Shatter'] },

    { key: 'glitchAmount', label: 'Amount', group: 'Glitch', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'glitchRate', label: 'Rate', group: 'Glitch', min: 0, max: 20, def: 6, step: 0.1 },
    { key: 'glitchSlice', label: 'Slice', group: 'Glitch', min: 0, max: 1, def: 0.4, step: 0.01 },

    { key: 'glow', label: 'Glow', group: 'Light', min: 0, max: 2, def: 0.6, step: 0.01 },
    { key: 'glowRadius', label: 'Radius', group: 'Light', min: 0.02, max: 1, def: 0.3, step: 0.01 },
    { key: 'edge', label: 'Edge', group: 'Light', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'trails', label: 'Trails', group: 'Light', min: 0, max: 0.98, def: 0, step: 0.01 },
    { key: 'trailDrift', label: 'Drift', group: 'Light', min: 0, max: 1, def: 0.3, step: 0.01 },

    { key: 'grain', label: 'Grain', group: 'Texture', min: 0, max: 1, def: 0.15, step: 0.01 },
    { key: 'scan', label: 'Scanlines', group: 'Texture', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'chroma', label: 'Chroma', group: 'Texture', min: 0, max: 1, def: 0.1, step: 0.01 },
    { key: 'posterize', label: 'Posterize', group: 'Texture', min: 0, max: 1, def: 0, step: 0.01 },

    { key: 'audioToCharge', label: '→ Charge', group: 'Audio', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'audioToWarp', label: '→ Warp', group: 'Audio', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'audioToGlow', label: '→ Glow', group: 'Audio', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'audioToWeight', label: '→ Weight', group: 'Audio', min: 0, max: 1, def: 0, step: 0.01 },

    { key: 'ink', label: 'Ink', group: 'Color', type: 'color', def: '#ffffff' },
    { key: 'glowColor', label: 'Glow', group: 'Color', type: 'color', def: '#6f4cff' },
    { key: 'bg', label: 'Background', group: 'Color', type: 'color', def: '#000000' },
    { key: 'bgAlpha', label: 'BG Opacity', group: 'Color', min: 0, max: 1, def: 1, step: 0.01 },
];

const PARAM_GROUPS = ['Shape', 'Charge', 'Warp', 'Glitch', 'Light', 'Texture', 'Audio', 'Color'];

function defaultParams() {
    const out = {};
    for (const p of PARAMS) out[p.key] = p.def;
    return out;
}

const VERT_SRC = `#version 300 es
void main() {
    // Fullscreen triangle: no attribute buffers, positions derived from gl_VertexID.
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform sampler2D uFeedback;
uniform vec2  uRes;
uniform float uTime;

uniform float uThickness, uSoftness, uSigilMix, uTextMix, uGrit;
uniform float uChargeAmount, uChargeSpeed, uChargeCount, uChargeWidth, uChargeShape, uChargeSwell;
uniform float uWarpAmount, uWarpScale, uWarpSpeed, uWarpMode;
uniform float uGlitchAmount, uGlitchRate, uGlitchSlice;
uniform float uGlow, uGlowRadius, uEdge, uTrails, uTrailDrift;
uniform float uGrain, uScan, uChroma, uPosterize;
uniform float uAudioToCharge, uAudioToWarp, uAudioToGlow, uAudioToWeight;
uniform float uAudioLow, uAudioMid, uAudioHigh;
uniform vec3  uInk, uGlowColor, uBg;
uniform float uBgAlpha;
uniform float uSdfRange;

out vec4 fragColor;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) {
        v += amp * vnoise(p);
        p = p * 2.03 + 17.1;
        amp *= 0.5;
    }
    return v;
}

// Domain distortion applied before sampling the atlas, so the whole form moves
// rather than smearing pixels. Modes mirror the Sigil tool's motion families.
vec2 warpOffset(vec2 uv, float amt, float t) {
    if (amt <= 0.0001) return vec2(0.0);
    vec2 p = uv * uWarpScale;
    int mode = int(uWarpMode + 0.5);
    vec2 off;
    if (mode == 1) {
        vec2 c = uv - 0.5;
        float r = length(c) + 1e-5;
        float a = fbm(vec2(r * uWarpScale, t * 0.5)) - 0.5;
        off = vec2(-c.y, c.x) / r * a;
    } else if (mode == 2) {
        float r = length(uv - 0.5);
        float wv = sin(r * uWarpScale * 6.2831 - t * 3.0);
        off = normalize(uv - 0.5 + 1e-5) * wv * 0.5;
    } else if (mode == 3) {
        vec2 cell = floor(uv * uWarpScale * 2.0);
        vec2 r = hash22(cell + floor(t * 3.0)) - 0.5;
        off = r * 1.2;
    } else {
        off = vec2(fbm(p + t) - 0.5, fbm(p.yx - t * 0.7 + 31.4) - 0.5);
    }
    return off * amt * 0.25;
}

// Horizontal block displacement that holds for a beat then jumps, rather than
// shimmering every frame — reads as a deliberate cut instead of noise.
vec2 glitchOffset(vec2 uv, float amt) {
    if (amt <= 0.0001) return vec2(0.0);
    float tick = floor(uTime * uGlitchRate);
    float band = floor(uv.y * mix(4.0, 90.0, uGlitchSlice));
    float r = hash12(vec2(band, tick));
    float gate = step(1.0 - amt, r);
    float shift = (hash12(vec2(band + 7.0, tick)) - 0.5) * amt * 0.3;
    return vec2(shift * gate, 0.0);
}

// The travelling charge. s is the baked path coordinate, so the pulse runs along
// the stroke the way it was drawn instead of sweeping the screen.
float chargeAt(float s, float speed) {
    float phase = fract(s * uChargeCount - uTime * speed);
    float w = max(0.02, uChargeWidth);
    float comet = exp(-phase / w);
    float sym = pow(max(0.0, 1.0 - abs(phase * 2.0 - 1.0)), 1.0 / w);
    return mix(sym, comet, uChargeShape);
}

void main() {
    vec2 uv = gl_FragCoord.xy / uRes;

    float audio = uAudioLow * 0.6 + uAudioMid * 0.3 + uAudioHigh * 0.1;
    float warpAmt = clamp(uWarpAmount + audio * uAudioToWarp, 0.0, 2.0);
    float chargeAmt = clamp(uChargeAmount + audio * uAudioToCharge, 0.0, 2.0);
    float glowAmt = clamp(uGlow + audio * uAudioToGlow * 2.0, 0.0, 4.0);
    float weight = uThickness + audio * uAudioToWeight * 0.3;

    vec2 t = uv;
    t += warpOffset(uv, warpAmt, uTime * uWarpSpeed);
    t += glitchOffset(uv, uGlitchAmount);

    // Chromatic split: sample the distance field at three slightly different offsets.
    vec2 ca = vec2(uChroma * 0.012, 0.0);
    vec4 a  = texture(uAtlas, t);
    float dR = (texture(uAtlas, t + ca).r - 0.5) * 2.0 * uSdfRange;
    float dB = (texture(uAtlas, t - ca).r - 0.5) * 2.0 * uSdfRange;

    float d    = (a.r - 0.5) * 2.0 * uSdfRange;
    float s    = a.g;
    float kind = a.b;
    float cov  = a.a;

    // kind is 0.5 for sigil and 1.0 for text, so each can be faded independently.
    float isText  = smoothstep(0.7, 0.9, kind);
    float isSigil = (1.0 - isText) * step(0.2, kind);
    float mixAmt  = isSigil * uSigilMix + isText * uTextMix;
    if (mixAmt <= 0.001) { mixAmt = 0.0; }

    float speed = uChargeSpeed;
    float ch = chargeAt(s, speed) * chargeAmt;

    // The charge both brightens and fattens the stroke as it passes.
    float grow = weight * 0.05 + ch * uChargeSwell * 0.03;
    float soft = max(0.0008, uSoftness * 0.02);

    float shape  = smoothstep(soft, -soft, d - grow);
    float shapeR = smoothstep(soft, -soft, dR - grow);
    float shapeB = smoothstep(soft, -soft, dB - grow);

    // Coverage carries the hand-drawn grain; mixing it back in keeps the texture
    // of the original stroke instead of flattening everything to a clean field.
    float ink = mix(shape, shape * cov, uGrit) * mixAmt;
    float inkR = mix(shapeR, shapeR * cov, uGrit) * mixAmt;
    float inkB = mix(shapeB, shapeB * cov, uGrit) * mixAmt;

    // Outline ring: a band of the distance field just outside the fill.
    float ring = smoothstep(soft * 3.0, 0.0, abs(d - grow) - soft * 2.0) * uEdge * mixAmt;

    // Glow falls straight out of the distance field, so no blur pass is needed.
    float g = exp(-max(0.0, d - grow) / max(0.004, uGlowRadius * 0.05));
    g *= glowAmt * mixAmt * (0.45 + ch * 0.9);

    // The charge has to dim the unlit stroke, not just brighten the lit part: against a
    // fully inked white form an additive pulse is invisible.
    float lit = mix(1.0, clamp(0.22 + ch, 0.0, 1.6), uChargeAmount);

    vec3 col = uBg * uBgAlpha;
    col += uGlowColor * g;
    col += uInk * vec3(inkR, ink, inkB) * lit;
    col += uInk * ring * lit;
    col += uGlowColor * ink * ch * 0.5;

    // Feedback trails, drifting slightly outward so repeats bloom instead of stacking.
    if (uTrails > 0.001) {
        vec2 fuv = (uv - 0.5) * (1.0 - uTrailDrift * 0.01) + 0.5;
        vec3 prev = texture(uFeedback, fuv).rgb;
        col = max(col, prev * uTrails);
    }

    if (uPosterize > 0.001) {
        float steps = mix(32.0, 3.0, uPosterize);
        col = floor(col * steps + 0.5) / steps;
    }

    if (uScan > 0.001) {
        float sl = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159);
        col *= mix(1.0, sl, uScan * 0.8);
    }

    if (uGrain > 0.001) {
        float n = hash12(gl_FragCoord.xy + fract(uTime) * 443.0) - 0.5;
        col += n * uGrain * 0.25;
    }

    float alpha = clamp(max(max(col.r, col.g), col.b) + uBgAlpha, 0.0, 1.0);
    fragColor = vec4(clamp(col, 0.0, 1.0), alpha);
}`;

/* Thin WebGL2 wrapper. Owns the atlas texture, a ping-pong pair for feedback trails,
 * and the uniform upload. Nothing here knows about the UI or the authoring canvas. */
class SigilRenderer {
    constructor(canvas) {
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            antialias: false,
        });
        if (!gl) throw new Error('WebGL2 is required for Sigil Live.');

        this.canvas = canvas;
        this.gl = gl;
        this.program = this._buildProgram(VERT_SRC, FRAG_SRC);
        this.vao = gl.createVertexArray();
        this.uniforms = new Map();

        this.atlas = this._makeTexture();
        this.pingpong = [this._makeTexture(), this._makeTexture()];
        this.fbos = [gl.createFramebuffer(), gl.createFramebuffer()];
        this.current = 0;
        this.fboSize = [0, 0];
        this.atlasReady = false;
    }

    _buildProgram(vsSrc, fsSrc) {
        const gl = this.gl;
        const compile = (type, src) => {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
            }
            return sh;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog) || 'program link failed');
        }
        return prog;
    }

    _makeTexture() {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    _loc(name) {
        if (!this.uniforms.has(name)) {
            this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
        }
        return this.uniforms.get(name);
    }

    /** Upload the baked RGBA8 atlas. imageData is a canvas ImageData. */
    setAtlas(imageData) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.atlas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageData.width, imageData.height, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(imageData.data.buffer));
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this.atlasReady = true;
    }

    _resizeTargets(w, h) {
        if (this.fboSize[0] === w && this.fboSize[1] === h) return;
        const gl = this.gl;
        for (let i = 0; i < 2; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.pingpong[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pingpong[i], 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.fboSize = [w, h];
    }

    render(params, time, audio) {
        const gl = this.gl;
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (!w || !h) return;

        this._resizeTargets(w, h);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.viewport(0, 0, w, h);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlas);
        gl.uniform1i(this._loc('uAtlas'), 0);

        const prev = this.current;
        const next = 1 - this.current;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.pingpong[prev]);
        gl.uniform1i(this._loc('uFeedback'), 1);

        gl.uniform2f(this._loc('uRes'), w, h);
        gl.uniform1f(this._loc('uTime'), time);
        gl.uniform1f(this._loc('uSdfRange'), SDF_RANGE);
        gl.uniform1f(this._loc('uAudioLow'), audio ? audio.low : 0);
        gl.uniform1f(this._loc('uAudioMid'), audio ? audio.mid : 0);
        gl.uniform1f(this._loc('uAudioHigh'), audio ? audio.high : 0);

        for (const p of PARAMS) {
            const name = 'u' + p.key.charAt(0).toUpperCase() + p.key.slice(1);
            if (p.type === 'color') {
                const c = hexToRgb(params[p.key]);
                gl.uniform3f(this._loc(name), c[0], c[1], c[2]);
            } else {
                gl.uniform1f(this._loc(name), params[p.key]);
            }
        }

        // Render once into the feedback target, then blit the same draw to the screen.
        // Trails need last frame's composite, which is why the offscreen pass comes first.
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[next]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        this.current = next;
    }
}

function hexToRgb(hex) {
    const h = (hex || '#000000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

window.SigilShader = { PARAMS, PARAM_GROUPS, defaultParams, SigilRenderer, FRAG_SRC, SDF_RANGE, hexToRgb };
