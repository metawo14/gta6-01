// All sound is synthesised with WebAudio: no audio files ship with the game.
// The AudioContext is created on the first key press or click, because browsers block audio
// until a gesture. Every method no-ops safely before the context exists.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engine = null;
    this.siren = null;
    this.music = null;
    this.started = false;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    let ctx;
    try { ctx = new Ctor(); } catch { return; }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.75;
    this.master.connect(ctx.destination);
    this._buildEngine();
    this._buildSiren();
    this._buildMusic();
    this.started = true;
  }

  get ready() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.75, now, 0.05);
    }
    return this.muted;
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  _gain(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // --- continuous beds ---------------------------------------------------

  _buildEngine() {
    const ctx = this.ctx;
    const out = this._gain(0);
    out.connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 4;

    const saw = this._osc('sawtooth', 62);
    const sub = this._osc('sine', 31);
    const sawGain = this._gain(0.5);
    const subGain = this._gain(0.6);

    saw.connect(sawGain).connect(lp);
    sub.connect(subGain).connect(lp);
    lp.connect(out);
    saw.start();
    sub.start();

    this.engine = { out, lp, saw, sub };
  }

  _buildSiren() {
    const ctx = this.ctx;
    const out = this._gain(0);
    out.connect(this.master);
    const hi = this._osc('triangle', 760);
    const lo = this._osc('triangle', 570);
    const g1 = this._gain(0.5);
    const g2 = this._gain(0.5);
    hi.connect(g1).connect(out);
    lo.connect(g2).connect(out);
    hi.start();
    lo.start();
    this.siren = { out, hi, lo };
  }

  _buildMusic() {
    const ctx = this.ctx;
    const out = this._gain(0);
    out.connect(this.master);
    const bass = this._osc('triangle', 55);
    const bassGain = this._gain(0.35);
    bass.connect(bassGain).connect(out);
    bass.start();
    this.music = { out, bass, bassGain, nextBeat: 0, beat: 0 };
  }

  // --- per-frame ---------------------------------------------------------

  updateEngine(speed01, throttle, active) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const target = active ? 0.16 + speed01 * 0.2 : 0;
    this.engine.out.gain.setTargetAtTime(target, t, 0.12);
    this.engine.saw.frequency.setTargetAtTime(58 + speed01 * 118, t, 0.08);
    this.engine.sub.frequency.setTargetAtTime(29 + speed01 * 40, t, 0.08);
    this.engine.lp.frequency.setTargetAtTime(380 + throttle * 900 + speed01 * 700, t, 0.09);
  }

  updateSiren(distance, active) {
    if (!this.ctx || !this.siren) return;
    const t = this.ctx.currentTime;
    const near = Math.max(0, 1 - distance / 190);
    const target = active ? 0.05 + near * 0.14 : 0;
    this.siren.out.gain.setTargetAtTime(target, t, 0.25);
    if (active) {
      const wob = Math.sin(t * 4.2) * 0.5 + 0.5;
      this.siren.hi.frequency.setTargetAtTime(700 + wob * 190, t, 0.05);
      this.siren.lo.frequency.setTargetAtTime(520 + wob * 150, t, 0.05);
    }
  }

  updateMusic(stars, now, paused) {
    if (!this.ctx || !this.music) return;
    const t = this.ctx.currentTime;
    const tempo = 0.42 - stars * 0.035;
    const target = paused ? 0 : 0.1 + stars * 0.02;
    this.music.out.gain.setTargetAtTime(target, t, 0.4);
    if (paused) return;
    if (now >= this.music.nextBeat) {
      this.music.nextBeat = now + tempo;
      const step = this.music.beat % 8;
      const notes = [55, 55, 65.4, 55, 73.4, 55, 61.7, 49];
      this.music.bass.frequency.setValueAtTime(notes[step], t);
      this.music.bassGain.gain.setTargetAtTime(step % 2 === 0 ? 0.4 : 0.2, t, 0.02);
      if (step % 2 === 1) this._hat(t);
      this.music.beat++;
    }
  }

  _hat(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const g = this._gain(0.09);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.06);
  }

  // --- one-shots ---------------------------------------------------------

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;
      data[i] = last * (1 - i / len);
    }
    return buf;
  }

  _blip(freq, at, duration, type = 'square', level = 0.2) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = this._osc(type, freq);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + duration + 0.02);
  }

  gunshot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.16);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.7;
    const g = this._gain(0.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    const o = this._osc('triangle', 230);
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const g2 = this._gain(0.28);
    o.connect(g2).connect(this.master);
    o.start(t);
    o.stop(t + 0.17);
  }

  punch() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this._osc('sine', 150);
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
    const g = this._gain(0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  crash(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + strength * 700;
    const g = this._gain(Math.min(0.6, 0.18 + strength * 0.4));
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._blip(680, t, 0.1, 'square', 0.16);
    this._blip(1020, t + 0.09, 0.16, 'square', 0.16);
  }

  missionComplete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
      this._blip(f, t + i * 0.11, 0.3, 'triangle', 0.2);
    });
  }

  wantedUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._blip(150, t, 0.16, 'sawtooth', 0.18);
    this._blip(118, t + 0.13, 0.22, 'sawtooth', 0.18);
  }

  busted() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [392, 329.6, 261.6, 196].forEach((f, i) => {
      this._blip(f, t + i * 0.16, 0.34, 'triangle', 0.22);
    });
  }

  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._blip(330, t, 0.4, 'sawtooth', 0.12);
    this._blip(415, t, 0.4, 'sawtooth', 0.1);
  }
}
