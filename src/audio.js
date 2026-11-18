// Synthesised foley — wood clacks, slides, clock plunger, crown chime. No audio files needed.
let ctx = null;
function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function noiseBuf(c, secs) {
  const b = c.createBuffer(1, Math.max(1, (c.sampleRate * secs) | 0), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  return b;
}
function clack(freq, gain, decay, q = 8) {
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource(); src.buffer = noiseBuf(c, decay);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(bp).connect(g).connect(c.destination); src.start(t);
  // body resonance
  const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq * 0.32, t); o.frequency.exponentialRampToValueAtTime(freq * 0.22, t + decay);
  const og = c.createGain(); og.gain.setValueAtTime(gain * 0.35, t); og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.8);
  o.connect(og).connect(c.destination); o.start(t); o.stop(t + decay);
}
export const Sound = {
  enabled: true,
  unlock() { if (this.enabled) ac(); },
  place(v = 0.7) { if (this.enabled) clack(1800 + Math.random() * 500, 0.55 * v, 0.09); },
  lift() { if (this.enabled) clack(900, 0.06, 0.05, 2); },
  tick() { if (this.enabled) clack(3200, 0.12, 0.03); },
  knock() { if (this.enabled) { clack(2400, 0.5, 0.07); setTimeout(() => clack(1500, 0.25, 0.06), 60); } },
  clockPress() { if (this.enabled) { clack(1100, 0.7, 0.06, 4); setTimeout(() => clack(2600, 0.3, 0.04), 40); } },
  crown() {
    if (!this.enabled) return; const c = ac(); if (!c) return;
    const t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); const s = t + i * 0.09;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 1.2);
      o.connect(g).connect(c.destination); o.start(s); o.stop(s + 1.3);
    });
  },
};
