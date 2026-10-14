/*
 * RITE — a composition engine that is performed by the music rather than by sliders.
 *
 * The frame is cut into blocks. Each block holds one word scaled to its edges, a sigil,
 * a flat field of colour, or nothing. The whole partition is derived from a single seed,
 * which means a seed is a composition and reseeding is a cut.
 *
 * Nothing eases between compositions. On a big screen an eased transition reads as a
 * smear; a hard cut on the beat reads as intent.
 *
 * Structure:
 *   layout     guillotine subdivision, seeded, aspect aware
 *   plate      the composition drawn once into an offscreen canvas on reseed
 *   routings   six dials that wire an audio feature to a behaviour, applied per frame
 *              by blitting rectangles out of the plate — the per-frame cost is a
 *              handful of drawImage calls, not a redraw
 */
(function () {
    'use strict';

    const { AudioEngine } = window.RiteAudio;
    const { Ink, generate: genSigil, normalise, indexAt } = window.RiteSigil;

    const qs = new URLSearchParams(location.search);
    const IS_OUTPUT = qs.get('output') === '1';
    const IS_PREVIEW = qs.get('preview') === '1';
    const CHANNEL = 'rite';

    if (IS_OUTPUT) document.body.classList.add('is-output');
    if (IS_PREVIEW) document.body.classList.add('is-preview');

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;

    function makeRng(seed) {
        let s = (seed >>> 0) || 1;
        return () => {
            s ^= s << 13; s >>>= 0;
            s ^= s >> 17;
            s ^= s << 5; s >>>= 0;
            return s / 4294967296;
        };
    }

    // ─── Elements ──────────────────────────────────────────────────────────
    const el = (id) => document.getElementById(id);
    const stage = el('stage');
    const stageInner = el('stage-inner');
    const canvas = el('rite-canvas');
    const ctx = canvas.getContext('2d');
    const inkCanvas = el('ink-canvas');
    const inkCtx = inkCanvas.getContext('2d');

    // ─── Schemes ───────────────────────────────────────────────────────────
    // Two colours only. A cell is either ink-on-paper or paper-on-ink, and that
    // single flip is what gives the composition its contrast without a palette.
    const SCHEMES = [
        { id: 'mono', label: 'Black / White', ink: '#000000', paper: '#ffffff' },
        { id: 'blue', label: 'Blue / White', ink: '#1f1fe8', paper: '#ffffff' },
        { id: 'red', label: 'Red / White', ink: '#f11b1b', paper: '#ffffff' },
        { id: 'acid', label: 'Acid / Black', ink: '#ccff00', paper: '#0a0a0a' },
    ];

    // ─── Routings ──────────────────────────────────────────────────────────
    // Each one reads "this part of the music drives this behaviour, this hard".
    // Six is the whole motion surface — the music supplies the rest.
    const ROUTES = [
        { key: 'slam', label: 'Bass → Slam', hint: 'Blocks punch on the kick.' },
        { key: 'drift', label: 'Mids → Flow', hint: 'Type floats inside its block.' },
        { key: 'fracture', label: 'Highs → Fracture', hint: 'Blocks shear into offset slices.' },
        { key: 'cut', label: 'Sound → Seed', hint: 'A new composition on the beat and on a new sound.' },
        { key: 'strip', label: 'Break → Strip', hint: 'Blocks drain away when the bass drops out.' },
        { key: 'blow', label: 'Drop → Explode', hint: 'The layout bursts apart on a drop.' },
    ];

    // ─── Modes ─────────────────────────────────────────────────────────────
    // Six ways of cutting a frame, on keys 1–6. They all return plain rectangles that
    // tile the frame, so everything downstream — content, motion, the plate — is shared.
    // A mode may set forceRot on a cell when its shape only works rotated.
    const MODES = [
        { id: 'blocks', label: 'Blocks', build: layoutBlocks },
        { id: 'stack', label: 'Stack', build: layoutStack },
        { id: 'column', label: 'Column', build: layoutColumn },
        { id: 'frame', label: 'Frame', build: layoutFrame },
        { id: 'scatter', label: 'Scatter', build: layoutScatter },
        { id: 'solo', label: 'Solo', build: layoutSolo },
    ];

    // ─── State ─────────────────────────────────────────────────────────────
    const out = { w: 1920, h: 1080 };

    const state = {
        text: 'RITE\nOVRT\nLIVE',
        name: 'OVRT',
        font: "'ABC Diatype Mono', monospace",
        weight: 700,
        density: 0.45,
        chaos: 0.35,
        inkMix: 0.3,
        scheme: 1,
        invert: false,
        flipOnCut: true,
        routes: { slam: 0.6, drift: 0.45, fracture: 0.35, cut: 0.35, strip: 0.7, blow: 0.8 },
        marker: 'line',
        brush: 3,
        mirror: true,
        drawMode: false,
        library: [],
        mode: 0,
        mediaShare: 0.5,
        seed: (Math.random() * 1e9) | 0,
        index: 1,
        running: true,
        training: false,
        freeRun: false,
    };

    // Names cycle with N and are editable with Enter. The caption block reads from here,
    // so a set can be labelled on the fly without opening the panel.
    const NAMES = ['OVRT', 'RITE', 'NOCTURN', 'TRANSMIT', 'VESSEL', 'ARCANA', 'SIGNAL', 'OMEN'];
    let nameIdx = 0;

    /*
     * Taste.
     *
     * In training you judge compositions — keep or reject — and the generator moves
     * toward what you kept. It stores a bias per control rather than a target, so your
     * sliders still mean what they say; training only decides where around them to look.
     *
     * Each composition records the values it was actually built with, which is what
     * gets reinforced. Without that the model would learn the slider, not the frame.
     */
    const taste = {
        bias: { density: 0, chaos: 0, inkMix: 0 },
        modeScore: MODES.map(() => 0),
        kept: 0,
        rejected: 0,
    };
    let built = null;        // the values the current composition was generated from

    function tasteExplore(rng) {
        // Exploration shrinks as the model gets confident, so late in a set it stops
        // throwing compositions you have already rejected.
        const conf = clamp(taste.kept / 12, 0, 1);
        const spread = lerp(0.3, 0.08, conf);
        const pick = (k) => clamp(state[k] + taste.bias[k] + (rng() - 0.5) * 2 * spread, 0, 1);
        return { density: pick('density'), chaos: pick('chaos'), inkMix: pick('inkMix') };
    }

    function tastePickMode(rng) {
        const scores = taste.modeScore.map((s) => Math.exp(s * 1.1));
        const sum = scores.reduce((a, b) => a + b, 0);
        let r = rng() * sum;
        for (let i = 0; i < scores.length; i++) { r -= scores[i]; if (r <= 0) return i; }
        return state.mode;
    }

    function judge(keep) {
        if (!built) return;
        const rate = keep ? 0.3 : -0.18;
        for (const k of ['density', 'chaos', 'inkMix']) {
            taste.bias[k] = clamp(taste.bias[k] + (built[k] - state[k] - taste.bias[k]) * rate, -0.45, 0.45);
        }
        taste.modeScore[built.mode] = clamp(taste.modeScore[built.mode] + (keep ? 0.4 : -0.5), -3, 3);
        if (keep) taste.kept++; else taste.rejected++;
        setTrainingReadout();
        reseed();
    }

    const audio = new AudioEngine();
    const ink = new Ink();

    // ─── Plate ─────────────────────────────────────────────────────────────
    // The composition is painted here once per cut. Frames blit rectangles out of it.
    const plate = document.createElement('canvas');
    const pctx = plate.getContext('2d');

    let cells = [];
    let scheme = SCHEMES[state.scheme];
    let paper = '#fff';
    let inkColor = '#000';
    let lightPaper = true;

    // Dropped stills and footage. Empty by default — the tool is type and ink until
    // you give it something else.
    const media = [];

    function luma(hex) {
        const n = parseInt(hex.slice(1), 16);
        return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
    }

    // ─── Layout ────────────────────────────────────────────────────────────

    // Cuts a span into n parts whose sizes come from a ratio palette rather than being
    // uniform. Equal divisions read as a spreadsheet; related ones read as a composition.
    function divide(rng, total, n, chaos) {
        const weights = [];
        const pool = [1, 1, 1.618, 0.618, 2, 0.5];
        const wild = [3, 0.33, 4, 0.25];
        for (let i = 0; i < n; i++) {
            const p = rng() < chaos * 0.5 ? wild : pool;
            weights.push(p[Math.floor(rng() * p.length)]);
        }
        const sum = weights.reduce((a, b) => a + b, 0);
        const out = weights.map((w) => Math.max(1, Math.round(total * w / sum)));
        out[n - 1] = total - out.slice(0, n - 1).reduce((a, b) => a + b, 0);
        return out;
    }

    /*
     * Guillotine subdivision. Splitting the biggest cell each round keeps the partition
     * balanced, and always splitting a cell's longer side is what makes this survive a
     * 1536×256 strip — a wide frame simply splits vertically over and over.
     */
    function layoutBlocks(rng, w, h) {
        const target = Math.round(lerp(4, 18, built.density) * lerp(0.75, 1.25, built.chaos));
        const minDim = Math.min(w, h) * lerp(0.2, 0.08, built.density);

        const list = [{ x: 0, y: 0, w, h }];
        const ratios = [0.5, 0.382, 0.618, 0.333, 0.667];
        const wild = [0.25, 0.75, 0.2, 0.8];

        let guard = 200;
        while (list.length < target && guard-- > 0) {
            // Bias toward the largest cell, but with chaos let a smaller one get picked
            // so the result is not a tidy recursive halving.
            list.sort((a, b) => b.w * b.h - a.w * a.h);
            const span = 1 + Math.floor(rng() * (1 + built.chaos * 3));
            const i = Math.min(list.length - 1, Math.floor(rng() * span));
            const c = list[i];

            const vertical = c.w > c.h * 1.05 ? true : c.h > c.w * 1.05 ? false : rng() < 0.5;
            const pool = rng() < built.chaos * 0.6 ? wild : ratios;
            const r = pool[Math.floor(rng() * pool.length)];

            const a = {}, b = {};
            if (vertical) {
                const cut = Math.round(c.w * r);
                if (cut < minDim || c.w - cut < minDim) { c.w *= 1.0001; continue; }
                Object.assign(a, { x: c.x, y: c.y, w: cut, h: c.h });
                Object.assign(b, { x: c.x + cut, y: c.y, w: c.w - cut, h: c.h });
            } else {
                const cut = Math.round(c.h * r);
                if (cut < minDim || c.h - cut < minDim) { c.h *= 1.0001; continue; }
                Object.assign(a, { x: c.x, y: c.y, w: c.w, h: cut });
                Object.assign(b, { x: c.x, y: c.y + cut, w: c.w, h: c.h - cut });
            }
            list.splice(i, 1, a, b);
        }

        return list;
    }

    // Full-width bands. Type stretched across the whole frame is the loudest thing this
    // tool can do, so most bands are left whole and only some are split.
    function layoutStack(rng, w, h) {
        const n = clamp(Math.round(lerp(2, 8, built.density)), 2, 10);
        const heights = divide(rng, h, n, built.chaos);
        const list = [];
        let y = 0;
        for (const bh of heights) {
            const splits = rng() < built.chaos * 0.7 ? 1 + Math.floor(rng() * 2) : 0;
            if (!splits) {
                list.push({ x: 0, y, w, h: bh });
            } else {
                const widths = divide(rng, w, splits + 1, built.chaos);
                let x = 0;
                for (const bw of widths) { list.push({ x, y, w: bw, h: bh }); x += bw; }
            }
            y += bh;
        }
        return list;
    }

    // The same idea turned ninety degrees. Columns force rotated type, which is the one
    // layout where a long word becomes an advantage instead of a fitting problem.
    function layoutColumn(rng, w, h) {
        const n = clamp(Math.round(lerp(3, 10, built.density)), 2, 12);
        const widths = divide(rng, w, n, built.chaos);
        const list = [];
        let x = 0;
        for (const bw of widths) {
            const splits = rng() < built.chaos * 0.6 ? 1 : 0;
            if (!splits) {
                list.push({ x, y: 0, w: bw, h, forceRot: rng() < 0.75 ? (rng() < 0.5 ? -90 : 90) : 0 });
            } else {
                const heights = divide(rng, h, 2, built.chaos);
                let y = 0;
                for (const bh of heights) {
                    list.push({ x, y, w: bw, h: bh, forceRot: bh > bw * 1.3 ? -90 : 0 });
                    y += bh;
                }
            }
            x += bw;
        }
        return list;
    }

    // One hero block with a border of small ones around it. The hero gets the first
    // word because content is handed out by area.
    function layoutFrame(rng, w, h) {
        const inset = lerp(0.3, 0.16, built.density);
        const ox = Math.round(w * inset * (0.6 + rng() * 0.8));
        const oy = Math.round(h * inset * (0.6 + rng() * 0.8));
        const rx = Math.round(w * inset * (0.6 + rng() * 0.8));
        const by = Math.round(h * inset * (0.6 + rng() * 0.8));

        const list = [{ x: ox, y: oy, w: w - ox - rx, h: h - oy - by }];
        const band = (x, y, bw, bh, along) => {
            if (bw < 4 || bh < 4) return;
            const n = clamp(Math.round(lerp(1, 4, built.density) * (0.7 + rng())), 1, 5);
            const parts = divide(rng, along === 'x' ? bw : bh, n, built.chaos);
            let p = along === 'x' ? x : y;
            for (const s of parts) {
                list.push(along === 'x' ? { x: p, y, w: s, h: bh } : { x, y: p, w: bw, h: s });
                p += s;
            }
        };
        band(0, 0, w, oy, 'x');                       // top
        band(0, h - by, w, by, 'x');                  // bottom
        band(0, oy, ox, h - oy - by, 'y');            // left
        band(w - rx, oy, rx, h - oy - by, 'y');       // right
        return list.filter((c) => c.w > 2 && c.h > 2);
    }

    // A coarse grid where neighbours merge into bigger rectangles. Keeps the grid's
    // alignment but loses its regularity, which is the point.
    function layoutScatter(rng, w, h) {
        const cols = clamp(Math.round(lerp(3, 7, built.density)), 2, 8);
        const rows = clamp(Math.round(cols * (h / w) * 1.4), 2, 8);
        const cw = divide(rng, w, cols, built.chaos * 0.5);
        const ch = divide(rng, h, rows, built.chaos * 0.5);
        const xs = [0], ys = [0];
        cw.forEach((v) => xs.push(xs[xs.length - 1] + v));
        ch.forEach((v) => ys.push(ys[ys.length - 1] + v));

        const taken = new Set();
        const list = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (taken.has(`${r},${c}`)) continue;
                let sw = 1, sh = 1;
                if (rng() < 0.3 + built.chaos * 0.35) {
                    sw = 1 + (rng() < 0.5 ? 1 : 0);
                    sh = 1 + (rng() < 0.4 ? 1 : 0);
                }
                sw = Math.min(sw, cols - c);
                sh = Math.min(sh, rows - r);
                for (let a = 0; a < sh; a++) for (let b = 0; b < sw; b++) taken.add(`${r + a},${c + b}`);
                const x = xs[c], y = ys[r];
                list.push({ x, y, w: xs[c + sw] - x, h: ys[r + sh] - y });
            }
        }
        return list;
    }

    // One word, edge to edge, with a thin strip for the caption. Nothing to read but
    // the word — the mode you cut to when the track drops out.
    function layoutSolo(rng, w, h) {
        const horizontal = w >= h;
        const strip = Math.round((horizontal ? h : w) * lerp(0.2, 0.09, built.density));
        const atStart = rng() < 0.5;
        const hero = horizontal
            ? { x: 0, y: atStart ? strip : 0, w, h: h - strip }
            : { x: atStart ? strip : 0, y: 0, w: w - strip, h };
        const rest = horizontal
            ? { x: 0, y: atStart ? 0 : h - strip, w, h: strip }
            : { x: atStart ? 0 : w - strip, y: 0, w: strip, h };

        const list = [hero];
        const n = clamp(Math.round(lerp(2, 5, built.density)), 1, 6);
        const parts = divide(rng, horizontal ? w : h, n, built.chaos);
        let p = 0;
        for (const s of parts) {
            list.push(horizontal
                ? { x: p, y: rest.y, w: s, h: strip }
                : { x: rest.x, y: p, w: strip, h: s });
            p += s;
        }
        return list;
    }

    function buildLayout(seed, w, h) {
        return MODES[built.mode].build(makeRng(seed), w, h);
    }

    /*
     * Hands out what each block contains. Words go to the biggest blocks in the order
     * they were typed, so the first line of text is always the thing you read first.
     */
    function assignContent(list, seed) {
        const rng = makeRng(seed ^ 0x9e3779b9);
        const tokens = state.text.split(/\s+/).map((t) => t.trim()).filter(Boolean);

        list.sort((a, b) => b.w * b.h - a.w * a.h);

        // Words get repeated across blocks rather than appearing once each. A frame with
        // three words and twelve blocks should still read as typography, not as gaps.
        const wordSlots = clamp(Math.round(list.length * 0.5), Math.min(list.length, tokens.length), list.length);

        list.forEach((c, i) => {
            c.id = i;
            c.flip = state.flipOnCut ? rng() < 0.38 : i % 3 === 0;
            // A mode that needs rotation says so; otherwise it only pays off in a tall
            // block, because rotating a wide one wastes the space it was given.
            c.rot = c.forceRot != null ? c.forceRot : 0;
            if (c.forceRot == null && c.h > c.w * 1.5 && rng() < 0.3 + built.chaos * 0.45) {
                c.rot = rng() < 0.5 ? -90 : 90;
            }
            c.dir = rng() * Math.PI * 2;
            c.phase = rng() * Math.PI * 2;
            c.rank = rng();
        });

        const words = list.slice(0, wordSlots);
        const rest = list.slice(wordSlots);
        words.forEach((c, i) => {
            c.role = 'word';
            c.text = tokens[i % tokens.length] || state.name;
        });

        // Roles for everything that is not a word, then sorted so empty blocks end up
        // being the small ones. A large block of flat colour carries the frame; a large
        // block of nothing just drops a hole in it.
        const n = rest.length;
        if (n) {
            const nSigil = clamp(Math.round(n * built.inkMix), 0, n - 1);
            const nMedia = media.length ? clamp(Math.round((n - nSigil) * state.mediaShare), 0, n - nSigil - 1) : 0;
            const spare = n - nSigil - nMedia - 1;
            const nVoid = Math.max(0, Math.round(spare * 0.35));
            const roles = [];
            for (let i = 0; i < nSigil; i++) roles.push('sigil');
            for (let i = 0; i < nMedia; i++) roles.push('media');
            roles.push('meta');
            for (let i = 0; i < spare - nVoid; i++) roles.push('fill');
            for (let i = 0; i < nVoid; i++) roles.push('void');

            for (let i = roles.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [roles[i], roles[j]] = [roles[j], roles[i]];
            }
            const weight = (r) => (r === 'void' ? 2 : r === 'meta' ? 1 : 0);
            roles.sort((a, b) => weight(a) - weight(b));

            rest.forEach((c, i) => {
                c.role = roles[i];
                if (c.role === 'media') {
                    c.media = media[Math.floor(rng() * media.length)];
                    c.crop = { x: rng() * 0.3, y: rng() * 0.3, s: 0.7 + rng() * 0.3 };
                    return;
                }
                if (c.role !== 'sigil') return;
                c.path = pickPath(rng);
                c.revealed = 0;
                c.target = 0;
                c.marker = state.marker;
            });
        }

        return list;
    }

    function pickPath(rng) {
        if (state.library.length) return state.library[Math.floor(rng() * state.library.length)];
        return genSigil((rng() * 1e9) | 0, lerp(0.25, 0.9, built.chaos));
    }

    // ─── Painting the plate ────────────────────────────────────────────────

    function colorsFor(c) {
        const flipped = c.flip !== state.invert;
        return flipped ? { bg: inkColor, fg: paper } : { bg: paper, fg: inkColor };
    }

    function paintPlate() {
        plate.width = out.w;
        plate.height = out.h;
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.fillStyle = paper;
        pctx.fillRect(0, 0, out.w, out.h);
        for (const c of cells) paintCell(c);
    }

    function paintCell(c) {
        const col = colorsFor(c);
        pctx.save();
        pctx.beginPath();
        pctx.rect(c.x, c.y, c.w, c.h);
        pctx.clip();
        pctx.fillStyle = c.role === 'fill' ? col.fg : col.bg;
        pctx.fillRect(c.x, c.y, c.w, c.h);

        if (c.role === 'word') paintWord(c, col);
        else if (c.role === 'meta') paintMeta(c, col);
        else if (c.role === 'media' && c.media && c.media.kind === 'image') paintMedia(c);
        // Sigil cells fill in over the following beats, so nothing is painted now.
        // Video cells are drawn live each frame, since the plate only updates on a cut.

        pctx.restore();
    }

    /*
     * Crushes an image or a video frame into the two colours of the scheme.
     *
     * Greyscale plus heavy contrast gets the source to near black and white, then two
     * composites map those onto the palette: multiply by the lighter colour pulls the
     * highlights down to it, screen by the darker colour lifts the shadows up to it.
     * The result is a duotone that works for any pair, including dark-paper schemes.
     *
     * Doing it with composite ops instead of getImageData is what lets video run at
     * frame rate — there is no pixel loop anywhere in here.
     */
    function paintMedia(c) {
        const m = c.media;
        if (!m || !m.el) return;
        const src = m.el;
        const sw = m.kind === 'video' ? src.videoWidth : src.naturalWidth;
        const sh = m.kind === 'video' ? src.videoHeight : src.naturalHeight;
        if (!sw || !sh) return;

        const crop = c.crop || { x: 0, y: 0, s: 1 };
        const cw = sw * crop.s;
        const ch = sh * crop.s;
        // Cover-fit so a block is always filled; a letterboxed block breaks the grid.
        const k = Math.max(c.w / cw, c.h / ch);
        const dw = cw * k;
        const dh = ch * k;

        const dark = lightPaper ? inkColor : paper;
        const light = lightPaper ? paper : inkColor;

        pctx.save();
        pctx.beginPath();
        pctx.rect(c.x, c.y, c.w, c.h);
        pctx.clip();
        pctx.filter = 'grayscale(1) contrast(320%)';
        pctx.drawImage(src, sw * crop.x, sh * crop.y, cw, ch,
            c.x + (c.w - dw) / 2, c.y + (c.h - dh) / 2, dw, dh);
        pctx.filter = 'none';
        pctx.globalCompositeOperation = 'multiply';
        pctx.fillStyle = light;
        pctx.fillRect(c.x, c.y, c.w, c.h);
        pctx.globalCompositeOperation = 'screen';
        pctx.fillStyle = dark;
        pctx.fillRect(c.x, c.y, c.w, c.h);
        pctx.restore();
    }

    // Video only moves if its block is repainted, and the plate is only painted on a
    // cut. Refreshing those blocks in place keeps every downstream effect — motion,
    // fracture, strip — working on video exactly as it does on everything else.
    function refreshVideo() {
        for (const c of cells) {
            if (c.role !== 'media' || !c.media || c.media.kind !== 'video') continue;
            if (c.media.el.readyState < 2) continue;
            paintMedia(c);
        }
    }

    /*
     * Sets one word to the edges of its block. Measuring the ink box rather than the
     * font's line box is the whole trick — it is why caps touch the block's edges
     * instead of floating inside the leading.
     */
    function paintWord(c, col) {
        const text = (c.text || '').toUpperCase();
        if (!text) return;

        const rotated = c.rot !== 0;
        const pad = 0.018;
        const boxW = (rotated ? c.h : c.w) * (1 - pad * 2);
        const boxH = (rotated ? c.w : c.h) * (1 - pad * 2);
        if (boxW <= 2 || boxH <= 2) return;

        const probe = 100;
        pctx.font = `${state.weight} ${probe}px ${state.font}`;
        pctx.textAlign = 'left';
        pctx.textBaseline = 'alphabetic';
        const m = pctx.measureText(text);
        const inkW = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
        const inkH = (m.actualBoundingBoxAscent || probe * 0.7) + (m.actualBoundingBoxDescent || 0);
        if (inkW <= 0 || inkH <= 0) return;

        // A block's proportions almost never match a word's, so a plain contain-fit
        // leaves one axis empty and the frame reads thin. Letting the short axis stretch
        // up to MAX_STRETCH fills the block the way a condensed or extended cut would.
        const MAX_STRETCH = 1.9;
        const base = Math.min(boxW / inkW, boxH / inkH);
        const fx = Math.min(boxW / inkW, base * MAX_STRETCH);
        const fy = Math.min(boxH / inkH, base * MAX_STRETCH);

        const size = probe * fx;
        const left = (m.actualBoundingBoxLeft || 0) * fx;
        const asc = (m.actualBoundingBoxAscent || probe * 0.7) * fx;
        const w = inkW * fx;
        const h = inkH * fx;

        pctx.translate(c.x + c.w / 2, c.y + c.h / 2);
        if (rotated) pctx.rotate(c.rot * Math.PI / 180);
        // Scaling after the rotation means the stretch always runs along the block's
        // short axis, not the frame's.
        pctx.scale(1, fy / fx);
        pctx.font = `${state.weight} ${size}px ${state.font}`;
        pctx.fillStyle = col.fg;
        pctx.fillText(text, -w / 2 + left, -h / 2 + asc);
    }

    function paintMeta(c, col) {
        const lines = [
            state.name.toUpperCase(),
            'RITE',
            `${Math.round(audio.bpm)} BPM`,
            `IDX-${String(state.index).padStart(3, '0')}`,
        ];
        const size = clamp(Math.min(c.w, c.h) * 0.12, 8, Math.min(c.h / (lines.length + 1), 40));
        pctx.font = `700 ${size}px 'ABC Diatype Mono', monospace`;
        pctx.textAlign = 'left';
        pctx.textBaseline = 'top';
        pctx.fillStyle = col.fg;
        const pad = size * 0.8;
        lines.forEach((t, i) => pctx.fillText(t, c.x + pad, c.y + pad + i * size * 1.22));
    }

    /*
     * Advances sigil cells. Each beat extends the target; each frame draws a bounded
     * slice of the gap onto the plate. The cap is what keeps a dense sigil from
     * dropping a frame when it first appears.
     */
    const DRAW_BUDGET = 60;

    function advanceInk(onBeat) {
        for (const c of cells) {
            if (c.role !== 'sigil' || !c.path) continue;
            const n = c.path.points.length;
            if (onBeat && c.target < n) {
                // Four beats to lay a sigil down: fast enough to read as drawing, slow
                // enough that you see it happen.
                c.target = Math.min(n, c.target + Math.ceil(n / 4));
            }
            if (c.revealed >= c.target) continue;

            const to = Math.min(c.target, c.revealed + DRAW_BUDGET);
            const col = colorsFor(c);
            pctx.save();
            pctx.beginPath();
            pctx.rect(c.x, c.y, c.w, c.h);
            pctx.clip();
            ink.drawRange(pctx, c.path, { x: c.x, y: c.y, w: c.w, h: c.h }, c.revealed, to, {
                brush: state.brush,
                marker: c.marker || state.marker,
                color: col.fg,
                mirrorX: state.mirror,
                taper: true,
            });
            pctx.restore();
            c.revealed = to;
        }
    }

    // ─── Cutting ───────────────────────────────────────────────────────────

    function reseed(seed, forceBuilt) {
        state.seed = seed != null ? seed : (Math.random() * 1e9) | 0;
        state.index++;

        // Every composition records the values it was generated from. In training those
        // are explored around the sliders; otherwise they are the sliders. Either way
        // the rest of the pipeline reads `built`, so judging a frame reinforces what was
        // actually on screen rather than where the controls happen to sit now.
        const rng = makeRng(state.seed ^ 0x51ed2701);
        built = forceBuilt || (state.training && !IS_OUTPUT
            ? Object.assign(tasteExplore(rng), { mode: tastePickMode(rng) })
            : { density: state.density, chaos: state.chaos, inkMix: state.inkMix, mode: state.mode });

        scheme = SCHEMES[state.scheme];
        paper = state.invert ? scheme.ink : scheme.paper;
        inkColor = state.invert ? scheme.paper : scheme.ink;
        lightPaper = luma(paper) > luma(inkColor);
        cells = assignContent(buildLayout(state.seed, out.w, out.h), state.seed);
        paintPlate();
        setTrainingReadout();
        publish();
    }

    // Keeps the blocks, redraws their contents — a different reading of the same frame.
    function restructure() {
        const s = (state.seed ^ (Math.random() * 1e9)) | 0;
        cells = assignContent(cells.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, forceRot: c.forceRot })), s);
        state.index++;
        paintPlate();
        publish();
    }

    // ─── Frame ─────────────────────────────────────────────────────────────

    let clock = 0;
    let last = 0;
    let fps = 60;
    const motion = { blow: 0, strip: 0, beatPulse: 0 };

    function frame(ts) {
        requestAnimationFrame(frame);
        const dt = last ? clamp((ts - last) / 1000, 0.001, 0.1) : 0.016;
        last = ts;
        fps = fps * 0.92 + (1 / dt) * 0.08;
        if (!state.running) return;
        clock += dt;

        audio.update(dt, state.freeRun);
        react(dt);
        render();
        updateBadge();
        if (!IS_OUTPUT) publishLive();
    }

    function react(dt) {
        const r = state.routes;
        const ev = audio.events;

        if (ev.beat) {
            motion.beatPulse = 1;
            advanceInk(true);
            // Training owns the seed, so the music does not steal the frame you are judging.
            if (!state.training && r.cut > 0 && Math.random() < r.cut * r.cut) reseed();
        } else {
            advanceInk(false);
        }
        motion.beatPulse = Math.max(0, motion.beatPulse - dt * 4);

        if (!state.training && ev.newSound && r.cut > 0) reseed();

        if (!state.training && ev.drop && r.blow > 0) {
            motion.blow = 1;
            reseed();
        }
        motion.blow = Math.max(0, motion.blow - dt * 1.8);

        // Strip ramps rather than switching, because a break is a gradual emptying.
        const want = audio.inBreak ? 1 : 0;
        motion.strip += (want - motion.strip) * (1 - Math.exp(-dt / (want ? 0.5 : 0.25)));

        // Slam impulses are staggered so the blocks hit as a cluster, not as one object.
        const hit = audio.onsets.bass;
        for (const c of cells) {
            c.slam = Math.max((c.slam || 0) - dt * 5, hit > 0.5 ? hit * (0.55 + (c.rank || 0) * 0.45) : 0);
        }
    }

    function render() {
        const r = state.routes;
        if (media.length) refreshVideo();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const k = canvas.width / out.w;
        const cx = out.w / 2;
        const cy = out.h / 2;
        const strip = motion.strip * r.strip;
        const blow = motion.blow * motion.blow * r.blow;
        const drift = audio.bands.mid * r.drift;
        const frac = audio.bands.high * r.fracture;

        // Drift moves content inside its block rather than moving the block, so the
        // partition stays readable while the type is never still. Oversizing by twice
        // the drift amplitude means the block's edge is always covered.
        const driftAmp = drift * 0.05;

        for (const c of cells) {
            // Blocks leave in order of their stable rank, so a break empties the frame
            // the same way each time instead of flickering at random.
            if (strip > 0.02 && c.rank < strip * 0.85 && c.role !== 'word') continue;
            if (strip > 0.8 && c.rank < (strip - 0.8) * 4) continue;

            const slam = (c.slam || 0) * r.slam;
            const s = 1 + slam * 0.1 + blow * 0.12 + driftAmp * 2;

            let dx = Math.cos(c.dir) * slam * c.w * 0.04;
            let dy = Math.sin(c.dir) * slam * c.h * 0.04;

            // Two incommensurate rates keep blocks from ever syncing up into a single
            // rocking motion, which is what makes drift read as many objects.
            dx += Math.sin(clock * 0.9 + c.phase) * driftAmp * c.w;
            dy += Math.cos(clock * 0.61 + c.phase * 1.7) * driftAmp * c.h;

            const bursting = blow > 0.01;
            if (bursting) {
                dx += (c.x + c.w / 2 - cx) * blow * 0.35;
                dy += (c.y + c.h / 2 - cy) * blow * 0.35;
            }

            const dw = c.w * s;
            const dh = c.h * s;
            const px = (c.x + dx - (dw - c.w) / 2) * k;
            const py = (c.y + dy - (dh - c.h) / 2) * k;

            // Blocks stay in their own rectangle — overlapping blocks read as a bug
            // rather than as motion. A drop is the one thing allowed to break the grid.
            if (!bursting) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(c.x * k, c.y * k, c.w * k, c.h * k);
                ctx.clip();
            }
            if (frac > 0.08) drawFractured(c, px, py, dw * k, dh * k, frac, k);
            else ctx.drawImage(plate, c.x, c.y, c.w, c.h, px, py, dw * k, dh * k);
            if (!bursting) ctx.restore();
        }
    }

    // Shears a block into horizontal bands with alternating offsets. Sampling from the
    // plate means this costs a few extra blits rather than a re-render.
    function drawFractured(c, px, py, pw, ph, amount, k) {
        const slices = Math.max(2, Math.round(2 + amount * 10));
        const sh = c.h / slices;
        const dh = ph / slices;
        const reach = amount * c.w * 0.22 * k;
        const seed = c.id * 2654435761;
        for (let i = 0; i < slices; i++) {
            const n = Math.sin(seed + i * 12.9898 + clock * 9) * 43758.5453;
            const off = (n - Math.floor(n) - 0.5) * 2 * reach;
            ctx.drawImage(plate,
                c.x, c.y + i * sh, c.w, sh,
                px + off, py + i * dh, pw, dh + 1);
        }
    }

    // ─── Sizing ────────────────────────────────────────────────────────────

    function setOutputSize(w, h) {
        out.w = Math.max(64, Math.round(w));
        out.h = Math.max(64, Math.round(h));
        reseed(state.seed);
        fitStage();
    }

    function fitStage() {
        const pad = IS_OUTPUT || IS_PREVIEW ? 0 : 20;
        // Before first layout the stage reports no size; fall back to the output
        // resolution rather than locking the canvas to a couple of pixels.
        if (stage.clientWidth < 8 || stage.clientHeight < 8) {
            stageInner.style.width = '';
            stageInner.style.height = '';
            setCanvasSize(out.w, out.h);
            return;
        }
        const aw = Math.max(1, stage.clientWidth - pad * 2);
        const ah = Math.max(1, stage.clientHeight - pad * 2);
        const scale = Math.min(aw / out.w, ah / out.h);
        const dw = Math.max(16, Math.round(out.w * scale));
        const dh = Math.max(16, Math.round(out.h * scale));
        stageInner.style.width = `${dw}px`;
        stageInner.style.height = `${dh}px`;
        // Rendering above the displayed size buys nothing; the plate stays full res so
        // snapshots and the output window are still exact.
        setCanvasSize(IS_OUTPUT ? out.w : Math.min(out.w, dw), IS_OUTPUT ? out.h : Math.min(out.h, dh));
    }

    function setCanvasSize(w, h) {
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        inkCanvas.width = Math.min(1024, w);
        inkCanvas.height = Math.round(inkCanvas.width * (out.h / out.w));
    }

    function observeStage() {
        if (typeof ResizeObserver === 'undefined') return;
        new ResizeObserver(() => fitStage()).observe(stage);
    }

    // ─── Drawing your own sigils ───────────────────────────────────────────

    let drawing = null;

    function inkCoords(e) {
        const r = inkCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) / r.width,
            y: (e.clientY - r.top) / r.height,
        };
    }

    function repaintInk() {
        inkCtx.setTransform(1, 0, 0, 1, 0, 0);
        inkCtx.fillStyle = '#111';
        inkCtx.fillRect(0, 0, inkCanvas.width, inkCanvas.height);
        if (!drawing || drawing.length < 2) return;
        const path = normalise(drawing.map((p) => (p ? { x: p.x, y: p.y, seed: p.seed } : null)));
        if (!path) return;
        const pad = inkCanvas.width * 0.06;
        ink.draw(inkCtx, path, {
            x: pad, y: pad,
            w: inkCanvas.width - pad * 2,
            h: inkCanvas.height - pad * 2,
        }, { brush: state.brush, marker: state.marker, color: '#fff', mirrorX: state.mirror, taper: true });
    }

    function bindDrawing() {
        const down = (e) => {
            if (!state.drawMode) return;
            inkCanvas.setPointerCapture(e.pointerId);
            const p = inkCoords(e);
            if (drawing && drawing.length) drawing.push(null);
            else drawing = [];
            drawing.push({ x: p.x, y: p.y, seed: (Math.random() * 0xFFFFFFFF) >>> 0 });
            e.preventDefault();
        };
        const move = (e) => {
            if (!state.drawMode || !drawing || !inkCanvas.hasPointerCapture(e.pointerId)) return;
            const p = inkCoords(e);
            const prev = drawing[drawing.length - 1];
            if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.004) return;
            drawing.push({ x: p.x, y: p.y, seed: (Math.random() * 0xFFFFFFFF) >>> 0 });
            repaintInk();
            e.preventDefault();
        };
        const up = (e) => {
            if (!state.drawMode) return;
            try { inkCanvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        };
        inkCanvas.addEventListener('pointerdown', down);
        inkCanvas.addEventListener('pointermove', move);
        inkCanvas.addEventListener('pointerup', up);
        inkCanvas.addEventListener('pointercancel', up);
    }

    function keepSigil() {
        if (!drawing || drawing.filter(Boolean).length < 3) return;
        const path = normalise(drawing.map((p) => (p ? { x: p.x, y: p.y, seed: p.seed, marker: state.marker } : null)));
        if (!path) return;
        state.library.push(path);
        drawing = null;
        repaintInk();
        renderLibrary();
        reseed(state.seed);
    }

    function renderLibrary() {
        const host = el('ink-library');
        host.innerHTML = '';
        if (!state.library.length) {
            host.innerHTML = '<p class="hint">No sigils kept yet — the engine will generate its own.</p>';
            return;
        }
        state.library.forEach((path, i) => {
            const c = document.createElement('canvas');
            c.width = 56; c.height = 56;
            c.className = 'ink-thumb';
            c.title = 'Click to remove';
            const cc = c.getContext('2d');
            cc.fillStyle = '#111';
            cc.fillRect(0, 0, 56, 56);
            ink.draw(cc, path, { x: 4, y: 4, w: 48, h: 48 }, { brush: 2.5, marker: 'line', color: '#fff' });
            c.addEventListener('click', () => {
                state.library.splice(i, 1);
                renderLibrary();
                reseed(state.seed);
            });
            host.appendChild(c);
        });
    }

    // ─── Output window ─────────────────────────────────────────────────────
    // The output window runs the same engine. Because a composition is a pure function
    // of its seed, sending the seed plus the audio features is enough to keep the two
    // in step — far cheaper than streaming pixels.

    const bus = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    let liveTimer = 0;

    function publish() {
        if (!bus || IS_OUTPUT) return;
        bus.postMessage({
            type: 'state',
            state: {
                text: state.text, name: state.name, font: state.font, weight: state.weight,
                density: state.density, chaos: state.chaos, inkMix: state.inkMix,
                scheme: state.scheme, invert: state.invert, flipOnCut: state.flipOnCut,
                routes: state.routes, marker: state.marker, brush: state.brush,
                mirror: state.mirror, seed: state.seed, index: state.index,
                library: state.library, mode: state.mode, mediaShare: state.mediaShare,
                training: state.training, freeRun: state.freeRun, built,
            },
            out: { w: out.w, h: out.h },
        });
    }

    function publishLive() {
        if (!bus) return;
        liveTimer++;
        if (liveTimer % 2) return;   // 30 Hz is plenty for driving motion
        bus.postMessage({
            type: 'live',
            bands: audio.bands,
            onsets: audio.onsets,
            events: audio.events,
            bpm: audio.bpm,
            inBreak: audio.inBreak,
            clock,
        });
    }

    function bindBus() {
        if (!bus) return;
        bus.onmessage = (e) => {
            const m = e.data;
            if (!IS_OUTPUT) return;
            if (m.type === 'state') {
                const s = m.state;
                const reseeded = s.seed !== state.seed || s.index !== state.index;
                const forceBuilt = s.built;
                Object.assign(state, s);
                if (m.out.w !== out.w || m.out.h !== out.h) {
                    if (forceBuilt) built = forceBuilt;
                    setOutputSize(m.out.w, m.out.h);
                } else if (reseeded) reseed(s.seed, forceBuilt);
            } else if (m.type === 'live') {
                Object.assign(audio.bands, m.bands);
                Object.assign(audio.onsets, m.onsets);
                Object.assign(audio.events, m.events);
                audio.bpm = m.bpm;
                audio.inBreak = m.inBreak;
            }
        };
    }

    // ─── Badge ─────────────────────────────────────────────────────────────

    let badgeTick = 0;

    function updateBadge() {
        if (IS_OUTPUT || IS_PREVIEW) return;
        if (badgeTick++ % 10) return;
        el('badge-mode').textContent = (MODES[built ? built.mode : state.mode] || MODES[0]).label.toUpperCase();
        el('badge-res').textContent = `${out.w}×${out.h}`;
        el('badge-fps').textContent = `${Math.round(fps)} FPS`;
        el('badge-ms').textContent = `${(1000 / Math.max(1, fps)).toFixed(1)} MS`;
        el('badge-bpm').textContent = `${Math.round(audio.bpm)} BPM`;
        el('badge-src').textContent = state.freeRun || !audio.ready ? 'FREE RUN' : audio.sourceKind.toUpperCase();
        const zoom = canvas.width / out.w;
        el('badge-zoom').textContent = `${Math.round(zoom * 100)}%`;
        const m = el('badge-meter').children;
        const vals = [audio.bands.bass, audio.bands.lowMid, audio.bands.mid, audio.bands.high];
        for (let i = 0; i < m.length; i++) m[i].style.opacity = String(0.15 + clamp(vals[i] * 1.6, 0, 1) * 0.85);
    }

    // ─── UI ────────────────────────────────────────────────────────────────

    function bindRange(id, read, write, fmt) {
        const input = el(id);
        if (!input) return;
        const label = el(`val-${id}`);
        const sync = () => { if (label) label.textContent = fmt ? fmt(read()) : read().toFixed(2); };
        input.value = String(read());
        sync();
        input.addEventListener('input', () => {
            write(parseFloat(input.value));
            sync();
        });
        return sync;
    }

    function buildRoutes() {
        const host = el('route-controls');
        for (const r of ROUTES) {
            const row = document.createElement('div');
            row.className = 'control-row';
            row.innerHTML = `
                <label for="rt-${r.key}" title="${r.hint}">${r.label}</label>
                <input type="range" id="rt-${r.key}" min="0" max="10" step="1">
                <span class="param-value" id="val-rt-${r.key}"></span>`;
            host.appendChild(row);
            bindRange(`rt-${r.key}`,
                () => Math.round(state.routes[r.key] * 10),
                (v) => { state.routes[r.key] = v / 10; publish(); },
                (v) => String(Math.round(v)));
        }
    }

    function buildSchemes() {
        const host = el('scheme-switch');
        SCHEMES.forEach((s, i) => {
            const b = document.createElement('button');
            b.className = 'panel-button' + (i === state.scheme ? ' is-active' : '');
            b.textContent = s.label;
            b.dataset.scheme = String(i);
            b.addEventListener('click', () => setScheme(i));
            host.appendChild(b);
        });
    }

    function setScheme(i) {
        state.scheme = (i + SCHEMES.length) % SCHEMES.length;
        [...el('scheme-switch').children].forEach((b, j) => b.classList.toggle('is-active', j === state.scheme));
        reseed(state.seed);
    }

    function wireUI() {
        if (IS_OUTPUT || IS_PREVIEW) return;

        const textEl = el('rt-text');
        textEl.value = state.text;
        textEl.addEventListener('input', () => { state.text = textEl.value; reseed(state.seed); });

        const nameEl = el('rt-name');
        nameEl.value = state.name;
        nameEl.addEventListener('input', () => { state.name = nameEl.value; reseed(state.seed); });

        const fontEl = el('rt-font');
        fontEl.value = state.font;
        fontEl.addEventListener('change', () => { state.font = fontEl.value; reseed(state.seed); });

        const weightEl = el('rt-weight');
        weightEl.value = String(state.weight);
        weightEl.addEventListener('change', () => { state.weight = parseInt(weightEl.value, 10); reseed(state.seed); });

        bindRange('rt-density', () => state.density, (v) => { state.density = v; reseed(state.seed); }, (v) => String(Math.round(v * 100)));
        bindRange('rt-chaos', () => state.chaos, (v) => { state.chaos = v; reseed(state.seed); }, (v) => String(Math.round(v * 100)));
        bindRange('rt-inkmix', () => state.inkMix, (v) => { state.inkMix = v; reseed(state.seed); }, (v) => String(Math.round(v * 100)));
        bindRange('rt-mediashare', () => state.mediaShare, (v) => { state.mediaShare = v; reseed(state.seed); }, (v) => String(Math.round(v * 100)));
        bindRange('rt-brush', () => state.brush, (v) => { state.brush = v; repaintInk(); }, (v) => String(Math.round(v)));

        el('rt-seed').addEventListener('click', () => reseed());
        el('rt-restructure').addEventListener('click', () => restructure());
        el('rt-reset').addEventListener('click', () => resetAll());
        el('rt-train').addEventListener('click', () => setTraining(!state.training));
        el('rt-freerun').addEventListener('click', () => setFreeRun(!state.freeRun));

        const modeEl = el('rt-mode');
        MODES.forEach((m, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = `${i + 1}  ${m.label}`;
            modeEl.appendChild(opt);
        });
        modeEl.value = String(state.mode);
        modeEl.addEventListener('change', () => setMode(parseInt(modeEl.value, 10)));

        el('rt-media-clear').addEventListener('click', () => clearMedia());
        el('rt-media-file').addEventListener('change', (e) => {
            ingestFiles(e.target.files);
            e.target.value = '';
        });

        el('rt-invert').addEventListener('click', () => toggleInvert());
        const flip = el('rt-flip');
        flip.checked = state.flipOnCut;
        flip.addEventListener('change', () => { state.flipOnCut = flip.checked; reseed(state.seed); });

        const markerEl = el('rt-marker');
        markerEl.value = state.marker;
        markerEl.addEventListener('change', () => { state.marker = markerEl.value; repaintInk(); });

        const mirrorEl = el('rt-mirror');
        mirrorEl.checked = state.mirror;
        mirrorEl.addEventListener('change', () => { state.mirror = mirrorEl.checked; repaintInk(); });

        el('rt-draw').addEventListener('click', () => setDrawMode(!state.drawMode));
        el('rt-keep').addEventListener('click', () => keepSigil());
        el('rt-discard').addEventListener('click', () => { drawing = null; repaintInk(); });

        const resEl = el('rt-res');
        resEl.addEventListener('change', () => {
            const [w, h] = resEl.value.split('x').map(Number);
            el('rt-w').value = String(w);
            el('rt-h').value = String(h);
            setOutputSize(w, h);
            publish();
        });
        const applySize = () => {
            setOutputSize(parseInt(el('rt-w').value, 10) || out.w, parseInt(el('rt-h').value, 10) || out.h);
            publish();
        };
        el('rt-w').addEventListener('change', applySize);
        el('rt-h').addEventListener('change', applySize);

        el('rt-fullscreen').addEventListener('click', () => goFullscreen());
        el('rt-popout').addEventListener('click', () => {
            window.open(`${location.pathname}?output=1`, 'rite-output',
                `width=${Math.min(1280, out.w)},height=${Math.min(760, out.h)}`);
            setTimeout(publish, 400);
        });
        el('rt-snapshot').addEventListener('click', () => snapshot());

        el('rt-mic').addEventListener('click', () => enableInput());
        el('rt-audio-file').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) audio.useFile(f).catch(() => setAudioNote('Could not play that file.'));
        });

        const info = el('info-overlay');
        el('info-btn').addEventListener('click', () => { info.hidden = false; });
        el('info-close').addEventListener('click', () => { info.hidden = true; });
    }

    function toggleInvert() {
        state.invert = !state.invert;
        el('rt-invert').classList.toggle('is-active', state.invert);
        reseed(state.seed);
    }

    function setDrawMode(on) {
        state.drawMode = on;
        stage.dataset.mode = on ? 'draw' : 'live';
        el('rt-draw').classList.toggle('is-active', on);
        el('rt-draw').textContent = on ? 'Close Drawing' : 'Draw a Sigil';
        if (on) repaintInk();
    }

    function setAudioNote(msg) {
        el('audio-note').textContent = msg;
    }

    async function enableInput() {
        try {
            await audio.useMicrophone();
            setAudioNote('Listening. Feed the desk into an input and it will lock to the track.');
            el('rt-mic').classList.add('is-active');
        } catch (err) {
            setAudioNote(err.message || String(err));
        }
    }

    function goFullscreen() {
        const target = stageInner;
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        target.requestFullscreen().then(() => {
            // Fullscreen is the signal that this frame is going somewhere real, so it
            // renders at the true output size rather than the preview size.
            setCanvasSize(out.w, out.h);
        }).catch(() => { /* blocked, nothing to recover */ });
    }

    function snapshot() {
        const w = canvas.width, h = canvas.height;
        setCanvasSize(out.w, out.h);
        render();
        const url = canvas.toDataURL('image/png');
        setCanvasSize(w, h);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rite-${String(state.index).padStart(3, '0')}.png`;
        a.click();
    }

    // ─── Scenes and stores ─────────────────────────────────────────────────
    // Ctrl+1–8 writes the current look into a slot, Shift+1–8 recalls it. Slots live in
    // localStorage so a set survives a reload, which matters when the reload happens
    // ten minutes before doors.

    const SLOT_KEY = 'rite.slots.v1';
    let slots = loadSlots();

    function loadSlots() {
        try { return JSON.parse(localStorage.getItem(SLOT_KEY)) || {}; } catch (e) { return {}; }
    }

    function storeSlot(n) {
        // The sigil library is deliberately left out: it can be megabytes of path data
        // and it is not part of what a scene is for.
        slots[n] = {
            text: state.text, name: state.name, font: state.font, weight: state.weight,
            density: state.density, chaos: state.chaos, inkMix: state.inkMix,
            scheme: state.scheme, invert: state.invert, flipOnCut: state.flipOnCut,
            routes: Object.assign({}, state.routes), mode: state.mode,
            marker: state.marker, brush: state.brush, mirror: state.mirror,
            mediaShare: state.mediaShare, seed: state.seed,
        };
        try { localStorage.setItem(SLOT_KEY, JSON.stringify(slots)); } catch (e) { /* quota, ignore */ }
        flashBadge(`STORED ${n}`);
        renderSlots();
    }

    function recallSlot(n) {
        const s = slots[n];
        if (!s) { flashBadge(`SLOT ${n} EMPTY`); return; }
        Object.assign(state, s, { routes: Object.assign({}, s.routes) });
        syncControls();
        reseed(s.seed);
        flashBadge(`SCENE ${n}`);
    }

    function renderSlots() {
        const host = el('slot-row');
        if (!host) return;
        host.innerHTML = '';
        for (let n = 1; n <= 8; n++) {
            const b = document.createElement('button');
            b.className = 'slot' + (slots[n] ? ' is-filled' : '');
            b.textContent = String(n);
            b.title = slots[n] ? `Recall scene ${n} — shift-click to overwrite` : `Empty — shift-click to store`;
            b.addEventListener('click', (e) => (e.shiftKey ? storeSlot(n) : recallSlot(n)));
            host.appendChild(b);
        }
    }

    // ─── Keyboard ──────────────────────────────────────────────────────────

    function bindKeys() {
        if (IS_PREVIEW) return;
        window.addEventListener('keydown', (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

            // Digits carry three meanings depending on the modifier, so they are handled
            // before the main switch.
            if (e.key >= '1' && e.key <= '8') {
                const n = parseInt(e.key, 10);
                if (e.ctrlKey || e.metaKey) { storeSlot(n); e.preventDefault(); return; }
                if (e.shiftKey) { recallSlot(n); e.preventDefault(); return; }
            }
            if (e.key >= '1' && e.key <= '6' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                setMode(parseInt(e.key, 10) - 1);
                e.preventDefault();
                return;
            }

            const step = e.shiftKey ? 0.2 : 0.05;
            switch (e.key) {
                // In training, space and X are the verdict; otherwise space is just a cut.
                case ' ': state.training ? judge(true) : reseed(); e.preventDefault(); break;
                case 'x': case 'X': if (state.training) judge(false); break;
                case 't': case 'T': setTraining(!state.training); break;
                case 'g': case 'G': setFreeRun(!state.freeRun); break;
                case 'a': case 'A': enableInput(); break;
                case 'c': case 'C': restructure(); break;
                case 'i': case 'I': toggleInvert(); break;
                case 'b': case 'B': setScheme(state.scheme + 1); break;
                case 'n': case 'N': nextName(); break;
                case 'Enter': editName(); e.preventDefault(); break;
                case 'f': case 'F': goFullscreen(); break;
                case 'h': case 'H': document.body.classList.toggle('hide-ui'); break;
                case 's': case 'S': snapshot(); break;
                case 'd': case 'D': setDrawMode(!state.drawMode); break;
                case 'r': case 'R': resetAll(); break;
                case 'ArrowRight': setForm('chaos', state.chaos + step); e.preventDefault(); break;
                case 'ArrowLeft': setForm('chaos', state.chaos - step); e.preventDefault(); break;
                case 'ArrowUp': setForm('density', state.density - step); e.preventDefault(); break;
                case 'ArrowDown': setForm('density', state.density + step); e.preventDefault(); break;
                default: break;
            }
        });
    }

    function setMode(i) {
        state.mode = (i + MODES.length) % MODES.length;
        const sel = el('rt-mode');
        if (sel) sel.value = String(state.mode);
        reseed();
    }

    function setTraining(on) {
        state.training = on;
        document.body.classList.toggle('is-training', on);
        const b = el('rt-train');
        if (b) { b.classList.toggle('is-active', on); b.textContent = on ? 'Stop Training' : 'Train'; }
        setTrainingReadout();
        if (on) reseed();
    }

    function setTrainingReadout() {
        const n = el('train-readout');
        if (!n) return;
        n.textContent = state.training
            ? `Keep (Space) or reject (X). ${taste.kept} kept, ${taste.rejected} rejected.`
            : `${taste.kept} kept, ${taste.rejected} rejected. Press T to train.`;
    }

    function setFreeRun(on) {
        state.freeRun = on;
        const b = el('rt-freerun');
        if (b) b.classList.toggle('is-active', on);
        flashBadge(on ? 'FREE RUN' : 'AUDIO');
    }

    function nextName() {
        nameIdx = (nameIdx + 1) % NAMES.length;
        state.name = NAMES[nameIdx];
        const f = el('rt-name');
        if (f) f.value = state.name;
        reseed(state.seed);
    }

    function editName() {
        const f = el('rt-name');
        if (f) { f.focus(); f.select(); }
    }

    function resetAll() {
        Object.assign(state, {
            density: 0.45, chaos: 0.35, inkMix: 0.3, mode: 0, invert: false,
            routes: { slam: 0.6, drift: 0.45, fracture: 0.35, cut: 0.35, strip: 0.7, blow: 0.8 },
        });
        taste.bias = { density: 0, chaos: 0, inkMix: 0 };
        taste.modeScore = MODES.map(() => 0);
        taste.kept = taste.rejected = 0;
        syncControls();
        reseed();
        flashBadge('RESET');
    }

    // Pushes state back into the panel after anything changes it from outside — a slot
    // recall, a reset, a keyboard nudge.
    function syncControls() {
        if (IS_OUTPUT || IS_PREVIEW) return;
        const setVal = (id, v) => { const n = el(id); if (n) n.value = String(v); };
        const setLabel = (id, v) => { const n = el(`val-${id}`); if (n) n.textContent = v; };
        setVal('rt-text', state.text); setVal('rt-name', state.name);
        setVal('rt-font', state.font); setVal('rt-weight', state.weight);
        setVal('rt-mode', state.mode); setVal('rt-marker', state.marker);
        for (const [id, v] of [['rt-density', state.density], ['rt-chaos', state.chaos],
        ['rt-inkmix', state.inkMix], ['rt-mediashare', state.mediaShare]]) {
            setVal(id, v); setLabel(id, String(Math.round(v * 100)));
        }
        setVal('rt-brush', state.brush); setLabel('rt-brush', String(state.brush));
        for (const r of ROUTES) {
            setVal(`rt-${r.key}`, Math.round(state.routes[r.key] * 10));
            setLabel(`rt-${r.key}`, String(Math.round(state.routes[r.key] * 10)));
        }
        const flip = el('rt-flip'); if (flip) flip.checked = state.flipOnCut;
        const mir = el('rt-mirror'); if (mir) mir.checked = state.mirror;
        const inv = el('rt-invert'); if (inv) inv.classList.toggle('is-active', state.invert);
        [...el('scheme-switch').children].forEach((b, j) => b.classList.toggle('is-active', j === state.scheme));
    }

    let flashTimer = 0;

    function flashBadge(msg) {
        const n = el('badge-flash');
        if (!n) return;
        n.textContent = msg;
        n.classList.add('is-on');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => n.classList.remove('is-on'), 900);
    }

    function setForm(key, value) {
        state[key] = clamp(value, 0, 1);
        const input = el(key === 'chaos' ? 'rt-chaos' : 'rt-density');
        if (input) {
            input.value = String(state[key]);
            el(`val-${input.id}`).textContent = String(Math.round(state[key] * 100));
        }
        reseed(state.seed);
    }

    // ─── Fonts dropped onto the window ─────────────────────────────────────

    function bindDrops() {
        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((n) => document.addEventListener(n, stop));
        document.addEventListener('drop', async (e) => {
            const files = e.dataTransfer && e.dataTransfer.files;
            if (!files || !files.length) return;
            await ingestFiles(files);
        });
    }

    async function ingestFiles(fileList) {
        const files = [...fileList];
        let addedMedia = false;
        for (const f of files) {
            if (/\.(ttf|otf|woff2?)$/i.test(f.name)) {
                const face = new FontFace('RiteDropped', await f.arrayBuffer());
                await face.load();
                document.fonts.add(face);
                state.font = "'RiteDropped', sans-serif";
                const sel = el('rt-font');
                if (sel) {
                    let opt = sel.querySelector('option[value*="RiteDropped"]');
                    if (!opt) {
                        opt = document.createElement('option');
                        opt.value = state.font;
                        sel.appendChild(opt);
                    }
                    opt.textContent = f.name.replace(/\.[^.]+$/, '');
                    sel.value = state.font;
                }
            } else if (/^audio\//.test(f.type) || /\.(mp3|wav|m4a|aiff?|flac)$/i.test(f.name)) {
                audio.useFile(f).then(() => setAudioNote(`Playing ${f.name}.`))
                    .catch(() => setAudioNote('Could not play that file.'));
            } else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) {
                await addImage(f);
                addedMedia = true;
            } else if (/^video\//.test(f.type) || /\.(mp4|webm|mov|m4v)$/i.test(f.name)) {
                addVideo(f);
                addedMedia = true;
            }
        }
        renderMediaLibrary();
        if (addedMedia) reseed(state.seed);
        else if (files.some((f) => /\.(ttf|otf|woff2?)$/i.test(f.name))) reseed(state.seed);
    }

    function addImage(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                media.push({ kind: 'image', el: img, name: file.name });
                resolve();
            };
            img.onerror = () => resolve();
            img.src = URL.createObjectURL(file);
        });
    }

    function addVideo(file) {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(file);
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.autoplay = true;
        v.play().catch(() => { /* autoplay blocked until a click */ });
        media.push({ kind: 'video', el: v, name: file.name });
    }

    function clearMedia() {
        for (const m of media) {
            if (m.el.src && m.el.src.startsWith('blob:')) URL.revokeObjectURL(m.el.src);
            if (m.kind === 'video') { m.el.pause(); m.el.src = ''; }
        }
        media.length = 0;
        renderMediaLibrary();
        reseed(state.seed);
    }

    function renderMediaLibrary() {
        const host = el('media-library');
        if (!host) return;
        host.innerHTML = '';
        if (!media.length) {
            host.innerHTML = '<p class="hint">Drop images or video onto the stage — they fill leftover blocks, crushed into the palette.</p>';
            return;
        }
        media.forEach((m, i) => {
            const wrap = document.createElement('button');
            wrap.className = 'media-thumb';
            wrap.title = `${m.name} — click to remove`;
            if (m.kind === 'image') {
                const img = document.createElement('img');
                img.src = m.el.src;
                wrap.appendChild(img);
            } else {
                wrap.textContent = 'VID';
            }
            wrap.addEventListener('click', () => {
                if (m.el.src && m.el.src.startsWith('blob:')) URL.revokeObjectURL(m.el.src);
                if (m.kind === 'video') { m.el.pause(); m.el.src = ''; }
                media.splice(i, 1);
                renderMediaLibrary();
                reseed(state.seed);
            });
            host.appendChild(wrap);
        });
    }

    // ─── Export hooks used by the site shell ───────────────────────────────

    window.exportPagePNG = function () {
        const w = canvas.width, h = canvas.height;
        setCanvasSize(out.w, out.h);
        render();
        const url = canvas.toDataURL('image/png');
        setCanvasSize(w, h);
        return url;
    };

    window.prepareCanvasVideoExport = function () {
        setCanvasSize(out.w, out.h);
        return canvas;
    };

    // ─── Boot ──────────────────────────────────────────────────────────────

    function init() {
        scheme = SCHEMES[state.scheme];
        paper = scheme.paper;
        inkColor = scheme.ink;

        if (!IS_OUTPUT && !IS_PREVIEW) {
            buildRoutes();
            buildSchemes();
            wireUI();
            renderLibrary();
            bindDrawing();
            bindDrops();
            bindKeys();
            renderSlots();
            renderMediaLibrary();
            setTrainingReadout();
            setAudioNote('Not listening yet — the clock free-runs at 120 BPM until you enable input.');
        }
        bindBus();
        observeStage();

        // Preview cards want something composed, not something mid-performance.
        if (IS_PREVIEW) {
            state.routes.cut = 0;
            state.routes.blow = 0;
            state.density = 0.5;
        }

        reseed(state.seed);
        fitStage();
        requestAnimationFrame(frame);
        window.addEventListener('resize', fitStage);
        document.addEventListener('fullscreenchange', fitStage);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
