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
 *
 * MOTION. The Sigil tool animates by displacing the drawn points themselves, which is why
 * its output reads as a form that moves rather than a form that flickers. A fragment shader
 * has no points, so the same thing is done by inverse mapping: probe the atlas to find which
 * part of the path (s) lands on this pixel, work out where that part has been displaced to,
 * then sample the atlas back along that displacement. The thirteen motion families, the
 * impulse scheduler and the charge/presence model are ported from elemenyt.html.
 *
 * The impulses are regenerated from hashed time slots instead of a CPU-side event list, so
 * the shader stays stateless and the FFGL port needs no host-side simulation.
 *
 * uTime arrives already scaled by Speed; the host owns that accumulation so changing Speed
 * ramps the motion instead of jumping its phase.
 */

const SDF_RANGE = 0.12; // signed distance encoded over +/-12% of atlas height

const MOTIONS = [
    'Whip', 'Stomp', 'Jolt',                            // impulse-driven, hard attack
    'Glitch', 'Stutter', 'Shatter',                     // discrete poses, nothing eases
    'Tendril', 'Ratchet',                               // incoherent wander, mechanical lurch
    'Flow', 'Slither', 'Coil', 'Burst', 'Swirl',        // travelling waves
];

const STYLES = ['Current', 'Static', 'Storm', 'Comet', 'Breathe'];

const PARAMS = [
    { key: 'weight', label: 'Weight', group: 'Form', min: -0.5, max: 0.5, def: 0, step: 0.01 },
    { key: 'softness', label: 'Softness', group: 'Form', min: 0, max: 1, def: 0.12, step: 0.01 },
    { key: 'sigilMix', label: 'Sigil', group: 'Form', min: 0, max: 1, def: 1, step: 0.01 },
    { key: 'textMix', label: 'Text', group: 'Form', min: 0, max: 1, def: 1, step: 0.01 },
    { key: 'grit', label: 'Grit', group: 'Form', min: 0, max: 1, def: 1, step: 0.01 },

    { key: 'style', label: 'Style', group: 'Charge', min: 0, max: 4, def: 0, step: 1, options: STYLES },
    { key: 'speed', label: 'Speed', group: 'Charge', min: 0, max: 4, def: 0.8, step: 0.01, hostSide: true },
    { key: 'spread', label: 'Spread', group: 'Charge', min: 0.2, max: 8, def: 2.4, step: 0.1 },
    { key: 'desync', label: 'Desync', group: 'Charge', min: 0, max: 1, def: 0.35, step: 0.01 },
    { key: 'charge', label: 'Heat', group: 'Charge', min: 0, max: 1, def: 0.55, step: 0.01 },
    { key: 'swell', label: 'Swell', group: 'Charge', min: 0, max: 1, def: 0.55, step: 0.01 },
    { key: 'reverse', label: 'Direction', group: 'Charge', min: 0, max: 1, def: 0, step: 1,
      options: ['Forward', 'Reverse'] },

    { key: 'motion', label: 'Motion', group: 'Motion', min: 0, max: 12, def: 0, step: 1, options: MOTIONS },
    { key: 'warp', label: 'Warp', group: 'Motion', min: 0, max: 1, def: 0.25, step: 0.01 },
    { key: 'jitter', label: 'Jitter', group: 'Motion', min: 0, max: 1, def: 0.15, step: 0.01 },
    { key: 'crackle', label: 'Crackle', group: 'Motion', min: 0, max: 1, def: 0.25, step: 0.01 },

    { key: 'flicker', label: 'Flicker', group: 'Break', min: 0, max: 1, def: 0.45, step: 0.01 },
    { key: 'dropout', label: 'Dropout', group: 'Break', min: 0, max: 1, def: 0.1, step: 0.01 },
    { key: 'sparks', label: 'Sparks', group: 'Break', min: 0, max: 1, def: 0.6, step: 0.01 },
    { key: 'slice', label: 'Slice', group: 'Break', min: 0, max: 1, def: 0, step: 0.01 },

    { key: 'glow', label: 'Glow', group: 'Light', min: 0, max: 2, def: 0.6, step: 0.01 },
    { key: 'glowRadius', label: 'Radius', group: 'Light', min: 0.02, max: 1, def: 0.3, step: 0.01 },
    { key: 'edge', label: 'Edge', group: 'Light', min: 0, max: 1, def: 0, step: 0.01 },
    { key: 'trails', label: 'Trails', group: 'Light', min: 0, max: 0.98, def: 0.18, step: 0.01 },
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

const PARAM_GROUPS = ['Form', 'Charge', 'Motion', 'Break', 'Light', 'Texture', 'Audio', 'Color'];

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
uniform float uSdfRange;

uniform float uWeight, uSoftness, uSigilMix, uTextMix, uGrit;
uniform float uStyle, uSpread, uDesync, uCharge, uSwell, uReverse;
uniform float uMotion, uWarp, uJitter, uCrackle;
uniform float uFlicker, uDropout, uSparks, uSlice;
uniform float uGlow, uGlowRadius, uEdge, uTrails, uTrailDrift;
uniform float uGrain, uScan, uChroma, uPosterize;
uniform float uAudioToCharge, uAudioToWarp, uAudioToGlow, uAudioToWeight;
uniform float uAudioLow, uAudioMid, uAudioHigh;
uniform vec3  uInk, uGlowColor, uBg;
uniform float uBgAlpha;

out vec4 fragColor;

const float TAU = 6.2831853;

// Style personality, resolved once in main and read by the charge and motion passes.
float gWave, gStaticW, gComet, gTight, gStaticFreq, gJitterMul, gDropout, gWarpMul, gSwellMul;
float T;            // time, already scaled by Speed on the host
float gChargeAmt, gWarpAmt, gGlowAmt, gWeight;   // audio-modulated copies

// Impulses in flight. Their parameters depend only on time, not on position, so they are
// built once per pixel and reused by both displacement passes — generating them inside
// motionDisp meant hashing them twice per pixel, which is the bulk of the shader's cost.
const int EVENTS = 6;
float gEvAge[EVENTS], gEvS0[EVENTS], gEvSpan[EVENTS], gEvMag[EVENTS], gEvDecay[EVENTS];
float gEvTravel[EVENTS], gEvSide[EVENTS], gEvSpin[EVENTS];
vec2  gEvDir[EVENTS];

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

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

// Smooth value noise over time for a given site id, as in the Sigil animation.
float vnoise1(float id, float t) {
    float i = floor(t), f = fract(t);
    float a = hash12(vec2(id, i));
    float b = hash12(vec2(id, i + 1.0));
    return mix(a, b, f * f * (3.0 - 2.0 * f));
}

// Value noise that is smooth in x as well as t. Quantising x into bands gives every band
// its own displacement and the frame tears along the band edges, so anything that feeds
// geometry has to interpolate between sites rather than step between them.
float snoise1(float x, float t) {
    float i = floor(x), f = fract(x);
    float a = vnoise1(i, t);
    float b = vnoise1(i + 1.0, t);
    return mix(a, b, f * f * (3.0 - 2.0 * f));
}

// The travel coordinate is piecewise constant: it comes from whichever seed was nearest,
// so it jumps where two parts of the drawing are equidistant. Averaging a few taps rounds
// off those seams before they turn into hard wedges in the displacement field.
float smoothS(vec2 uv) {
    vec2 e = vec2(2.5 / uRes.x, 2.5 / uRes.y);
    float s = texture(uAtlas, uv).g * 2.0;
    s += texture(uAtlas, uv + vec2(e.x, 0.0)).g;
    s += texture(uAtlas, uv - vec2(e.x, 0.0)).g;
    s += texture(uAtlas, uv + vec2(0.0, e.y)).g;
    s += texture(uAtlas, uv - vec2(0.0, e.y)).g;
    return s / 6.0;
}

// Asymmetric periodic wave. The uneven rise is what stops the wave motions reading
// as a sine: the form lunges one way and creeps back.
float skewWave(float ph, float rise) {
    float w = fract(ph);
    float u = w < rise ? w / rise : 1.0 - (w - rise) / (1.0 - rise);
    return (u * u * (3.0 - 2.0 * u)) * 2.0 - 1.0;
}

// Poses that last an uneven number of ticks: each tick may decline to re-roll, so the
// form holds for one beat or five and never settles into a predictable rhythm.
float holdSlot(float t, float rate) {
    float k = floor(t * rate);
    for (int i = 0; i < 6; i++) {
        if (hash11(k + 1.0) < 0.55) break;
        k -= 1.0;
    }
    return k;
}

/* Impulses land at uneven times, hit a region of random length, and decay asymmetrically:
 * full strength the instant they land, then draining away. Gaps and magnitudes are both
 * skewed, so most hits are small and the occasional one is violent. Each lane runs its own
 * cadence, rebuilt from hashed time slots so no host-side event list is needed. */
void buildEvents() {
    for (int k = 0; k < EVENTS; k++) {
        float lane = float(k);
        float period = (0.55 + hash11(lane * 13.1) * 1.6) / (0.6 + uCrackle * 2.4);
        float ph = T / period + hash11(lane * 7.7) * 17.0;
        vec2 key = vec2(lane, floor(ph));
        gEvAge[k]    = fract(ph) * period;
        gEvS0[k]     = hash12(key);
        gEvSpan[k]   = 0.03 + pow(hash12(key + 2.1), 2.2) * 0.55;
        gEvMag[k]    = 0.3 + pow(hash12(key + 4.3), 3.0) * 2.6;
        gEvDecay[k]  = 1.4 + hash12(key + 6.5) * 4.5;
        float ang    = hash12(key + 8.7) * TAU;
        gEvDir[k]    = vec2(cos(ang), sin(ang));
        gEvTravel[k] = (0.35 + hash12(key + 10.9) * 1.5) * (hash12(key + 12.1) < 0.5 ? -1.0 : 1.0);
        gEvSide[k]   = hash12(key + 14.3) < 0.5 ? -1.0 : 1.0;
        gEvSpin[k]   = hash12(key + 16.5) * 2.0 - 1.0;
    }
}

void resolveStyle() {
    int st = int(uStyle + 0.5);
    if (st == 1) {        // static
        gWave = 0.28; gStaticW = 0.78; gComet = 0.0; gTight = 2.0;
        gStaticFreq = 3.4; gJitterMul = 1.7; gDropout = 0.25; gWarpMul = 0.55; gSwellMul = 0.7;
    } else if (st == 2) { // storm
        gWave = 0.62; gStaticW = 0.42; gComet = 1.0; gTight = 8.0;
        gStaticFreq = 2.2; gJitterMul = 1.2; gDropout = 0.4; gWarpMul = 1.5; gSwellMul = 1.3;
    } else if (st == 3) { // comet
        gWave = 1.0; gStaticW = 0.04; gComet = 1.0; gTight = 14.0;
        gStaticFreq = 0.6; gJitterMul = 0.3; gDropout = 0.0; gWarpMul = 0.8; gSwellMul = 1.45;
    } else if (st == 4) { // breathe
        gWave = 1.0; gStaticW = 0.1; gComet = 0.0; gTight = 1.2;
        gStaticFreq = 0.35; gJitterMul = 0.15; gDropout = 0.0; gWarpMul = 1.25; gSwellMul = 1.6;
    } else {              // current
        gWave = 0.85; gStaticW = 0.18; gComet = 0.0; gTight = 5.0;
        gStaticFreq = 0.9; gJitterMul = 0.5; gDropout = 0.05; gWarpMul = 1.0; gSwellMul = 1.0;
    }
    gTight *= (1.0 + uCrackle * 0.8);
    gDropout *= (0.4 + uCrackle * 1.6);
}

// How charged a spot on the path is right now. s is its position along the drawing.
float activation(float s, float id) {
    float dir = uReverse > 0.5 ? -1.0 : 1.0;
    float ph = s * uSpread * dir - T + hash11(id) * uDesync;
    float w = fract(ph);
    float wave = gComet > 0.5
        ? exp(-w * gTight)
        : pow(0.5 + 0.5 * cos(TAU * w), gTight);
    float a = gWave * wave + gStaticW * vnoise1(id, T * gStaticFreq * 1.6);
    if (uCrackle > 0.0) {
        a += uCrackle * (vnoise1(id + 7777.0, T * (3.0 + uCrackle * 12.0)) - 0.38) * 0.95;
    }
    return clamp(a, 0.0, 1.0);
}

// Flicker and hard dropouts, so parts of the form blink out between pulses.
float presence(float a, float id) {
    float level = 1.0;
    if (uFlicker > 0.0) {
        float n = vnoise1(id + 313.0, T * (1.5 + uCrackle * 6.0));
        level = 1.0 - uFlicker * (1.0 - clamp(a * 1.15, 0.0, 1.0)) * (0.3 + n * 0.95);
    }
    // Style sets the baseline dropout character; the slider adds on top of it.
    float drop = uDropout * 2.0 + gDropout;
    if (drop > 0.0) {
        float n = vnoise1(id + 991.0, T * (2.5 + uCrackle * 8.0));
        if (n < drop * (1.0 - a) * 0.85) level = 0.0;
    }
    return clamp(level, 0.0, 1.0);
}

// Surface normal of the distance field. The tangent is its perpendicular, which gives
// the motions an "along the stroke" and "across the stroke" basis to push against.
vec2 sdfNormal(vec2 uv) {
    vec2 e = vec2(1.5 / uRes.x, 1.5 / uRes.y);
    float dx = texture(uAtlas, uv + vec2(e.x, 0.0)).r - texture(uAtlas, uv - vec2(e.x, 0.0)).r;
    float dy = texture(uAtlas, uv + vec2(0.0, e.y)).r - texture(uAtlas, uv - vec2(0.0, e.y)).r;
    vec2 g = vec2(dx, dy);
    float m = length(g);
    return m > 1e-6 ? g / m : vec2(0.0, 1.0);
}

/* Displacement of the part of the path at position s. Ported family by family from
 * animWarpShaped / animWarpWhip / animWarpSprung in elemenyt.html. Impulses are rebuilt
 * from hashed time slots rather than a CPU event list so this stays stateless. */
vec2 motionDisp(float s, vec2 nrm, vec2 tg, float a, vec2 uv, float chunk, float pid) {
    float amp = gWarpAmt * gWarpMul * 0.07;
    if (amp < 0.0004) return vec2(0.0);

    int m = int(uMotion + 0.5);
    float dir = uReverse > 0.5 ? -1.0 : 1.0;
    vec2 c = uv - 0.5;
    vec2 d = vec2(0.0);

    if (m == 8) {
        // Flow: two smooth travelling waves. The one motion meant to read as liquid.
        float slow = uSpread * 0.55 + 0.7;
        float fast = uSpread * 1.7 + 2.3;
        float bend = sin((s * slow - T * 0.7) * TAU) * 0.68
                   + sin((s * fast + T * 1.13) * TAU) * 0.32;
        d = nrm * bend * amp * (0.4 + a * 1.1);
    } else if (m == 9) {
        // Slither: lengthways only and lopsided, so the ink crawls in a direction.
        float slide = skewWave(s * (uSpread * 1.3 + 1.0) - T * 1.4 * dir, 0.18)
                    * amp * 1.7 * (0.35 + a * 0.9);
        d = tg * slide;
    } else if (m == 10) {
        // Coil: across and along a quarter turn apart, winding into a corkscrew.
        float ph = s * (uSpread * 1.1 + 1.5) - T * 1.25 * dir;
        float g = amp * (0.35 + a * 0.95);
        d = nrm * (skewWave(ph, 0.22) * g) + tg * (skewWave(ph + 0.25, 0.22) * g * 0.75);
    } else if (m == 11) {
        // Burst: rings punching out from the centre and sagging back in.
        float len = length(c) + 1e-5;
        float ring = skewWave(s * uSpread * 0.8 - T * 1.1 * dir, 0.15);
        d = (c / len) * ring * amp * 1.6 * (0.35 + a);
    } else if (m == 12) {
        // Swirl: rotation about the centre, winding up fast and unwinding slowly.
        float wind = skewWave(s * uSpread * 0.5 - T * 0.8 * dir, 0.2);
        float ang = gWarpAmt * 0.5 * wind * (0.35 + a);
        float cs = cos(ang), sn = sin(ang);
        d = vec2(c.x * cs - c.y * sn - c.x, c.x * sn + c.y * cs - c.y);
        float ml = length(d);
        if (ml > amp * 5.0) d = d / ml * amp * 5.0;
    } else if (m == 7) {
        // Ratchet: quantised in time and distance, so the form lurches between poses.
        float lurch = 3.0 + floor(uCrackle * 8.0);
        float tq = floor(T * 2.2 * lurch) / lurch;
        float bend = skewWave(s * (uSpread * 0.55 + 0.7) - tq * 0.85 * dir, 0.3);
        d = nrm * (floor(bend * 4.0 + 0.5) / 4.0) * amp * (0.45 + a);
    } else if (m == 3) {
        // Glitch: lopsided chunks dislocate in any direction, so the drawing tears
        // rather than bends, then snap somewhere else after an uneven hold.
        float slot = holdSlot(T, 3.0 + uCrackle * 10.0);
        float key = chunk * 91.76 + slot * 13.1071;
        if (hash11(key + 0.37) < 0.25 + a * 0.5) {
            float ang = hash11(key) * TAU;
            float kick = amp * (0.4 + pow(hash11(key + 1.73), 2.5) * 3.4);
            d = vec2(cos(ang), sin(ang)) * kick;
        }
    } else if (m == 4) {
        // Stutter: dead still, then a chunk teleports onto a coarse grid, then still
        // again. Never any travel between poses.
        float slot = holdSlot(T, 2.2 + uCrackle * 7.0);
        float key = chunk * 22.468 + slot * 4.0503;
        if (hash11(key) < 0.45) {
            float q = amp * 0.85;
            d = vec2(floor((hash11(key + 0.11) * 2.0 - 1.0) * 2.4 + 0.5),
                     floor((hash11(key + 0.93) * 2.0 - 1.0) * 2.4 + 0.5)) * q;
        }
    } else if (m == 6) {
        // Tendril: each chunk picks its own destinations on its own clock, so
        // neighbours disagree and nothing sweeps through as a single wave. The ring on
        // arrival stands in for the damped spring the CPU version runs.
        float rate = 1.2 + hash11(chunk * 0.971) * 4.5;
        float off = hash11(chunk * 33.391) * 40.0;
        float slot = floor(T * rate + off);
        float key = chunk * 26.544 + slot * 4.0503;
        vec2 target = vec2(hash11(key) * 2.0 - 1.0, hash11(key + 0.77) * 2.0 - 1.0) * amp * 1.7;
        float arr = fract(T * rate + off);
        d = target * (1.0 + sin(arr * TAU * 2.0) * exp(-arr * 5.0) * 0.5);
    } else {
        // Impulse-driven families, reading the impulses built once in main.
        float side = 0.0, along = 0.0, blast = 0.0;
        vec2 imp = vec2(0.0);
        float shAng = hash11(pid * 40.503) * TAU;
        float omega = 14.0 + hash11(chunk + 1.0) * 10.0;

        for (int k = 0; k < EVENTS; k++) {
            float age = gEvAge[k];
            float eS0 = gEvS0[k], eSpan = gEvSpan[k], eMag = gEvMag[k], eDecay = gEvDecay[k];

            if (m == 0) {
                // Whip: a crack travelling along the drawing. Nothing moves ahead of the
                // front, everything snaps the instant it arrives, then drags out behind.
                float env = exp(-age * eDecay * 0.55);
                float head = eS0 + gEvTravel[k] * age;
                float behind = gEvTravel[k] < 0.0 ? s - head : head - s;
                if (behind >= 0.0 && behind <= eSpan * 6.0 && env > 0.01) {
                    float w = exp(-behind / max(0.02, eSpan)) * env * eMag;
                    side += gEvSide[k] * w;
                    along += gEvSpin[k] * w * 0.55;
                }
            } else if (m == 5) {
                // Shatter: each point owns one fixed escape direction; impulses blast the
                // pieces out on arrival and they drift back, breaking and reassembling.
                if (abs(s - eS0) <= eSpan) blast += exp(-age * eDecay) * eMag;
            } else {
                // Stomp hits a hard-edged region; Jolt hits the whole form but the far
                // end of the drawing gets the news late, so it whips rather than slides.
                float w;
                if (m == 2) {
                    float lag = s * 0.14;
                    w = age >= lag ? exp(-(age - lag) * eDecay) : 0.0;
                } else {
                    w = abs(s - eS0) <= eSpan ? exp(-age * eDecay) : 0.0;
                }
                // Damped spring ring: the form overshoots and wobbles as it settles
                // instead of easing smoothly back.
                w *= 1.0 + sin(age * omega) * exp(-age * 6.0) * 0.55;
                imp += gEvDir[k] * eMag * w;
            }
        }

        if (m == 0) {
            d = (nrm * side + tg * along) * amp * 2.4;
        } else if (m == 5) {
            blast = min(blast, 1.8);
            float grit = 0.6 + vnoise1(pid + 1201.0, T * (2.0 + uCrackle * 9.0)) * 0.9;
            d = vec2(cos(shAng), sin(shAng)) * amp * 2.0 * blast * grit;
        } else {
            d = imp * amp * 1.7;
        }
    }

    // Per-site wobble on top of whatever the motion did, so nothing sits perfectly still.
    // Interpolated along s rather than per band, or the wobble alone would tear the form.
    float jit = uJitter * gJitterMul * amp * 0.5;
    if (jit > 0.0) {
        d += vec2(snoise1(s * 70.0, T * 7.0) - 0.5,
                  snoise1(s * 70.0 + 55.0, T * 7.0) - 0.5) * jit * 2.0;
    }
    return d;
}

// Horizontal block displacement that holds for a beat then jumps, rather than
// shimmering every frame — reads as a deliberate cut instead of noise.
vec2 sliceOffset(vec2 uv, float amt) {
    if (amt <= 0.0001) return vec2(0.0);
    float tick = floor(T * (4.0 + uCrackle * 16.0));
    float band = floor(uv.y * mix(4.0, 90.0, 0.3 + uCrackle * 0.7));
    float r = hash12(vec2(band, tick));
    float gate = step(1.0 - amt, r);
    float shift = (hash12(vec2(band + 7.0, tick)) - 0.5) * amt * 0.3;
    return vec2(shift * gate, 0.0);
}

// Bright points that flash near the charged parts of the form.
float sparkle(vec2 uv, float d, float a) {
    if (uSparks <= 0.001) return 0.0;
    float cell = 150.0;
    vec2 g = floor(uv * cell);
    vec2 f = fract(uv * cell);
    float slot = floor(T * (5.0 + uCrackle * 22.0));
    if (hash12(g + slot * 7.0) > uSparks * 0.3) return 0.0;
    vec2 pos = hash22(g + slot * 3.1);
    float dot = smoothstep(0.3, 0.0, length(f - pos));
    float near = smoothstep(uSdfRange * 0.25, 0.0, abs(d));
    return dot * near * (0.25 + a) * uSparks;
}

void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    T = uTime;
    resolveStyle();

    // Only the impulse-driven families read these, so skip the hashing otherwise.
    int mo = int(uMotion + 0.5);
    if (mo == 0 || mo == 1 || mo == 2 || mo == 5) buildEvents();

    float audio = uAudioLow * 0.6 + uAudioMid * 0.3 + uAudioHigh * 0.1;
    gChargeAmt = clamp(uCharge + audio * uAudioToCharge, 0.0, 2.0);
    gWarpAmt   = clamp(uWarp + audio * uAudioToWarp, 0.0, 2.0);
    gGlowAmt   = clamp(uGlow + audio * uAudioToGlow * 2.0, 0.0, 4.0);
    gWeight    = uWeight + audio * uAudioToWeight * 0.3;

    // Inverse warp. Probe once to find which part of the path lands here, displace that
    // part, then refine: one correction is enough because s varies smoothly along a stroke.
    //
    // Site identity comes from s, not from screen position. The Sigil tool gives every
    // drawn point its own id, so flicker and jitter act on stretches of the path; keying
    // off screen blocks instead makes neighbouring pixels of one stroke disagree and the
    // frame breaks up into visible squares.
    vec2 nrm = sdfNormal(uv);
    vec2 tg = vec2(-nrm.y, nrm.x);

    vec4 probe = texture(uAtlas, uv);

    // Text takes a fraction of the displacement the sigil does. At full warp a glyph is
    // unreadable long before the sigil stops looking good, and the point of having type
    // in the frame is that it can be read.
    float motionScale = mix(1.0, 0.3, smoothstep(0.7, 0.9, probe.b));

    // Far from any stroke the travel coordinate is whatever the nearest seed happened to
    // be, so displacing there produces streaks rather than motion. The form never travels
    // further than the warp amplitude, so fading the field out past that costs nothing.
    float dProbe = (probe.r - 0.5) * 2.0 * uSdfRange;
    motionScale *= 1.0 - smoothstep(uSdfRange * 0.5, uSdfRange * 0.92, dProbe);

    float sP = smoothS(uv);
    float pidP = floor(sP * 300.0);
    vec2 disp = motionDisp(sP, nrm, tg, activation(sP, pidP), uv, floor(sP * 40.0), pidP) * motionScale;

    float sR = smoothS(uv - disp);
    float pidR = floor(sR * 300.0);
    float aR = activation(sR, pidR);
    disp = motionDisp(sR, nrm, tg, aR, uv, floor(sR * 40.0), pidR) * motionScale;

    vec2 t = uv - disp + sliceOffset(uv, uSlice);

    // Displacement can push the lookup off the atlas; clamping would smear the edge
    // pixels across the frame, so anything out of bounds reads as empty instead.
    float inFrame = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);

    // Chromatic split: sample the distance field at three slightly different offsets.
    vec2 ca = vec2(uChroma * 0.012, 0.0);
    vec4 atl = texture(uAtlas, t);
    float dR = (texture(uAtlas, t + ca).r - 0.5) * 2.0 * uSdfRange;
    float dB = (texture(uAtlas, t - ca).r - 0.5) * 2.0 * uSdfRange;

    float d    = (atl.r - 0.5) * 2.0 * uSdfRange;
    float s    = atl.g;
    float kind = atl.b;
    float cov  = atl.a;

    float pid = floor(s * 300.0);
    float a = activation(s, pid);
    float pres = presence(a, pid);

    // kind is 0.5 for sigil and 1.0 for text, so each can be faded independently.
    float isText  = smoothstep(0.7, 0.9, kind);
    float isSigil = (1.0 - isText) * step(0.2, kind);
    float mixAmt  = isSigil * uSigilMix + isText * uTextMix;

    // The charge both brightens and fattens the stroke as it passes.
    float grow = gWeight * 0.05 + a * uSwell * gSwellMul * 0.025;
    float soft = max(0.0008, uSoftness * 0.02);

    float shape  = smoothstep(soft, -soft, d - grow);
    float shapeR = smoothstep(soft, -soft, dR - grow);
    float shapeB = smoothstep(soft, -soft, dB - grow);

    // Coverage carries the hand-drawn grain; mixing it back in keeps the texture
    // of the original stroke instead of flattening everything to a clean field.
    float gate = mixAmt * pres * inFrame;
    float ink  = mix(shape, shape * cov, uGrit) * gate;
    float inkR = mix(shapeR, shapeR * cov, uGrit) * gate;
    float inkB = mix(shapeB, shapeB * cov, uGrit) * gate;

    // Outline ring: a band of the distance field just outside the fill.
    float ring = smoothstep(soft * 3.0, 0.0, abs(d - grow) - soft * 2.0) * uEdge * gate;

    // Glow falls straight out of the distance field, so no blur pass is needed.
    float g = exp(-max(0.0, d - grow) / max(0.004, uGlowRadius * 0.05));
    g *= gGlowAmt * mixAmt * pres * inFrame * (0.45 + a * 0.9);

    // The charge has to dim the unlit stroke, not just brighten the lit part: against a
    // fully inked white form an additive pulse is invisible.
    float lit = mix(1.0, clamp(0.22 + a, 0.0, 1.6), gChargeAmt);

    vec3 col = uBg * uBgAlpha;
    col += uGlowColor * g;
    col += uInk * vec3(inkR, ink, inkB) * lit;
    col += uInk * ring * lit;
    col += uGlowColor * ink * a * 0.5;
    col += uInk * sparkle(uv, d, a);

    // Feedback trails, drifting slightly outward so repeats bloom instead of stacking.
    if (uTrails > 0.001) {
        vec2 fuv = (uv - 0.5) * (1.0 - uTrailDrift * 0.012) + 0.5;
        col = max(col, texture(uFeedback, fuv).rgb * uTrails);
    }

    if (uPosterize > 0.001) {
        float steps = mix(32.0, 3.0, uPosterize);
        col = floor(col * steps + 0.5) / steps;
    }

    if (uScan > 0.001) {
        col *= mix(1.0, 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159), uScan * 0.8);
    }

    if (uGrain > 0.001) {
        col += (hash12(gl_FragCoord.xy + fract(T) * 443.0) - 0.5) * uGrain * 0.25;
    }

    float alpha = clamp(max(max(col.r, col.g), col.b) + uBgAlpha, 0.0, 1.0);
    fragColor = vec4(clamp(col, 0.0, 1.0), alpha);
}`;

// Trails need last frame's composite, so the main pass always renders into a texture.
// Copying that texture to the screen is far cheaper than running the whole shader twice.
const BLIT_SRC = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
out vec4 fragColor;
void main() { fragColor = texture(uSrc, gl_FragCoord.xy / uRes); }`;

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
        this.blit = this._buildProgram(VERT_SRC, BLIT_SRC);
        this.vao = gl.createVertexArray();
        this.uniforms = new Map();
        this.blitUniforms = new Map();

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

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[next]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(this.blit);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.pingpong[next]);
        if (!this.blitUniforms.has('uSrc')) {
            this.blitUniforms.set('uSrc', gl.getUniformLocation(this.blit, 'uSrc'));
            this.blitUniforms.set('uRes', gl.getUniformLocation(this.blit, 'uRes'));
        }
        gl.uniform1i(this.blitUniforms.get('uSrc'), 0);
        gl.uniform2f(this.blitUniforms.get('uRes'), w, h);
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

window.SigilShader = {
    PARAMS, PARAM_GROUPS, MOTIONS, STYLES, defaultParams,
    SigilRenderer, FRAG_SRC, SDF_RANGE, hexToRgb,
};
