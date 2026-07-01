// Small, dependency-free attention signals (sound + haptics) for events
// that must not go unnoticed in bright sunlight / engine noise: the
// "RENTRE" panneautage and the ALERTE acknowledgement.

let audioCtx = null;

export function beep({ frequency = 880, duration = 220, times = 1, gap = 140 } = {}) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let t = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + duration / 1000 + 0.02);
      t += (duration + gap) / 1000;
    }
  } catch (err) {
    console.error('Signal sonore indisponible.', err);
  }
}

export function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (err) { /* best-effort */ }
  }
}
