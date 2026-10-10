/* Sigil Live — authoring, baking and playback.
 *
 * Three layers, in dependency order:
 *   1. Authoring. The stroke engine is a port of the Sigil tool's scratchLine, kept
 *      deliberately faithful because the multi-pass jitter is the signature of the look.
 *      Sigil and text rasterise to separate offscreen canvases so they stay separable later.
 *   2. Bake. Both layers collapse into one RGBA8 atlas via a jump flood: distance in R,
 *      travel coordinate in G, layer id in B, hand-drawn coverage in A. See sigil-shader.js
 *      for the channel contract.
 *   3. Playback. sigil-shader.js owns the GPU pass; this file only feeds it params.
 *
 * All authoring geometry is in "design space", which equals the output resolution. Stroke
 * constants scale by K so the engine behaves identically at 720p and 4K.
 */
(function () {
    'use strict';

    const { PARAMS, PARAM_GROUPS, defaultParams, SigilRenderer, FRAG_SRC } = window.SigilShader;

    const qs = new URLSearchParams(location.search);
    const IS_OUTPUT = qs.get('output') === '1';
    const IS_PREVIEW = qs.get('preview') === '1';
    if (IS_PREVIEW) document.body.classList.add('is-preview');
    if (IS_OUTPUT) document.body.classList.add('is-output');

    const CHANNEL = 'sigil-live';

    // ─── Elements ──────────────────────────────────────────────────────────
    const el = (id) => document.getElementById(id);
    const stage = el('stage');
    const stageInner = el('stage-inner');
    const authorCanvas = el('author-canvas');
    const liveCanvas = el('live-canvas');
    const actx = authorCanvas.getContext('2d');

    // ─── State ─────────────────────────────────────────────────────────────
    const out = { w: 1920, h: 1080 };

    const state = {
        tab: 'draw',
        mode: 'ink',            // ink | cut
        brushSize: 5,
        marker: 'line',
        taperEnabled: false,
        mirrorX: true,
        mirrorY: false,
        genTime: 32,
        genSeed: (Math.random() * 0x7fffffff) | 0,

        isDrawing: false,
        points: [],
        undoStack: [],

        // Per-stroke tracking that scratchLine reads while stamping.
        strokeCumDist: 0,
        strokeStartIdx: 0,
        strokeTotalDist: 1e9,
        lastDrawTime: 0,
        lastDrawSpeed: 0,
        currentSpeed: 0,
        currentTaper: { cumDist1: 0, cumDist2: 0, totalDist: 1e9 },

        text: '',
        fontSize: 120,
        tracking: 0,
        leading: 1.1,
        align: 'center',
        textX: 0.5,
        textY: 0.5,
        textRot: 0,
        fontFamily: "'ABC Diatype Mono', monospace",

        playing: true,
    };

    let params = defaultParams();

    // Offscreen rasters. Sigil and text stay apart so the bake can label them.
    const sigilCanvas = document.createElement('canvas');
    const sigilCtx = sigilCanvas.getContext('2d', { willReadFrequently: true });
    const textCanvas = document.createElement('canvas');
    const textCtx = textCanvas.getContext('2d', { willReadFrequently: true });

    // ctx is what the ported stroke engine stamps into.
    let ctx = sigilCtx;

    const MYCELIUM = { passMul: 1.38, jitterMul: 1.55, holeMul: 0.68, distPlus: 0.26 };
    const CFG = { connect: 70, jitterBase: 4, jitterMul: 0.8, passes: 6, holeChance: 0.15 };
    let K = 1;              // design-space scale, keeps stroke feel resolution independent
    let brushPx = 5;
    let minDrawDist = 1.25;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const makeRng = (seed) => {
        let s = (seed >>> 0) || 1;
        return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    };

    function applyScale() {
        K = out.h / 900;
        CFG.connect = 70 * K;
        CFG.jitterBase = 4 * K;
        minDrawDist = 1.25 * K;
        brushPx = state.brushSize * K;
    }

    // ─── Layout ────────────────────────────────────────────────────────────
    function setOutputSize(w, h) {
        out.w = w;
        out.h = h;
        applyScale();

        // Authoring always works at full design resolution; the live canvas is sized by
        // fitStage, which keeps the editor preview cheap.
        for (const c of [authorCanvas, sigilCanvas, textCanvas]) {
            c.width = w;
            c.height = h;
        }
        fitStage();
        renderText();
        drawAuthor();
        scheduleBake();
    }

    function fitStage() {
        const pad = IS_OUTPUT || IS_PREVIEW ? 0 : 24;
        const aw = Math.max(1, stage.clientWidth - pad * 2);
        const ah = Math.max(1, stage.clientHeight - pad * 2);
        const scale = Math.min(aw / out.w, ah / out.h);
        // Before first layout the stage reports no size; fall back to the full output
        // resolution rather than locking the canvas to a couple of pixels.
        if (stage.clientWidth < 8 || stage.clientHeight < 8) {
            stageInner.style.width = '';
            stageInner.style.height = '';
            setLiveSize(out.w, out.h);
            return;
        }
        const dispW = Math.max(16, Math.round(out.w * scale));
        const dispH = Math.max(16, Math.round(out.h * scale));
        stageInner.style.width = `${dispW}px`;
        stageInner.style.height = `${dispH}px`;

        // The editor preview only ever gets seen at its displayed size, so rendering it
        // at full output resolution burns fill rate for nothing. The output window and the
        // export path still run at the real resolution.
        setLiveSize(IS_OUTPUT ? out.w : Math.min(out.w, dispW), IS_OUTPUT ? out.h : Math.min(out.h, dispH));
    }

    // The preview canvas tracks the stage, and the stage settles after first layout and on
    // every panel or window change, so observe it rather than guessing when to re-measure.
    function observeStage() {
        if (typeof ResizeObserver === 'undefined') return;
        new ResizeObserver(() => fitStage()).observe(stage);
    }

    function setLiveSize(w, h) {
        if (liveCanvas.width !== w) liveCanvas.width = w;
        if (liveCanvas.height !== h) liveCanvas.height = h;
    }

    /** Render one frame at full output resolution and hand back the canvas. */
    function renderAtFullSize() {
        setLiveSize(out.w, out.h);
        if (renderer && renderer.atlasReady) renderer.render(params, clock, audio);
        return liveCanvas;
    }

    function designCoords(e) {
        const r = authorCanvas.getBoundingClientRect();
        const src = e.touches && e.touches[0] ? e.touches[0] : e;
        return {
            x: (src.clientX - r.left) / r.width * out.w,
            y: (src.clientY - r.top) / r.height * out.h,
        };
    }

    // ─── Stroke engine (ported from the Sigil tool) ────────────────────────
    function mirroredPoints(x, y) {
        const o = [{ x, y }];
        if (state.mirrorX) o.push({ x: out.w - x, y });
        if (state.mirrorY) o.push({ x, y: out.h - y });
        if (state.mirrorX && state.mirrorY) o.push({ x: out.w - x, y: out.h - y });
        return o;
    }

    function mirroredLines(x1, y1, x2, y2) {
        const o = [{ x1, y1, x2, y2 }];
        if (state.mirrorX) o.push({ x1: out.w - x1, y1, x2: out.w - x2, y2 });
        if (state.mirrorY) o.push({ x1, y1: out.h - y1, x2, y2: out.h - y2 });
        if (state.mirrorX && state.mirrorY) {
            o.push({ x1: out.w - x1, y1: out.h - y1, x2: out.w - x2, y2: out.h - y2 });
        }
        return o;
    }

    function taperWidthAt(t) {
        if (!state.taperEnabled) return 1;
        const info = state.currentTaper;
        if (!info || info.totalDist <= 0) return 1;
        const cum = info.cumDist1 + (info.cumDist2 - info.cumDist1) * clamp(t, 0, 1);
        const total = info.totalDist;
        const taperLen = Math.max(15 * K, brushPx * 12);
        if (total <= taperLen * 2.5) {
            const u = total > 0 ? cum / total : 0.5;
            return 0.06 + 0.94 * Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.75);
        }
        if (cum < taperLen) return 0.06 + 0.94 * Math.pow(cum / taperLen, 0.6);
        if (cum > total - taperLen) return 0.06 + 0.94 * Math.pow((total - cum) / taperLen, 0.6);
        return 1;
    }

    function scratchLine(x1, y1, x2, y2, dist) {
        const distFactor = Math.max(0.12, (CFG.connect - dist) / (10 * K) + MYCELIUM.distPlus);
        const speedNorm = clamp((state.currentSpeed || 0) / (1.8 * K), 0, 1);
        const thickness = brushPx * distFactor * (1 - speedNorm * 0.55);
        const baseJitter = CFG.jitterBase + thickness * CFG.jitterMul;

        const isInk = state.mode === 'ink';
        ctx.globalCompositeOperation = isInk ? 'source-over' : 'destination-out';
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        ctx.lineCap = state.taperEnabled ? 'round' : 'square';
        ctx.lineJoin = 'bevel';

        const dx = x2 - x1;
        const dy = y2 - y1;
        const segLen = Math.hypot(dx, dy) || 1;
        const dir = Math.atan2(dy, dx);
        const bias = 0.85 + Math.abs(Math.sin(dir * 1.7)) * 0.55;
        const passes = Math.max(2, Math.round(CFG.passes * bias * MYCELIUM.passMul));
        const jitter = baseJitter * (0.9 + (bias - 0.85) * 0.35) * MYCELIUM.jitterMul;
        const holeProb = clamp(CFG.holeChance * MYCELIUM.holeMul, 0, 0.5);

        const dot = (x, y, r) => {
            const pts = mirroredPoints(x, y);
            for (const p of pts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        if (state.marker === 'none') {
            const samples = Math.max(2, Math.floor(segLen / (3 * K)));
            for (let s = 0; s <= samples; s++) {
                const t = samples <= 1 ? 0.5 : s / samples;
                dot(x1 + dx * t, y1 + dy * t, Math.max(0.5, thickness * 0.5 * taperWidthAt(t)));
            }
        } else if (state.marker === 'sprinkle') {
            const n = Math.max(2, Math.floor(segLen / (14 * K)));
            for (let i = 0; i < passes; i++) {
                for (let d = 0; d < n; d++) {
                    if (Math.random() < holeProb) continue;
                    const t = Math.random();
                    const ns = jitter * 0.7;
                    dot(x1 + dx * t + (Math.random() - 0.5) * ns,
                        y1 + dy * t + (Math.random() - 0.5) * ns,
                        Math.max(0.8, thickness * (0.18 + Math.random() * 0.45)) * 0.5 * taperWidthAt(t));
                }
            }
        } else if (state.marker === 'grain') {
            const nx = -dy / segLen, ny = dx / segLen;
            const n = Math.max(12, Math.floor(segLen / (6 * K)));
            for (let pass = 0; pass < passes; pass++) {
                for (let d = 0; d < n; d++) {
                    if (Math.random() < holeProb * 0.55) continue;
                    const t = Math.random();
                    const along = (Math.random() - 0.5) * jitter * 0.55;
                    const norm = (Math.random() - 0.5) * jitter * 1.1;
                    dot(x1 + dx * t + along + nx * norm, y1 + dy * t + along + ny * norm,
                        Math.max(0.6, thickness * (0.08 + Math.random() * 0.18)) * 0.5 * taperWidthAt(t));
                }
            }
        } else if (state.marker === 'inkblot') {
            const nx = -dy / segLen, ny = dx / segLen;
            const samples = Math.max(6, Math.floor(segLen / (5 * K)));
            const base = Math.max(0.7, thickness * 0.32);
            for (let pass = 0; pass < Math.max(2, Math.floor(passes * 0.65)); pass++) {
                for (let s = 0; s < samples; s++) {
                    if (Math.random() < holeProb * 0.45) continue;
                    const t = samples <= 1 ? 0.5 : s / (samples - 1);
                    const px = x1 + dx * t + (Math.random() - 0.5) * jitter * 0.45 + nx * (Math.random() - 0.5) * jitter * 1.05;
                    const py = y1 + dy * t + (Math.random() - 0.5) * jitter * 0.45 + ny * (Math.random() - 0.5) * jitter * 1.05;
                    const r = base * (0.55 + Math.random() * 1.1) * taperWidthAt(t);
                    dot(px, py, r);
                    // Satellite droplets give the ink somewhere to bleed.
                    const sat = 1 + Math.floor(Math.random() * 2);
                    for (let k = 0; k < sat; k++) {
                        if (Math.random() < 0.35) continue;
                        const off = r * (0.6 + Math.random() * 1.1);
                        const ang = Math.random() * Math.PI * 2;
                        dot(px + Math.cos(ang) * off, py + Math.sin(ang) * off,
                            Math.max(0.35, r * (0.16 + Math.random() * 0.22)) * taperWidthAt(t));
                    }
                }
            }
        } else if (state.marker === 'grid') {
            const grid = Math.max(4 * K, Math.floor(brushPx * 1.2));
            const step = Math.max(2 * K, Math.floor(grid * 0.5));
            const samples = Math.max(2, Math.floor(segLen / step));
            for (let pass = 0; pass < passes; pass++) {
                for (let i = 0; i < samples; i++) {
                    if (Math.random() < holeProb * 0.8) continue;
                    const t = samples <= 1 ? 0.5 : i / (samples - 1);
                    const px = x1 + dx * t + (Math.random() - 0.5) * jitter * 0.9;
                    const py = y1 + dy * t + (Math.random() - 0.5) * jitter * 0.9;
                    const gx = Math.round(px / grid) * grid;
                    const gy = Math.round(py / grid) * grid;
                    const s = Math.max(0.9, thickness * (0.35 + Math.random() * 0.35)) * taperWidthAt(t);
                    for (const p of mirroredPoints(gx, gy)) ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
                }
            }
        } else if (state.marker === 'hatch') {
            const nx = -dy / segLen, ny = dx / segLen;
            const n = Math.max(3, Math.floor(segLen / (18 * K)));
            const hatchLen = thickness * 2.2;
            for (let pass = 0; pass < passes; pass++) {
                for (let s = 0; s < n; s++) {
                    if (Math.random() < 0.1) continue;
                    const t = s / Math.max(1, n - 1);
                    const px = x1 + dx * t + (Math.random() - 0.5) * jitter;
                    const py = y1 + dy * t + (Math.random() - 0.5) * jitter;
                    const len = hatchLen * (0.7 + Math.random() * 0.8);
                    const lines = mirroredLines(px - nx * len * 0.5, py - ny * len * 0.5,
                        px + nx * len * 0.5, py + ny * len * 0.5);
                    ctx.lineWidth = Math.max(0.12, thickness * 0.9 * taperWidthAt(t));
                    for (const l of lines) {
                        ctx.beginPath();
                        ctx.moveTo(l.x1, l.y1);
                        ctx.lineTo(l.x2, l.y2);
                        ctx.stroke();
                    }
                }
            }
        } else if (state.marker === 'dash') {
            const n = Math.max(3, Math.floor(segLen / (10 * K)));
            for (let pass = 0; pass < passes; pass++) {
                for (let k = 0; k < n; k++) {
                    if (Math.random() < 0.25) continue;
                    const tA = k / n, tB = (k + 1) / n;
                    const ax = x1 + dx * tA + (Math.random() - 0.5) * jitter;
                    const ay = y1 + dy * tA + (Math.random() - 0.5) * jitter;
                    const bx = x1 + dx * tB + (Math.random() - 0.5) * jitter;
                    const by = y1 + dy * tB + (Math.random() - 0.5) * jitter;
                    ctx.lineWidth = Math.max(0.15, thickness * taperWidthAt((tA + tB) * 0.5));
                    for (const l of mirroredLines(ax, ay, bx, by)) {
                        ctx.beginPath();
                        ctx.moveTo(l.x1, l.y1);
                        ctx.lineTo(l.x2, l.y2);
                        ctx.stroke();
                    }
                }
            }
        } else {
            // Default "line": overlapping jittered passes, subdivided when tapering.
            for (let i = 0; i < passes; i++) {
                if (Math.random() <= holeProb) continue;
                const px1 = x1 + (Math.random() - 0.5) * jitter;
                const py1 = y1 + (Math.random() - 0.5) * jitter;
                const px2 = x2 + (Math.random() - 0.5) * jitter;
                const py2 = y2 + (Math.random() - 0.5) * jitter;
                const segs = state.taperEnabled
                    ? Math.max(8, Math.min(24, Math.floor(segLen / (5 * K)))) : 1;
                for (let s = 0; s < segs; s++) {
                    const t0 = s / segs, t1 = (s + 1) / segs;
                    const lines = mirroredLines(
                        px1 + (px2 - px1) * t0, py1 + (py2 - py1) * t0,
                        px1 + (px2 - px1) * t1, py1 + (py2 - py1) * t1);
                    ctx.lineWidth = Math.max(0.15, thickness * taperWidthAt((t0 + t1) * 0.5));
                    ctx.beginPath();
                    for (const l of lines) {
                        ctx.moveTo(l.x1, l.y1);
                        ctx.lineTo(l.x2, l.y2);
                    }
                    ctx.stroke();
                }
            }
        }

        ctx.globalCompositeOperation = 'source-over';
    }

    // Replaying a stroke must reproduce the same jitter, so each point carries a seed
    // that temporarily replaces Math.random while that point is stamped.
    function withPointSeed(pt, fn) {
        const real = Math.random;
        let s = pt.seed;
        Math.random = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
        const marker = state.marker;
        if (pt.marker) state.marker = pt.marker;
        try { fn(); } finally { Math.random = real; state.marker = marker; }
    }

    function addPoint(x, y, origin) {
        const prev = state.points.length ? state.points[state.points.length - 1] : null;
        const segDist = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;

        // Replayed hand-drawn points carry their own distance and speed so the stroke
        // reproduces exactly; generated points have neither and fall through to live math.
        if (origin && typeof origin.cumDist === 'number') {
            state.strokeCumDist = origin.cumDist;
            state.lastDrawSpeed = origin.speed;
        } else {
            if (!prev) { state.strokeCumDist = 0; state.lastDrawSpeed = 0; }
            else state.strokeCumDist += segDist;
            const now = performance.now();
            if (prev && state.lastDrawTime > 0) {
                const dt = Math.max(1, now - state.lastDrawTime);
                state.lastDrawSpeed = state.lastDrawSpeed * 0.65 + (segDist / dt) * 0.35;
            }
            state.lastDrawTime = now;
        }

        const p = {
            x, y,
            cumDist: state.strokeCumDist,
            speed: state.lastDrawSpeed,
            marker: origin ? origin.marker : state.marker,
            seed: origin ? origin.seed : ((Math.random() * 0xFFFFFFFF) >>> 0),
        };
        state.points.push(p);
        const idx = state.points.length - 1;

        if (prev) {
            state.currentTaper = {
                cumDist1: prev.cumDist || 0,
                cumDist2: p.cumDist,
                totalDist: state.strokeTotalDist,
            };
            state.currentSpeed = ((prev.speed || 0) + p.speed) * 0.5;
        } else {
            state.currentTaper = { cumDist1: 0, cumDist2: 0, totalDist: 1e9 };
            state.currentSpeed = 0;
        }

        withPointSeed(p, () => {
            const prevPt = idx > 0 ? state.points[idx - 1] : null;
            if (prevPt) {
                const d = Math.hypot(p.x - prevPt.x, p.y - prevPt.y);
                if (d) scratchLine(prevPt.x, prevPt.y, p.x, p.y, d);
            }
        });
    }

    function pushUndo() {
        const snap = document.createElement('canvas');
        snap.width = sigilCanvas.width;
        snap.height = sigilCanvas.height;
        snap.getContext('2d').drawImage(sigilCanvas, 0, 0);
        state.undoStack.push({ snap, len: state.points.length });
        if (state.undoStack.length > 24) state.undoStack.shift();
    }

    function undo() {
        const last = state.undoStack.pop();
        if (!last) return;
        sigilCtx.clearRect(0, 0, out.w, out.h);
        sigilCtx.drawImage(last.snap, 0, 0);
        state.points.length = last.len;
        drawAuthor();
        scheduleBake();
    }

    function clearAll() {
        state.isDrawing = false;
        state.points = [];
        state.undoStack = [];
        sigilCtx.clearRect(0, 0, out.w, out.h);
        drawAuthor();
        scheduleBake();
    }

    function renderFromPoints(src) {
        sigilCtx.clearRect(0, 0, out.w, out.h);
        state.points = [];
        const totals = state.taperEnabled ? strokeTotals(src) : null;
        for (let i = 0; i < src.length; i++) {
            const p = src[i];
            if (!p) {
                state.points.push(null);
                state.strokeCumDist = 0;
                continue;
            }
            if (totals) state.strokeTotalDist = totals[i] || 1e9;
            addPoint(p.x, p.y, p);
        }
        state.strokeTotalDist = 1e9;
    }

    function strokeTotals(src) {
        const totals = new Array(src.length).fill(1e9);
        let start = 0;
        for (let i = 0; i <= src.length; i++) {
            if (i === src.length || !src[i]) {
                let total = 0;
                for (let j = start + 1; j < i; j++) {
                    if (!src[j] || !src[j - 1]) break;
                    total += Math.hypot(src[j].x - src[j - 1].x, src[j].y - src[j - 1].y);
                }
                for (let j = start; j < i; j++) totals[j] = total || 1e9;
                start = i + 1;
            }
        }
        return totals;
    }

    function buildGenerated(seed) {
        const rng = makeRng(seed);
        const pts = [];
        const margin = Math.max(18 * K, brushPx * 2.2);
        const tN = clamp(state.genTime / 100, 0, 1);
        const connect = CFG.connect + brushPx;
        const steps = clamp(Math.floor(((out.w * out.h) / (9000 * K * K)) * (0.55 + tN * 1.25)), 240, 2200);
        const lenScale = (1.9 - tN * 1.25) * K;
        const penUp = 0.08 - tN * 0.06;

        let x = margin + rng() * (out.w - margin * 2);
        let y = margin + rng() * (out.h - margin * 2);
        let angle = rng() * Math.PI * 2;
        pts.push({ x, y, seed: (rng() * 0xFFFFFFFF) >>> 0, marker: state.marker });

        for (let i = 0; i < steps; i++) {
            if (rng() < penUp) {
                pts.push(null);
                x = margin + rng() * (out.w - margin * 2);
                y = margin + rng() * (out.h - margin * 2);
                angle = rng() * Math.PI * 2;
                pts.push({ x, y, seed: (rng() * 0xFFFFFFFF) >>> 0, marker: state.marker });
                continue;
            }
            angle += (rng() - 0.5) * 1.1;
            let len = (10 + rng() * 28) * (0.6 + brushPx / (14 * K)) * lenScale;
            len = clamp(len, Math.min(8 * K, connect * 0.85 * 0.35), connect * 0.85);
            x = clamp(x + Math.cos(angle) * len, margin, out.w - margin);
            y = clamp(y + Math.sin(angle) * len, margin, out.h - margin);
            pts.push({ x, y, seed: (rng() * 0xFFFFFFFF) >>> 0, marker: state.marker });
        }
        return pts;
    }

    // ─── Text layer ────────────────────────────────────────────────────────
    let charBoxes = [];     // { idx, x, y, w, h } in design space, pre-rotation

    function fontString() {
        return `${state.fontSize}px ${state.fontFamily}`;
    }

    function renderText() {
        textCtx.setTransform(1, 0, 0, 1, 0, 0);
        textCtx.clearRect(0, 0, out.w, out.h);
        charBoxes = [];
        if (!state.text.trim()) return;

        textCtx.save();
        textCtx.translate(state.textX * out.w, state.textY * out.h);
        textCtx.rotate(state.textRot * Math.PI / 180);
        textCtx.font = fontString();
        textCtx.textBaseline = 'middle';
        textCtx.fillStyle = '#fff';

        const lines = state.text.split('\n');
        const lineH = state.fontSize * state.leading;
        const startY = -((lines.length - 1) * lineH) / 2;
        let idx = 0;

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            let total = 0;
            for (let i = 0; i < line.length; i++) {
                total += textCtx.measureText(line[i]).width;
                if (i < line.length - 1) total += state.tracking;
            }
            let cx = state.align === 'center' ? -total / 2 : state.align === 'right' ? -total : 0;
            const y = startY + li * lineH;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                const w = textCtx.measureText(ch).width;
                if (ch.trim()) {
                    textCtx.fillText(ch, cx, y);
                    charBoxes.push({ ch, idx, x: cx, y, w, h: state.fontSize });
                }
                cx += w + state.tracking;
                idx++;
            }
        }
        textCtx.restore();
    }

    function drawAuthor() {
        actx.setTransform(1, 0, 0, 1, 0, 0);
        actx.fillStyle = '#0a0a0a';
        actx.fillRect(0, 0, out.w, out.h);
        actx.drawImage(sigilCanvas, 0, 0);
        actx.globalAlpha = 0.85;
        actx.drawImage(textCanvas, 0, 0);
        actx.globalAlpha = 1;
    }

    // ─── Bake ──────────────────────────────────────────────────────────────
    // Produces the atlas the shader reads. Distance comes from a jump flood over a
    // solid rasterisation of the form; the hand-drawn grain rides along in alpha.
    // Atlas width. The jump flood is O(w*h*log w) on the CPU, so this trades bake
    // latency against how much of the hand-drawn grain survives into the A channel.
    const BAKE_W = 768;
    let bakeTimer = 0;
    let renderer = null;

    function scheduleBake() {
        if (IS_OUTPUT) return;
        clearTimeout(bakeTimer);
        setBadge('baking');
        bakeTimer = setTimeout(bake, 160);
    }

    function bake() {
        const bw = BAKE_W;
        const bh = Math.max(2, Math.round(BAKE_W * out.h / out.w));

        // 1. Solid field: R encodes the travel coordinate s, G encodes the layer id.
        const field = document.createElement('canvas');
        field.width = bw;
        field.height = bh;
        const fctx = field.getContext('2d', { willReadFrequently: true });
        fctx.clearRect(0, 0, bw, bh);
        paintSigilField(fctx, bw / out.w, bh / out.h);
        paintTextField(fctx, bw / out.w, bh / out.h);

        // 2. Coverage: the gritty authored raster, downsampled.
        const cov = document.createElement('canvas');
        cov.width = bw;
        cov.height = bh;
        const cctx = cov.getContext('2d', { willReadFrequently: true });
        cctx.drawImage(sigilCanvas, 0, 0, bw, bh);
        cctx.drawImage(textCanvas, 0, 0, bw, bh);

        const fieldData = fctx.getImageData(0, 0, bw, bh).data;
        const covData = cctx.getImageData(0, 0, bw, bh).data;

        const atlas = jumpFlood(fieldData, covData, bw, bh);
        if (renderer) renderer.setAtlas(atlas);
        publishAtlas(atlas, bw, bh);
        setBadge();
    }

    function paintSigilField(fctx, sx, sy) {
        const pts = state.points;
        if (!pts.length) return;

        // Total path length normalises s to 0..1 across the whole sigil, so the charge
        // crosses the entire drawing once per cycle regardless of how it was split up.
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            if (!pts[i] || !pts[i - 1]) continue;
            total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        if (total <= 0) return;

        fctx.lineCap = 'round';
        fctx.lineJoin = 'round';
        const width = Math.max(1.5, brushPx * 2.6 * sx);
        let run = 0;

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            if (!a || !b) continue;
            const segLen = Math.hypot(b.x - a.x, b.y - a.y);
            const s0 = run / total;
            run += segLen;
            const s1 = run / total;

            // Mirror in design space, then scale: mirroredLines reflects about out.w/out.h.
            for (const l of mirroredLines(a.x, a.y, b.x, b.y)) {
                const x1 = l.x1 * sx, y1 = l.y1 * sy, x2 = l.x2 * sx, y2 = l.y2 * sy;
                const grad = fctx.createLinearGradient(x1, y1, x2, y2);
                grad.addColorStop(0, `rgb(${Math.round(s0 * 255)},128,0)`);
                grad.addColorStop(1, `rgb(${Math.round(s1 * 255)},128,0)`);
                fctx.strokeStyle = grad;
                fctx.lineWidth = width;
                fctx.beginPath();
                fctx.moveTo(x1, y1);
                fctx.lineTo(x2, y2);
                fctx.stroke();
            }
        }
    }

    function paintTextField(fctx, sx, sy) {
        if (!charBoxes.length) return;
        const n = charBoxes.length;
        fctx.save();
        fctx.translate(state.textX * out.w * sx, state.textY * out.h * sy);
        fctx.rotate(state.textRot * Math.PI / 180);
        fctx.scale(sx, sy);
        fctx.font = fontString();
        fctx.textBaseline = 'middle';
        // s runs in character order, so the charge lights letters in the order they read.
        for (let i = 0; i < n; i++) {
            const b = charBoxes[i];
            const s = n <= 1 ? 0 : i / (n - 1);
            fctx.fillStyle = `rgb(${Math.round(s * 255)},255,0)`;
            fctx.fillText(b.ch, b.x, b.y);
        }
        fctx.restore();
    }

    /* Jump flooding: each pixel adopts the nearest seed it can find by halving the
     * probe distance each pass. O(n log n) and good enough for a distance field that
     * only ever gets sampled through a smoothstep. */
    function jumpFlood(fieldData, covData, w, h) {
        const n = w * h;
        const seedX = new Int32Array(n).fill(-1);
        const seedY = new Int32Array(n).fill(-1);

        for (let i = 0; i < n; i++) {
            if (fieldData[i * 4 + 3] > 127) {
                seedX[i] = i % w;
                seedY[i] = (i / w) | 0;
            }
        }

        let step = 1;
        while (step < Math.max(w, h)) step <<= 1;
        step >>= 1;

        const nx = new Int32Array(seedX);
        const ny = new Int32Array(seedY);

        // Hot loop: distance is inlined and neighbour offsets are precomputed per pass,
        // because this runs w*h*9 times per pass and a call per probe is measurable.
        for (; step >= 1; step >>= 1) {
            nx.set(seedX);
            ny.set(seedY);
            for (let y = 0; y < h; y++) {
                const rowBase = y * w;
                for (let x = 0; x < w; x++) {
                    const i = rowBase + x;
                    let bx = seedX[i];
                    let by = seedY[i];
                    let best;
                    if (bx < 0) {
                        best = Infinity;
                    } else {
                        const dx = x - bx, dy = y - by;
                        best = dx * dx + dy * dy;
                    }
                    for (let oy = -1; oy <= 1; oy++) {
                        const yy = y + oy * step;
                        if (yy < 0 || yy >= h) continue;
                        const base = yy * w;
                        for (let ox = -1; ox <= 1; ox++) {
                            const xx = x + ox * step;
                            if (xx < 0 || xx >= w) continue;
                            const j = base + xx;
                            const cx = seedX[j];
                            if (cx < 0) continue;
                            const cy = seedY[j];
                            const dx = x - cx, dy = y - cy;
                            const d = dx * dx + dy * dy;
                            if (d < best) { best = d; bx = cx; by = cy; }
                        }
                    }
                    nx[i] = bx;
                    ny[i] = by;
                }
            }
            seedX.set(nx);
            seedY.set(ny);
        }

        // SDF_RANGE is a fraction of atlas height; match it here so the shader decodes right.
        const range = window.SigilShader.SDF_RANGE * h;
        const atlas = new ImageData(w, h);
        const px = atlas.data;

        for (let i = 0; i < n; i++) {
            const x = i % w, y = (i / w) | 0;
            const sx = seedX[i];
            let d = range;
            let s = 0, kind = 0;
            if (sx >= 0) {
                const sy = seedY[i];
                const dx = x - sx, dy = y - sy;
                d = Math.sqrt(dx * dx + dy * dy);
                const j = (sy * w + sx) * 4;
                s = fieldData[j];
                kind = fieldData[j + 1];
                // Inside the solid form the distance is negative; that's what gives the
                // shader a fill to erode or dilate with the Weight param.
                if (fieldData[i * 4 + 3] > 127) d = -insideDepth(fieldData, w, h, x, y);
            }
            const enc = clamp(0.5 + d / (2 * range), 0, 1);
            px[i * 4] = Math.round(enc * 255);
            px[i * 4 + 1] = s;
            px[i * 4 + 2] = kind;
            px[i * 4 + 3] = covData[i * 4 + 3];
        }
        return atlas;
    }

    // Cheap interior depth: how far to the nearest empty pixel, capped. Exact interior
    // distance would need a second flood and the shader never needs that precision.
    function insideDepth(fieldData, w, h, x, y) {
        const maxR = 24;
        for (let r = 1; r <= maxR; r++) {
            for (let oy = -r; oy <= r; oy++) {
                const yy = y + oy;
                if (yy < 0 || yy >= h) return r;
                const span = r - Math.abs(oy);
                for (const ox of [-span, span]) {
                    const xx = x + ox;
                    if (xx < 0 || xx >= w) return r;
                    if (fieldData[(yy * w + xx) * 4 + 3] <= 127) return r;
                }
            }
        }
        return maxR;
    }

    // ─── Playback ──────────────────────────────────────────────────────────
    let clock = 0;
    let lastFrame = 0;
    const audio = { low: 0, mid: 0, high: 0 };

    function frame(ts) {
        requestAnimationFrame(frame);
        const dt = lastFrame ? Math.min(0.1, (ts - lastFrame) / 1000) : 0;
        lastFrame = ts;
        // Speed scales the clock here rather than inside the shader, so moving the slider
        // ramps the motion instead of jumping its phase. The FFGL port does the same.
        if (state.playing) clock += dt * (params.speed != null ? params.speed : 1);

        pollAudio();
        if (renderer && renderer.atlasReady) renderer.render(params, clock, audio);
    }

    // ─── Audio ─────────────────────────────────────────────────────────────
    let analyser = null;
    let freqData = null;

    async function enableAudio() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ac = new (window.AudioContext || window.webkitAudioContext)();
            const src = ac.createMediaStreamSource(stream);
            analyser = ac.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.72;
            src.connect(analyser);
            freqData = new Uint8Array(analyser.frequencyBinCount);
            const btn = el('sl-audio');
            if (btn) { btn.textContent = 'Mic Active'; btn.classList.add('is-active'); }
        } catch (err) {
            const btn = el('sl-audio');
            if (btn) btn.textContent = 'Mic Blocked';
        }
    }

    function pollAudio() {
        if (!analyser) return;
        analyser.getByteFrequencyData(freqData);
        const n = freqData.length;
        const band = (a, b) => {
            let sum = 0;
            const lo = Math.floor(n * a), hi = Math.floor(n * b);
            for (let i = lo; i < hi; i++) sum += freqData[i];
            return sum / Math.max(1, hi - lo) / 255;
        };
        audio.low = band(0, 0.08);
        audio.mid = band(0.08, 0.35);
        audio.high = band(0.35, 1);
        const meter = el('sl-audio-meter');
        if (meter) meter.style.width = `${Math.round(audio.low * 100)}%`;
    }

    // ─── Output window sync ────────────────────────────────────────────────
    const bus = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    let lastAtlasUrl = '';

    function publishAtlas(imageData, w, h) {
        if (!bus || IS_OUTPUT) return;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').putImageData(imageData, 0, 0);
        lastAtlasUrl = c.toDataURL('image/png');
        bus.postMessage({ type: 'atlas', url: lastAtlasUrl, out: { w: out.w, h: out.h } });
    }

    function publishParams() {
        if (!bus || IS_OUTPUT) return;
        bus.postMessage({ type: 'params', params, playing: state.playing });
    }

    if (bus) {
        bus.onmessage = (e) => {
            const msg = e.data;
            if (IS_OUTPUT) {
                if (msg.type === 'atlas') {
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = img.width;
                        c.height = img.height;
                        const cx = c.getContext('2d');
                        cx.drawImage(img, 0, 0);
                        if (msg.out && (msg.out.w !== out.w || msg.out.h !== out.h)) {
                            out.w = msg.out.w;
                            out.h = msg.out.h;
                            liveCanvas.width = out.w;
                            liveCanvas.height = out.h;
                            fitStage();
                        }
                        if (renderer) renderer.setAtlas(cx.getImageData(0, 0, c.width, c.height));
                    };
                    img.src = msg.url;
                } else if (msg.type === 'params') {
                    params = msg.params;
                    state.playing = msg.playing;
                }
            } else if (msg.type === 'hello') {
                // A freshly opened output window asks for the current scene.
                if (lastAtlasUrl) bus.postMessage({ type: 'atlas', url: lastAtlasUrl, out: { w: out.w, h: out.h } });
                publishParams();
            }
        };
    }

    // ─── UI ────────────────────────────────────────────────────────────────
    function setBadge(override) {
        const m = el('stage-mode');
        const r = el('stage-res');
        if (m) m.textContent = override || state.tab;
        if (r) r.textContent = `${out.w}×${out.h}`;
    }

    function setTab(tab) {
        state.tab = tab;
        document.querySelectorAll('#tab-switch .panel-button').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.tab === tab);
        });
        document.querySelectorAll('.tab-pane').forEach((p) => {
            p.hidden = p.dataset.pane !== tab;
        });
        const live = tab === 'live' || tab === 'output';
        stage.dataset.mode = live ? 'live' : 'author';
        if (live) bake();
        setBadge();
    }

    function buildLiveControls() {
        const host = el('live-controls');
        if (!host) return;
        for (const group of PARAM_GROUPS) {
            const items = PARAMS.filter((p) => p.group === group);
            if (!items.length) continue;
            const heading = document.createElement('div');
            heading.className = 'group-heading';
            heading.textContent = group;
            host.appendChild(heading);

            for (const p of items) {
                const row = document.createElement('div');
                row.className = 'control-row';
                row.dataset.paramRow = p.key;

                const label = document.createElement('label');
                label.textContent = p.label;
                row.appendChild(label);

                // data-param makes every generated control addressable by key, which is
                // what a preset recall or an OSC mapping would bind against.
                if (p.type === 'color') {
                    const input = document.createElement('input');
                    input.type = 'color';
                    input.dataset.param = p.key;
                    input.value = p.def;
                    input.addEventListener('input', () => {
                        params[p.key] = input.value;
                        publishParams();
                    });
                    row.appendChild(input);
                } else if (p.options) {
                    const sel = document.createElement('select');
                    sel.className = 'select-input';
                    sel.dataset.param = p.key;
                    p.options.forEach((o, i) => {
                        const opt = document.createElement('option');
                        opt.value = String(i);
                        opt.textContent = o;
                        sel.appendChild(opt);
                    });
                    sel.value = String(p.def);
                    sel.addEventListener('change', () => {
                        params[p.key] = parseFloat(sel.value);
                        publishParams();
                    });
                    row.appendChild(sel);
                } else {
                    const input = document.createElement('input');
                    input.type = 'range';
                    input.dataset.param = p.key;
                    input.min = p.min;
                    input.max = p.max;
                    input.step = p.step;
                    input.value = p.def;
                    const out2 = document.createElement('span');
                    out2.className = 'param-value';
                    out2.textContent = fmt(p.def, p.step);
                    input.addEventListener('input', () => {
                        params[p.key] = parseFloat(input.value);
                        out2.textContent = fmt(params[p.key], p.step);
                        publishParams();
                    });
                    row.appendChild(input);
                    row.appendChild(out2);
                }
                host.appendChild(row);
            }
        }
    }

    const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : v.toFixed(2));

    function bindRange(id, key, onChange, format) {
        const input = el(id);
        const out2 = el(`val-${id}`);
        if (!input) return;
        input.addEventListener('input', () => {
            state[key] = parseFloat(input.value);
            if (out2) out2.textContent = format ? format(state[key]) : input.value;
            if (onChange) onChange();
        });
    }

    function wireUI() {
        document.querySelectorAll('#tab-switch .panel-button').forEach((b) => {
            b.addEventListener('click', () => setTab(b.dataset.tab));
        });

        // Draw
        bindRange('sl-brush', 'brushSize', () => { brushPx = state.brushSize * K; });
        el('sl-marker').addEventListener('change', (e) => { state.marker = e.target.value; });
        el('sl-taper').addEventListener('change', (e) => { state.taperEnabled = e.target.checked; });
        el('sl-mirror-x').addEventListener('change', (e) => { state.mirrorX = e.target.checked; });
        el('sl-mirror-y').addEventListener('change', (e) => { state.mirrorY = e.target.checked; });
        bindRange('sl-gen-time', 'genTime');
        el('sl-generate').addEventListener('click', () => {
            pushUndo();
            state.genSeed = (Math.random() * 0x7fffffff) | 0;
            renderFromPoints(buildGenerated(state.genSeed));
            drawAuthor();
            scheduleBake();
        });
        el('sl-undo').addEventListener('click', undo);
        el('sl-clear').addEventListener('click', clearAll);

        // Type
        const textChanged = () => { renderText(); drawAuthor(); scheduleBake(); };
        el('sl-text').addEventListener('input', (e) => { state.text = e.target.value; textChanged(); });
        bindRange('sl-font-size', 'fontSize', textChanged);
        bindRange('sl-tracking', 'tracking', textChanged);
        bindRange('sl-leading', 'leading', textChanged, (v) => v.toFixed(2));
        bindRange('sl-text-x', 'textX', textChanged, (v) => v.toFixed(2));
        bindRange('sl-text-y', 'textY', textChanged, (v) => v.toFixed(2));
        bindRange('sl-text-rot', 'textRot', textChanged);
        el('sl-font').addEventListener('change', (e) => { state.fontFamily = e.target.value; textChanged(); });
        document.querySelectorAll('#sl-align .panel-button').forEach((b) => {
            b.addEventListener('click', () => {
                state.align = b.dataset.align;
                document.querySelectorAll('#sl-align .panel-button')
                    .forEach((x) => x.classList.toggle('is-active', x === b));
                textChanged();
            });
        });

        // Live
        el('sl-play').addEventListener('click', () => {
            state.playing = !state.playing;
            const btn = el('sl-play');
            btn.textContent = state.playing ? 'Pause' : 'Play';
            btn.classList.toggle('is-active', state.playing);
            publishParams();
        });
        el('sl-reset-params').addEventListener('click', () => {
            params = defaultParams();
            el('live-controls').innerHTML = '';
            buildLiveControls();
            publishParams();
        });

        // Output
        el('sl-res').addEventListener('change', (e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            setOutputSize(w, h);
            setBadge();
        });
        el('sl-audio').addEventListener('click', enableAudio);
        el('sl-popout').addEventListener('click', () => {
            window.open('sigil-live.html?output=1', 'sigil-live-output',
                `width=${Math.min(1280, out.w)},height=${Math.min(760, out.h)}`);
        });
        el('sl-export-ffgl').addEventListener('click', exportFFGL);

        const infoBtn = el('info-btn');
        const overlay = el('info-overlay');
        if (infoBtn && overlay) {
            infoBtn.addEventListener('click', () => { overlay.hidden = false; });
            el('info-close').addEventListener('click', () => { overlay.hidden = true; });
        }
    }

    // ─── Drawing input ─────────────────────────────────────────────────────
    function snapAxis(ax, ay, x, y) {
        return Math.abs(x - ax) > Math.abs(y - ay) ? { x, y: ay } : { x: ax, y };
    }

    function startDraw(e) {
        if (state.tab !== 'draw') return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        state.isDrawing = true;
        pushUndo();
        state.strokeCumDist = 0;
        state.strokeStartIdx = state.points.length;
        state.strokeTotalDist = 1e9;
        state.lastDrawTime = performance.now();
        state.lastDrawSpeed = 0;
        state.currentSpeed = 0;
        const p = designCoords(e);
        addPoint(p.x, p.y);
        drawAuthor();
    }

    function moveDraw(e) {
        if (!state.isDrawing || state.tab !== 'draw') return;
        e.preventDefault();
        const p = designCoords(e);
        const prev = state.points[state.points.length - 1];
        let { x, y } = p;
        if (prev && e.shiftKey) {
            const s = snapAxis(prev.x, prev.y, x, y);
            x = s.x;
            y = s.y;
        } else {
            x += (Math.random() - 0.5) * brushPx * 0.8;
            y += (Math.random() - 0.5) * brushPx * 0.8;
        }
        if (prev && Math.hypot(x - prev.x, y - prev.y) < minDrawDist) return;
        addPoint(x, y);
        drawAuthor();
    }

    function endDraw() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        state.points.push(null);
        scheduleBake();
    }

    function bindDrawing() {
        authorCanvas.addEventListener('mousedown', startDraw);
        window.addEventListener('mousemove', moveDraw);
        window.addEventListener('mouseup', endDraw);
        authorCanvas.addEventListener('touchstart', startDraw, { passive: false });
        authorCanvas.addEventListener('touchmove', moveDraw, { passive: false });
        authorCanvas.addEventListener('touchend', endDraw);

        window.addEventListener('keydown', (e) => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
            if (typing) return;
            if (e.key === ' ') { e.preventDefault(); clearAll(); }
            else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
            else if (e.key === 'Tab') {
                e.preventDefault();
                const order = ['draw', 'type', 'live', 'output'];
                setTab(order[(order.indexOf(state.tab) + 1) % order.length]);
            }
        });

        // Drop a font file anywhere on the stage to use it.
        stage.addEventListener('dragover', (e) => e.preventDefault());
        stage.addEventListener('drop', async (e) => {
            e.preventDefault();
            const file = e.dataTransfer?.files?.[0];
            if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name)) return;
            const name = `Dropped${Date.now()}`;
            const face = new FontFace(name, await file.arrayBuffer());
            await face.load();
            document.fonts.add(face);
            state.fontFamily = `'${name}'`;
            const sel = el('sl-font');
            if (sel) {
                const opt = document.createElement('option');
                opt.value = state.fontFamily;
                opt.textContent = file.name.replace(/\.[^.]+$/, '');
                sel.appendChild(opt);
                sel.value = state.fontFamily;
            }
            renderText();
            drawAuthor();
            scheduleBake();
        });
    }

    // ─── Export ────────────────────────────────────────────────────────────
    function download(name, blobOrUrl) {
        const a = document.createElement('a');
        a.download = name;
        a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
        a.click();
    }

    // The bundle is everything the FFGL plugin needs: the baked field as a texture,
    // the parameter manifest in declaration order, and the shader itself.
    function exportFFGL() {
        bake();
        const manifest = {
            name: 'SigilLive',
            type: 'FF_SOURCE',
            atlas: 'sigil-atlas.png',
            atlasChannels: {
                r: 'signed distance, decode as (r - 0.5) * 2 * sdfRange',
                g: 'travel coordinate s, 0..1',
                b: 'layer id, 0.5 = sigil, 1.0 = text',
                a: 'hand-drawn coverage',
            },
            sdfRange: window.SigilShader.SDF_RANGE,
            output: { width: out.w, height: out.h },
            parameters: PARAMS.map((p, i) => ({
                index: i,
                name: p.label,
                uniform: 'u' + p.key.charAt(0).toUpperCase() + p.key.slice(1),
                group: p.group,
                type: p.type === 'color' ? 'FF_TYPE_RED/GREEN/BLUE' : 'FF_TYPE_STANDARD',
                min: p.min ?? 0,
                max: p.max ?? 1,
                default: p.def,
                current: params[p.key],
            })),
        };

        if (lastAtlasUrl) download('sigil-atlas.png', lastAtlasUrl);
        setTimeout(() => download('sigil-params.json',
            new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })), 250);
        setTimeout(() => download('SigilLive.frag',
            new Blob([FRAG_SRC], { type: 'text/plain' })), 500);
    }

    // Hooks the shared export chrome in page-transition.js looks for.
    window.exportPagePNG = function () {
        if (state.tab !== 'live' && state.tab !== 'output') return authorCanvas.toDataURL('image/png');
        const url = renderAtFullSize().toDataURL('image/png');
        fitStage();   // back to the cheap preview size
        return url;
    };
    window.prepareCanvasVideoExport = function () {
        setTab('live');
        // Recording wants the real resolution for its whole duration, so fitStage is not
        // called back until the next layout change.
        setLiveSize(out.w, out.h);
        return liveCanvas;
    };

    // ─── Boot ──────────────────────────────────────────────────────────────
    function init() {
        try {
            renderer = new SigilRenderer(liveCanvas);
        } catch (err) {
            console.error(err);
            setBadge('no webgl2');
        }

        if (IS_OUTPUT) {
            stage.dataset.mode = 'live';
            liveCanvas.width = out.w;
            liveCanvas.height = out.h;
            fitStage();
            observeStage();
            window.addEventListener('resize', fitStage);
            if (bus) bus.postMessage({ type: 'hello' });
            requestAnimationFrame(frame);
            return;
        }

        wireUI();
        buildLiveControls();
        setOutputSize(out.w, out.h);
        bindDrawing();
        setTab('draw');
        observeStage();
        window.addEventListener('resize', fitStage);

        // Something on screen from the first frame beats an empty canvas.
        renderFromPoints(buildGenerated(state.genSeed));
        state.text = 'OVRT';
        const ta = el('sl-text');
        if (ta) ta.value = state.text;
        renderText();
        drawAuthor();
        bake();

        // The hub embeds this page in an iframe as its card preview, so show the
        // animated output there rather than the static authoring canvas.
        if (IS_PREVIEW) setTab('live');

        requestAnimationFrame(frame);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
