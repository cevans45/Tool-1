/*
 * RITE — audio analysis.
 *
 * Everything the composition engine reacts to comes out of here, and nothing in here
 * knows what a composition is. The engine asks four questions each frame:
 *
 *   How loud is each band right now?        bands.bass / lowMid / mid / high
 *   Did a band just get hit?                onsets.*  — a spike that decays, not a level
 *   Where are we in the bar?                bpm, beatPhase, beatIndex, barIndex
 *   Did the music change shape?             events.break / drop / newSound
 *
 * Levels alone make everything pulse at once, which reads as mush on a big screen.
 * The onsets and the beat clock are what let the visual *cut*, which is the whole point.
 */
(function () {
    'use strict';

    const BANDS = [
        { key: 'bass', lo: 20, hi: 140 },
        { key: 'lowMid', lo: 140, hi: 500 },
        { key: 'mid', lo: 500, hi: 2600 },
        { key: 'high', lo: 2600, hi: 14000 },
    ];

    const FFT = 2048;
    const ENV_RATE = 100;       // onset envelope is resampled to a fixed rate so it can be
    const ENV_LEN = 600;        // autocorrelated — 6 seconds of history
    const BPM_MIN = 70;
    const BPM_MAX = 180;
    const SHAPE_BINS = 20;      // coarse spectrum used for "is this a different sound"

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

    // One-pole smoothers. tau is in seconds, so behaviour is frame-rate independent.
    function lerpTo(cur, target, tau, dt) {
        if (tau <= 0) return target;
        return cur + (target - cur) * (1 - Math.exp(-dt / tau));
    }

    class AudioEngine {
        constructor() {
            this.ctx = null;
            this.analyser = null;
            this.source = null;
            this.spectrum = null;
            this.prevSpectrum = null;
            this.binHz = 0;
            this.ready = false;
            this.sourceKind = 'none';
            this.mediaEl = null;

            this.bands = { bass: 0, lowMid: 0, mid: 0, high: 0 };
            this.raw = { bass: 0, lowMid: 0, mid: 0, high: 0 };
            this.onsets = { bass: 0, lowMid: 0, mid: 0, high: 0 };
            this.level = 0;

            this.bpm = 120;
            this.bpmConfidence = 0;
            this.beatPhase = 0;
            this.beatIndex = 0;
            this.barIndex = 0;
            this.beatsPerBar = 4;

            // Events are latched for exactly one frame; the engine reads then they clear.
            this.events = { beat: false, bar: false, phrase: false, break: false, drop: false, newSound: false };
            this.inBreak = false;

            this._env = new Float32Array(ENV_LEN);
            this._envWrite = 0;
            this._envTime = 0;
            this._bpmTimer = 0;

            this._bandSlow = { bass: 0, lowMid: 0, mid: 0, high: 0 };
            this._bandFast = { bass: 0, lowMid: 0, mid: 0, high: 0 };
            this._shape = new Float32Array(SHAPE_BINS);
            this._shapeAvg = new Float32Array(SHAPE_BINS);
            this._shapeWarm = 0;
            this._breakHold = 0;
            this._breakCooldown = 0;
            this._dropCooldown = 0;
            this._soundCooldown = 0;
        }

        // ─── Sources ───────────────────────────────────────────────────────

        _ensureContext() {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AC();
                this.analyser = this.ctx.createAnalyser();
                this.analyser.fftSize = FFT;
                this.analyser.smoothingTimeConstant = 0.45;
                this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
                this.prevSpectrum = new Float32Array(this.analyser.frequencyBinCount);
                this.binHz = this.ctx.sampleRate / FFT;
                for (const b of BANDS) {
                    b.i0 = Math.max(1, Math.floor(b.lo / this.binHz));
                    b.i1 = Math.min(this.analyser.frequencyBinCount - 1, Math.ceil(b.hi / this.binHz));
                }
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return this.ctx;
        }

        _connect(node, kind) {
            this._ensureContext();
            if (this.source) { try { this.source.disconnect(); } catch (e) { /* already gone */ } }
            this.source = node;
            node.connect(this.analyser);
            this.sourceKind = kind;
            this.ready = true;
        }

        async useMicrophone() {
            // Line-in from an interface shows up as a normal input device, so this covers
            // both "mic in the room" and "feed from the desk".
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Audio input needs a secure context — serve the folder over http://localhost rather than opening the file directly.');
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            });
            this._ensureContext();
            this._connect(this.ctx.createMediaStreamSource(stream), 'input');
        }

        useFile(file) {
            this._ensureContext();
            if (this.mediaEl) { this.mediaEl.pause(); this.mediaEl.src = ''; }
            const el = new Audio();
            el.src = URL.createObjectURL(file);
            el.loop = true;
            el.crossOrigin = 'anonymous';
            this.mediaEl = el;
            const node = this.ctx.createMediaElementSource(el);
            node.connect(this.ctx.destination);   // so you can hear what you are cueing
            this._connect(node, 'file');
            return el.play();
        }

        stop() {
            if (this.mediaEl) { this.mediaEl.pause(); }
            if (this.source) { try { this.source.disconnect(); } catch (e) { /* already gone */ } }
            this.source = null;
            this.ready = false;
            this.sourceKind = 'none';
        }

        // ─── Per-frame analysis ────────────────────────────────────────────

        // `free` ignores whatever is connected and runs the internal clock instead, so a
        // look can be set against a steady pulse without unplugging anything.
        update(dt, free) {
            const ev = this.events;
            ev.beat = ev.bar = ev.phrase = ev.break = ev.drop = ev.newSound = false;
            dt = clamp(dt, 0.001, 0.1);

            if (!this.ready || free) { this._freeRun(dt); return; }

            this.analyser.getFloatFrequencyData(this.spectrum);
            const spec = this.spectrum;
            const prev = this.prevSpectrum;
            const n = spec.length;

            let total = 0;
            let fluxAll = 0;

            for (const b of BANDS) {
                let sum = 0;
                let flux = 0;
                for (let i = b.i0; i <= b.i1; i++) {
                    // dB to a 0..1 ramp. -90 is silence, -20 is loud; music mostly lives between.
                    const v = clamp((spec[i] + 90) / 70, 0, 1);
                    const p = clamp((prev[i] + 90) / 70, 0, 1);
                    sum += v;
                    if (v > p) flux += v - p;
                }
                const count = b.i1 - b.i0 + 1;
                const lvl = sum / count;
                this.raw[b.key] = lvl;
                total += lvl;
                fluxAll += flux;

                this.bands[b.key] = lerpTo(this.bands[b.key], lvl, 0.045, dt);

                // An onset is flux measured against that band's own recent flux, so a quiet
                // hi-hat pattern still registers next to a loud kick.
                const fastTau = 0.12, slowTau = 1.6;
                this._bandFast[b.key] = lerpTo(this._bandFast[b.key], flux, fastTau, dt);
                this._bandSlow[b.key] = lerpTo(this._bandSlow[b.key], flux, slowTau, dt);
                const excess = this._bandFast[b.key] - this._bandSlow[b.key] * 1.35;
                const hit = clamp(excess / Math.max(0.12, this._bandSlow[b.key] * 2), 0, 1);
                this.onsets[b.key] = Math.max(hit, this.onsets[b.key] - dt * 6);
            }

            this.level = lerpTo(this.level, total / BANDS.length, 0.08, dt);
            prev.set(spec);

            this._pushEnvelope(fluxAll, dt);
            this._trackTempo(dt);
            this._trackSections(spec, n, dt);
        }

        // With no audio connected the clock still runs, so the tool is usable for
        // setting a look before anyone plugs anything in.
        _freeRun(dt) {
            const period = 60 / this.bpm;
            this.beatPhase += dt / period;
            while (this.beatPhase >= 1) { this.beatPhase -= 1; this._advanceBeat(); }
            // Shaped like a real band envelope rather than held high, so an idle tool
            // sits still between beats instead of drifting constantly.
            const pulse = Math.pow(1 - this.beatPhase, 3);
            for (const b of BANDS) {
                this.bands[b.key] = 0.1 + pulse * 0.45;
                this.onsets[b.key] = this.events.beat ? 1 : Math.max(0, this.onsets[b.key] - dt * 6);
            }
            this.level = 0.4;
            this.bpmConfidence = 0;
        }

        // Resamples by rate rather than by accumulation. Dumping a whole frame's flux
        // into one 10 ms slot and zeroing the rest stamps the display's refresh rate
        // onto the envelope, which then shows up in the autocorrelation as a tempo.
        _pushEnvelope(flux, dt) {
            const step = 1 / ENV_RATE;
            this._envRate = flux / dt;
            this._envTime += dt;
            let guard = 32;
            while (this._envTime >= step && guard-- > 0) {
                this._envTime -= step;
                this._env[this._envWrite] = this._envRate * step;
                this._envWrite = (this._envWrite + 1) % ENV_LEN;
            }
        }

        _envAt(i) {
            return this._env[(this._envWrite + i) % ENV_LEN];
        }

        _trackTempo(dt) {
            this._bpmTimer -= dt;
            if (this._bpmTimer <= 0) {
                this._bpmTimer = 0.5;
                this._estimateBpm();
            }

            const period = 60 / this.bpm;
            this.beatPhase += dt / period;
            while (this.beatPhase >= 1) { this.beatPhase -= 1; this._advanceBeat(); }

            // Phase-locked loop: a strong broadband hit nudges the clock toward itself
            // instead of restarting it, so one stray transient cannot derail the grid.
            const hit = Math.max(this.onsets.bass, this.onsets.lowMid * 0.6);
            if (hit > 0.55) {
                const err = this.beatPhase > 0.5 ? this.beatPhase - 1 : this.beatPhase;
                this.beatPhase -= err * 0.16 * hit;
                if (this.beatPhase < 0) { this.beatPhase += 1; }
            }
        }

        _advanceBeat() {
            this.events.beat = true;
            this.beatIndex++;
            if (this.beatIndex % this.beatsPerBar === 0) {
                this.events.bar = true;
                this.barIndex++;
                if (this.barIndex % 8 === 0) this.events.phrase = true;
            }
        }

        _estimateBpm() {
            // Mean-remove so autocorrelation measures periodicity rather than loudness.
            let mean = 0;
            for (let i = 0; i < ENV_LEN; i++) mean += this._env[i];
            mean /= ENV_LEN;

            let energy = 0;
            for (let i = 0; i < ENV_LEN; i++) {
                const v = this._env[i] - mean;
                energy += v * v;
            }
            if (energy < 1e-4) { this.bpmConfidence = 0; return; }

            const lagMin = Math.floor(ENV_RATE * 60 / BPM_MAX);
            const lagMax = Math.ceil(ENV_RATE * 60 / BPM_MIN);
            let best = -1, bestLag = lagMin, prevScore = 0, prevPrev = 0;
            let bestPrev = 0, bestNext = 0;

            for (let lag = lagMin; lag <= lagMax; lag++) {
                let acc = 0;
                for (let i = lag; i < ENV_LEN; i++) {
                    acc += (this._envAt(i) - mean) * (this._envAt(i - lag) - mean);
                }
                acc /= (ENV_LEN - lag);

                // Tempo octave errors are the usual failure. A log-normal prior centred on
                // 125 BPM biases toward the tempo a person would tap, not half or double it.
                const bpm = 60 * ENV_RATE / lag;
                const w = Math.exp(-Math.pow(Math.log(bpm / 125) / 0.52, 2) * 0.5);
                const score = acc * w;

                if (score > best) { best = score; bestLag = lag; bestPrev = prevScore; bestNext = 0; }
                else if (lag === bestLag + 1) bestNext = score;
                prevPrev = prevScore;
                prevScore = score;
            }

            // Parabolic interpolation: the lag grid is ~5 BPM wide at the fast end.
            let lag = bestLag;
            const denom = bestPrev - 2 * best + bestNext;
            if (Math.abs(denom) > 1e-9) lag += 0.5 * (bestPrev - bestNext) / denom;

            const bpm = clamp(60 * ENV_RATE / lag, BPM_MIN, BPM_MAX);
            const conf = clamp(best / (energy / ENV_LEN) * 2.2, 0, 1);
            this.bpmConfidence = conf;
            if (conf > 0.18) {
                // Ease rather than jump, so a momentary mis-read does not jolt the grid.
                const near = Math.abs(bpm - this.bpm) < 6;
                this.bpm += (bpm - this.bpm) * (near ? 0.3 : 0.12);
            }
        }

        _trackSections(spec, n, dt) {
            this._breakCooldown = Math.max(0, this._breakCooldown - dt);
            this._dropCooldown = Math.max(0, this._dropCooldown - dt);
            this._soundCooldown = Math.max(0, this._soundCooldown - dt);

            // Break: bass falls well below its own running average while the track keeps
            // playing. Checking against silence as well stops a gap between songs firing it.
            const bassLong = this._bassLong = lerpTo(this._bassLong || this.raw.bass, this.raw.bass, 12, dt);
            const bassShort = this._bassShort = lerpTo(this._bassShort || this.raw.bass, this.raw.bass, 0.6, dt);
            const stripped = bassShort < bassLong * 0.55 && this.level > 0.06;

            if (stripped) this._breakHold += dt; else this._breakHold = Math.max(0, this._breakHold - dt * 2);

            if (!this.inBreak && this._breakHold > 0.9 && this._breakCooldown === 0) {
                this.inBreak = true;
                this.events.break = true;
                this._breakCooldown = 4;
            } else if (this.inBreak && this._breakHold === 0) {
                this.inBreak = false;
                // Bass slamming back in after a break is a drop, by definition.
                if (bassShort > bassLong * 0.95 && this._dropCooldown === 0) {
                    this.events.drop = true;
                    this._dropCooldown = 6;
                }
            }

            // A drop can also happen without a break — every band spiking at once.
            const broad = this.onsets.bass > 0.75 && this.onsets.mid > 0.6 && this.onsets.high > 0.5;
            if (broad && this._dropCooldown === 0) {
                this.events.drop = true;
                this._dropCooldown = 6;
            }

            // New sound: the shape of the spectrum moved, not its loudness. Normalising
            // each frame before comparing is what makes this ignore volume changes.
            const per = Math.floor(n / SHAPE_BINS);
            let norm = 0;
            for (let b = 0; b < SHAPE_BINS; b++) {
                let s = 0;
                for (let i = b * per; i < (b + 1) * per; i++) s += clamp((spec[i] + 90) / 70, 0, 1);
                this._shape[b] = s / per;
                norm += this._shape[b] * this._shape[b];
            }
            norm = Math.sqrt(norm) || 1;

            let dot = 0, avgNorm = 0;
            for (let b = 0; b < SHAPE_BINS; b++) {
                this._shape[b] /= norm;
                dot += this._shape[b] * this._shapeAvg[b];
                avgNorm += this._shapeAvg[b] * this._shapeAvg[b];
            }
            avgNorm = Math.sqrt(avgNorm) || 1;
            const similarity = dot / avgNorm;

            if (this._shapeWarm > 2.5 && similarity < 0.955 && this._soundCooldown === 0) {
                this.events.newSound = true;
                this._soundCooldown = 2.5;
            }
            this._shapeWarm += dt;
            for (let b = 0; b < SHAPE_BINS; b++) {
                this._shapeAvg[b] = lerpTo(this._shapeAvg[b], this._shape[b], 1.8, dt);
            }
        }
    }

    window.RiteAudio = { AudioEngine, BANDS };
})();
