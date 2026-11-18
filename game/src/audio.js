// All sound is synthesised with WebAudio: no audio files ship with the game.
// The context is created on the first gesture only, and every call no-ops safely before then.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.started = false;
    this.engine = null;
    this.siren = null;
    this.music = null;
    this.engineLevel = 0;
    this.sirenLevel = 0;
    this.wanted = 0;
    this._nextHat = 0;
  }

  init() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch {
      this.ctx = null;
      return;
    }
    this.started = true;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    this._buildEngine();
    this._buildSiren();
    this._buildMusic();
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  get ready() {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  _buildEngine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 4;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 60;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    saw.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(out);
    out.connect(this.master);
    saw.start();
    sub.start();
    this.engine = { out, filter, saw, sub };
  }

  _buildSiren() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 640;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 820;
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    osc.connect(out);
    osc2.connect(g2);
    g2.connect(out);
    out.connect(this.master);
    osc.start();
    osc2.start();
    this.siren = { out, osc, osc2 };
  }

  _buildMusic() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.16;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const bass = ctx.createOscillator();
    bass.type = 'sawtooth';
    bass.frequency.value = 55;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.35;
    bass.connect(bassGain);
    bassGain.connect(filter);
    filter.connect(out);
    out.connect(this.master);
    bass.start();
    this.music = { out, filter, bass, hatBuffer: this._noiseBuffer(0.06) };
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    if (!ctx) return null;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Engine hum tracks speed and throttle; 0 to 1.
  setEngine(speedRatio, throttle, on) {
    if (!this.engine || !this.ctx) return;
    const t = this._now();
    const target = on ? 0.06 + 0.1 * Math.min(1, speedRatio) : 0;
    const g = this.engine.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(target, t, 0.08);
    const freq = 48 + speedRatio * 130 + throttle * 26;
    this.engine.saw.frequency.setTargetAtTime(freq, t, 0.09);
    this.engine.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.09);
    this.engine.filter.frequency.setTargetAtTime(340 + speedRatio * 900 + throttle * 400, t, 0.1);
  }

  setSiren(volume, near) {
    if (!this.siren || !this.ctx) return;
    const t = this._now();
    const g = this.siren.out.gain;
    g.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.16, t, 0.15);
    const base = near ? 700 : 560;
    const wob = Math.sin(t * 5.5) * 0.5 + 0.5;
    this.siren.osc.frequency.setTargetAtTime(base + wob * 260, t, 0.06);
    this.siren.osc2.frequency.setTargetAtTime(base * 1.28 + wob * 320, t, 0.06);
  }

  setMusic(wanted) {
    if (!this.music || !this.ctx) return;
    const t = this._now();
    this.wanted = wanted;
    const speed = 1 + Math.min(4, wanted) * 0.42;
    const beat = 0.9 / speed;
    if (t >= this._nextHat) {
      this._nextHat = t + beat;
      this._hat();
      this.music.bass.frequency.setTargetAtTime(48 + Math.min(4, wanted) * 6 + (Math.random() < 0.3 ? 12 : 0), t, 0.05);
      this.music.filter.frequency.setTargetAtTime(180 + Math.min(4, wanted) * 90, t, 0.2);
    }
  }

  _hat() {
    const ctx = this.ctx;
    if (!ctx || !this.music || !this.music.hatBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.music.hatBuffer;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 5200;
    g.gain.value = 0.1;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  _blip(freq, when, dur, type, gain) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this._now() + when;
    const osc = ctx.createOscillator();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  gunshot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this._now();
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  punch() {
    this._blip(140, 0, 0.12, 'square', 0.22);
  }

  crash(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this._now();
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + 900 * Math.min(1.5, strength);
    const g = ctx.createGain();
    const amp = Math.min(0.6, 0.14 + 0.34 * strength);
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  pickup() {
    this._blip(720, 0, 0.1, 'triangle', 0.22);
    this._blip(1040, 0.09, 0.14, 'triangle', 0.2);
  }

  missionComplete() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => this._blip(n, i * 0.11, 0.24, 'triangle', 0.2));
  }

  wantedUp() {
    this._blip(120, 0, 0.16, 'sawtooth', 0.2);
    this._blip(96, 0.14, 0.2, 'sawtooth', 0.18);
  }

  busted() {
    const notes = [440, 349, 262, 196];
    notes.forEach((n, i) => this._blip(n, i * 0.14, 0.26, 'triangle', 0.2));
  }

  horn() {
    this._blip(330, 0, 0.32, 'square', 0.12);
    this._blip(392, 0, 0.32, 'square', 0.1);
  }

  reloadClick() {
    this._blip(500, 0, 0.05, 'square', 0.1);
  }
}
