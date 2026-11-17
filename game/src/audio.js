// All sound is synthesised with WebAudio: no audio files ship with the game.
// Engine hum tracks speed, sirens are two-tone, and a small music loop runs under it all.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
    this.master = null;
    this.engine = null;
    this.siren = null;
    this.musicTimer = 0;
    this.step = 0;
  }

  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const engineGain = this.ctx.createGain();
    engineGain.gain.value = 0;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 700;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const sub = this.ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 42;
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.35;
    osc.connect(engineFilter);
    sub.connect(subGain).connect(engineFilter);
    engineFilter.connect(engineGain).connect(this.master);
    osc.start();
    sub.start();
    this.engine = { osc, sub, gain: engineGain, filter: engineFilter };

    const sirenGain = this.ctx.createGain();
    sirenGain.gain.value = 0;
    sirenGain.connect(this.master);
    const sirenOsc = this.ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 620;
    sirenOsc.connect(sirenGain);
    sirenOsc.start();
    this.siren = { osc: sirenOsc, gain: sirenGain };

    this.started = true;
    this.noiseBuffer = this.makeNoise();
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.94 * last + 0.06 * white;
      data[i] = last * 2.4;
    }
    return buf;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  setEngine(speedRatio, throttle) {
    if (!this.engine) return;
    const target = throttle ? 0.18 : 0.1;
    const freq = 52 + speedRatio * 190;
    this.engine.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.08);
    this.engine.sub.frequency.setTargetAtTime(freq * 0.5, this.ctx.currentTime, 0.1);
    this.engine.filter.frequency.setTargetAtTime(500 + speedRatio * 1600, this.ctx.currentTime, 0.1);
    this.engine.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  silenceEngine() {
    if (this.engine) this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
  }

  setSiren(active, distance = 0) {
    if (!this.siren) return;
    const t = this.ctx.currentTime;
    const level = active ? Math.max(0.02, 0.16 * (1 - Math.min(1, distance / 90))) : 0;
    this.siren.gain.gain.setTargetAtTime(level, t, 0.15);
    if (active) {
      const phase = Math.sin(t * 3.1) > 0 ? 740 : 520;
      this.siren.osc.frequency.setTargetAtTime(phase, t, 0.06);
    }
  }

  noiseBurst(duration = 0.22, gain = 0.4, filterHz = 1400) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    src.stop(this.ctx.currentTime + duration + 0.02);
  }

  blip(freq = 880, duration = 0.12, type = 'square', gain = 0.16) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + duration);
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0008, this.ctx.currentTime + duration);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + duration + 0.02);
  }

  gunshot() {
    if (!this.ctx) return;
    this.noiseBurst(0.16, 0.55, 3200);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(48, this.ctx.currentTime + 0.14);
    g.gain.value = 0.3;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.16);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  punch() {
    this.noiseBurst(0.1, 0.3, 900);
  }

  crash(strength = 1) {
    this.noiseBurst(0.18 + strength * 0.12, Math.min(0.6, 0.22 + strength * 0.25), 700);
  }

  pickup() {
    this.blip(760, 0.09, 'square', 0.18);
    setTimeout(() => this.blip(1140, 0.12, 'square', 0.14), 90);
  }

  missionComplete() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'triangle', 0.2), i * 130));
  }

  wantedUp() {
    this.blip(320, 0.16, 'sawtooth', 0.16);
    setTimeout(() => this.blip(240, 0.2, 'sawtooth', 0.14), 120);
  }

  busted() {
    [400, 300, 220, 150].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'sawtooth', 0.2), i * 150));
  }

  // A slow dusk bassline with a hat tick, quantised by the caller's frame clock.
  tickMusic(dt, tension) {
    if (!this.ctx || this.muted) return;
    this.musicTimer += dt;
    const interval = tension > 0 ? 0.28 : 0.42;
    if (this.musicTimer < interval) return;
    this.musicTimer -= interval;
    const bass = [55, 55, 73.4, 55, 65.4, 55, 49, 55];
    const note = bass[this.step % bass.length];
    this.step++;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = note;
    g.gain.value = 0.09;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + interval * 0.9);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + interval);
    this.noiseBurst(0.03, 0.03, 6000);
  }
}
