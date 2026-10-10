/*
 * RITE — ink.
 *
 * The stroke engine from the Sigil tool, pulled out so it can draw into an arbitrary
 * rectangle instead of owning the whole canvas. Two changes matter here:
 *
 *   Paths are stored normalised to their own bounding box, so one sigil can be placed
 *   into a tall cell, a wide cell or a 1536×256 LED strip and still read.
 *
 *   drawRange() draws a slice of a path rather than all of it, which is what lets a
 *   cell add a few strokes per beat onto a canvas it keeps between frames. Redrawing
 *   the whole sigil every beat would cost the same as drawing it once per frame.
 */
(function () {
    'use strict';

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

    function makeRng(seed) {
        let s = (seed >>> 0) || 1;
        return () => {
            s ^= s << 13; s >>>= 0;
            s ^= s >> 17;
            s ^= s << 5; s >>>= 0;
            return s / 4294967296;
        };
    }

    // Character of the mark. These are the numbers that make it look drawn rather
    // than plotted — overlapping passes, jitter proportional to thickness, dropouts.
    const CFG = { connect: 70, jitterBase: 4, jitterMul: 0.8, passes: 6, holeChance: 0.15 };
    const MYC = { passMul: 1.38, jitterMul: 1.55, holeMul: 0.68, distPlus: 0.26 };
    const REF = 1000;       // canvas size the numbers above were tuned against

    const MARKERS = ['line', 'grain', 'dash', 'hatch', 'grid', 'sprinkle', 'inkblot', 'none'];

    // ─── Paths ─────────────────────────────────────────────────────────────
    // A path is a flat array of { x, y } in 0..1 with null entries marking pen-up.
    // Each point also carries t (0..1 along the whole path) for reveal, and a seed so
    // replaying a stroke reproduces exactly the jitter it had when it was drawn.

    function normalise(raw) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of raw) {
            if (!p) continue;
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        if (!isFinite(minX)) return null;

        const w = Math.max(1e-6, maxX - minX);
        const h = Math.max(1e-6, maxY - minY);
        const pts = raw.map((p) => (p ? {
            x: (p.x - minX) / w,
            y: (p.y - minY) / h,
            seed: p.seed != null ? p.seed : ((Math.random() * 0xFFFFFFFF) >>> 0),
            marker: p.marker,
        } : null));

        // t is measured in the normalised square, so reveal speed does not depend on
        // how big the sigil happened to be when it was drawn.
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            if (a && b) total += Math.hypot(b.x - a.x, b.y - a.y);
        }
        let run = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = i > 0 ? pts[i - 1] : null;
            const b = pts[i];
            if (a && b) run += Math.hypot(b.x - a.x, b.y - a.y);
            if (b) b.t = total > 0 ? run / total : 0;
        }

        return { points: pts, aspect: w / h, length: total };
    }

    // A drunk walk with occasional pen-ups. Density trades many short steps for a few
    // long ones, which is the difference between a knot and a rune.
    function generate(seed, density) {
        const rng = makeRng(seed * 2654435761);
        const d = clamp(density, 0, 1);
        // Short steps relative to the box: the stroke engine reads the gap between
        // points as pressure, so long steps come out thin and lifeless.
        const steps = Math.round(70 + d * 420);
        const stepLen = 0.048 - d * 0.03;
        const penUp = 0.09 - d * 0.065;
        const turn = 0.8 + d * 1.1;
        const m = 0.04;

        const pts = [];
        let x = m + rng() * (1 - m * 2);
        let y = m + rng() * (1 - m * 2);
        let angle = rng() * Math.PI * 2;
        pts.push({ x, y, seed: (rng() * 0xFFFFFFFF) >>> 0 });

        for (let i = 0; i < steps; i++) {
            if (rng() < penUp) {
                pts.push(null);
                x = m + rng() * (1 - m * 2);
                y = m + rng() * (1 - m * 2);
                angle = rng() * Math.PI * 2;
                pts.push({ x, y, seed: (rng() * 0xFFFFFFFF) >>> 0 });
                continue;
            }
            angle += (rng() - 0.5) * turn;
            const len = stepLen * (0.5 + rng());
            x = clamp(x + Math.cos(angle) * len, m, 1 - m);
            y = clamp(y + Math.sin(angle) * len, m, 1 - m);
            pts.push({ x, y, seed: (rng() * 0xFFFFFFFF) >>> 0 });
        }
        return normalise(pts);
    }

    // ─── Ink ───────────────────────────────────────────────────────────────

    class Ink {
        constructor() {
            this.rnd = Math.random;
        }

        /*
         * Draws path segments with index in [i0, i1) into the rect `box`.
         *
         * opts:
         *   brush    stroke weight in px before distance/speed modulation
         *   marker   one of MARKERS
         *   color    fill and stroke colour
         *   mirrorX  mirror about the box's vertical centre line
         *   mirrorY  mirror about the box's horizontal centre line
         *   warp     optional (nx, ny, t) => [dx, dy] in px, applied after mapping
         */
        drawRange(ctx, path, box, i0, i1, opts) {
            const pts = path.points;
            if (!pts || i1 <= i0) return;

            const o = opts || {};
            this._box = box;
            this._mirrorX = !!o.mirrorX;
            this._mirrorY = !!o.mirrorY;
            this._warp = o.warp || null;

            // Contain-fit keeps a wide sigil wide. Cells are often extreme in RITE, and
            // stretching to fill turns every sigil into the same smear.
            const fit = Math.min(box.w, box.h * path.aspect);
            this._sx = fit;
            this._sy = fit / path.aspect;
            this._ox = box.x + (box.w - this._sx) * 0.5;
            this._oy = box.y + (box.h - this._sy) * 0.5;

            // The stroke engine was tuned against a roughly 1000px canvas. K restates the
            // cell in those units so every px constant below — jitter, dot spacing, the
            // distance at which a stroke swells — keeps its proportion in a small block.
            const K = Math.max(0.05, Math.min(this._sx, this._sy) / REF);
            this._K = K;
            this._brush = Math.max(0.35, (o.brush != null ? o.brush : 3) * K);
            this._marker = o.marker || 'line';
            this._taper = !!o.taper;

            ctx.save();
            ctx.strokeStyle = o.color || '#000';
            ctx.fillStyle = o.color || '#000';
            ctx.lineCap = this._taper ? 'round' : 'square';
            ctx.lineJoin = 'bevel';
            if (o.alpha != null) ctx.globalAlpha = o.alpha;

            const lo = Math.max(1, i0);
            const hi = Math.min(pts.length, i1);
            for (let i = lo; i < hi; i++) {
                const a = pts[i - 1], b = pts[i];
                if (!a || !b) continue;
                const p1 = this._map(a);
                const p2 = this._map(b);
                const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
                if (dist < 0.01) continue;
                this._seeded(b.seed, b.marker, () => {
                    this._scratch(ctx, p1[0], p1[1], p2[0], p2[1], dist, b.t || 0);
                });
            }
            ctx.restore();
        }

        draw(ctx, path, box, opts) {
            this.drawRange(ctx, path, box, 0, path.points.length, opts);
        }

        // How many points of `path` fall within a reveal fraction. The engine uses this
        // to work out which slice to add on each beat.
        static indexAt(path, reveal) {
            const pts = path.points;
            const r = clamp(reveal, 0, 1);
            if (r >= 1) return pts.length;
            let lo = 0, hi = pts.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                const p = pts[mid];
                const t = p ? p.t : (pts[mid - 1] ? pts[mid - 1].t : 0);
                if (t < r) lo = mid + 1; else hi = mid;
            }
            return lo;
        }

        _map(p) {
            let x = this._ox + p.x * this._sx;
            let y = this._oy + p.y * this._sy;
            if (this._warp) {
                const d = this._warp(p.x, p.y, p.t || 0);
                x += d[0];
                y += d[1];
            }
            return [x, y];
        }

        // Each stamped point temporarily swaps in its own generator so the same point
        // always produces the same speckle, however many times it gets redrawn.
        _seeded(seed, marker, fn) {
            const real = this.rnd;
            let s = (seed >>> 0) || 1;
            this.rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
            const prevMarker = this._marker;
            if (marker) this._marker = marker;
            try { fn(); } finally { this.rnd = real; this._marker = prevMarker; }
        }

        _mirrorPts(x, y) {
            const b = this._box;
            const o = [{ x, y }];
            if (this._mirrorX) o.push({ x: b.x * 2 + b.w - x, y });
            if (this._mirrorY) o.push({ x, y: b.y * 2 + b.h - y });
            if (this._mirrorX && this._mirrorY) o.push({ x: b.x * 2 + b.w - x, y: b.y * 2 + b.h - y });
            return o;
        }

        _mirrorLines(x1, y1, x2, y2) {
            const b = this._box;
            const fx = b.x * 2 + b.w;
            const fy = b.y * 2 + b.h;
            const o = [{ x1, y1, x2, y2 }];
            if (this._mirrorX) o.push({ x1: fx - x1, y1, x2: fx - x2, y2 });
            if (this._mirrorY) o.push({ x1, y1: fy - y1, x2, y2: fy - y2 });
            if (this._mirrorX && this._mirrorY) o.push({ x1: fx - x1, y1: fy - y1, x2: fx - x2, y2: fy - y2 });
            return o;
        }

        _taperAt(t) {
            if (!this._taper) return 1;
            // Measured on the whole path rather than the segment, so a stroke thins at
            // its real ends instead of at every segment boundary.
            const e = 0.12;
            if (t < e) return 0.08 + 0.92 * Math.pow(t / e, 0.6);
            if (t > 1 - e) return 0.08 + 0.92 * Math.pow((1 - t) / e, 0.6);
            return 1;
        }

        _scratch(ctx, x1, y1, x2, y2, dist, t) {
            const R = () => this.rnd();
            const K = this._K;
            const brush = this._brush;
            // The original engine swelled a stroke where points bunched up, measured in
            // pixels on a full-frame canvas. Measuring the gap in K units instead keeps
            // that feel identical whether the sigil fills the screen or a small block.
            // The cap matters here: cells can be tiny, and uncapped this turns to a blot.
            const distFactor = clamp((CFG.connect - dist / K) / 10 + MYC.distPlus, 0.35, 6);
            const thickness = brush * distFactor;
            const baseJitter = CFG.jitterBase * K + thickness * CFG.jitterMul;

            const dx = x2 - x1;
            const dy = y2 - y1;
            const segLen = Math.hypot(dx, dy) || 1;
            const dir = Math.atan2(dy, dx);
            const bias = 0.85 + Math.abs(Math.sin(dir * 1.7)) * 0.55;
            const passes = Math.max(2, Math.round(CFG.passes * bias * MYC.passMul));
            const jitter = baseJitter * (0.9 + (bias - 0.85) * 0.35) * MYC.jitterMul;
            const hole = clamp(CFG.holeChance * MYC.holeMul, 0, 0.5);
            const tw = this._taperAt(t);

            const dot = (x, y, r) => {
                for (const p of this._mirrorPts(x, y)) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            };
            const line = (ax, ay, bx, by, w) => {
                ctx.lineWidth = Math.max(0.15, w);
                ctx.beginPath();
                for (const l of this._mirrorLines(ax, ay, bx, by)) {
                    ctx.moveTo(l.x1, l.y1);
                    ctx.lineTo(l.x2, l.y2);
                }
                ctx.stroke();
            };

            switch (this._marker) {
                case 'none': {
                    const n = Math.max(2, Math.floor(segLen / (3 * K)));
                    for (let s = 0; s <= n; s++) {
                        const u = n <= 1 ? 0.5 : s / n;
                        dot(x1 + dx * u, y1 + dy * u, Math.max(0.5, thickness * 0.5 * tw));
                    }
                    break;
                }
                case 'sprinkle': {
                    const n = Math.max(2, Math.floor(segLen / (14 * K)));
                    for (let i = 0; i < passes; i++) {
                        for (let d = 0; d < n; d++) {
                            if (R() < hole) continue;
                            const u = R();
                            const ns = jitter * 0.7;
                            dot(x1 + dx * u + (R() - 0.5) * ns, y1 + dy * u + (R() - 0.5) * ns,
                                Math.max(0.8, thickness * (0.18 + R() * 0.45)) * 0.5 * tw);
                        }
                    }
                    break;
                }
                case 'grain': {
                    const nx = -dy / segLen, ny = dx / segLen;
                    const n = Math.max(12, Math.floor(segLen / (6 * K)));
                    for (let pass = 0; pass < passes; pass++) {
                        for (let d = 0; d < n; d++) {
                            if (R() < hole * 0.55) continue;
                            const u = R();
                            const along = (R() - 0.5) * jitter * 0.55;
                            const norm = (R() - 0.5) * jitter * 1.1;
                            dot(x1 + dx * u + along + nx * norm, y1 + dy * u + along + ny * norm,
                                Math.max(0.6, thickness * (0.08 + R() * 0.18)) * 0.5 * tw);
                        }
                    }
                    break;
                }
                case 'inkblot': {
                    const nx = -dy / segLen, ny = dx / segLen;
                    const n = Math.max(6, Math.floor(segLen / (5 * K)));
                    const base = Math.max(0.7, thickness * 0.32);
                    for (let pass = 0; pass < Math.max(2, Math.floor(passes * 0.65)); pass++) {
                        for (let s = 0; s < n; s++) {
                            if (R() < hole * 0.45) continue;
                            const u = n <= 1 ? 0.5 : s / (n - 1);
                            const px = x1 + dx * u + (R() - 0.5) * jitter * 0.45 + nx * (R() - 0.5) * jitter * 1.05;
                            const py = y1 + dy * u + (R() - 0.5) * jitter * 0.45 + ny * (R() - 0.5) * jitter * 1.05;
                            const r = base * (0.55 + R() * 1.1) * tw;
                            dot(px, py, r);
                            const sat = 1 + Math.floor(R() * 2);
                            for (let k = 0; k < sat; k++) {
                                if (R() < 0.35) continue;
                                const off = r * (0.6 + R() * 1.1);
                                const ang = R() * Math.PI * 2;
                                dot(px + Math.cos(ang) * off, py + Math.sin(ang) * off,
                                    Math.max(0.35, r * (0.16 + R() * 0.22)) * tw);
                            }
                        }
                    }
                    break;
                }
                case 'grid': {
                    const g = Math.max(3 * K, brush * 1.2);
                    const step = Math.max(2 * K, g * 0.5);
                    const n = Math.max(2, Math.floor(segLen / step));
                    for (let pass = 0; pass < passes; pass++) {
                        for (let i = 0; i < n; i++) {
                            if (R() < hole * 0.8) continue;
                            const u = n <= 1 ? 0.5 : i / (n - 1);
                            const px = x1 + dx * u + (R() - 0.5) * jitter * 0.9;
                            const py = y1 + dy * u + (R() - 0.5) * jitter * 0.9;
                            const gx = Math.round(px / g) * g;
                            const gy = Math.round(py / g) * g;
                            const s = Math.max(0.9, thickness * (0.35 + R() * 0.35)) * tw;
                            for (const p of this._mirrorPts(gx, gy)) ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
                        }
                    }
                    break;
                }
                case 'hatch': {
                    const nx = -dy / segLen, ny = dx / segLen;
                    const n = Math.max(3, Math.floor(segLen / (18 * K)));
                    const hl = thickness * 2.2;
                    for (let pass = 0; pass < passes; pass++) {
                        for (let s = 0; s < n; s++) {
                            if (R() < 0.1) continue;
                            const u = s / Math.max(1, n - 1);
                            const px = x1 + dx * u + (R() - 0.5) * jitter;
                            const py = y1 + dy * u + (R() - 0.5) * jitter;
                            const len = hl * (0.7 + R() * 0.8);
                            line(px - nx * len * 0.5, py - ny * len * 0.5,
                                px + nx * len * 0.5, py + ny * len * 0.5, thickness * 0.9 * tw);
                        }
                    }
                    break;
                }
                case 'dash': {
                    const n = Math.max(3, Math.floor(segLen / (10 * K)));
                    for (let pass = 0; pass < passes; pass++) {
                        for (let k = 0; k < n; k++) {
                            if (R() < 0.25) continue;
                            const uA = k / n, uB = (k + 1) / n;
                            line(x1 + dx * uA + (R() - 0.5) * jitter, y1 + dy * uA + (R() - 0.5) * jitter,
                                x1 + dx * uB + (R() - 0.5) * jitter, y1 + dy * uB + (R() - 0.5) * jitter,
                                thickness * tw);
                        }
                    }
                    break;
                }
                default: {
                    for (let i = 0; i < passes; i++) {
                        if (R() <= hole) continue;
                        line(x1 + (R() - 0.5) * jitter, y1 + (R() - 0.5) * jitter,
                            x2 + (R() - 0.5) * jitter, y2 + (R() - 0.5) * jitter, thickness * tw);
                    }
                }
            }
        }
    }

    window.RiteSigil = { Ink, generate, normalise, indexAt: Ink.indexAt, MARKERS };
})();
