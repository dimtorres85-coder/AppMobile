// Small, dependency-free attention signals (sound + haptics) for events
// that must not go unnoticed in bright sunlight / engine noise: the
// "RENTRE" panneautage, the fin de course, and the ALERTE acknowledgement.

let audioCtx = null;

export function beep({ frequency = 880, duration = 220, times = 1, gap = 140, type = 'square' } = {}) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let t = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
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

// Named sound presets, shared vocabulary with the PC app (same waveforms,
// same rhythms) so a preset picked on one side "sounds like" the same
// preset on the other, even though the two beep() implementations differ.
export const SOUND_PRESET_LABELS = {
  strident: 'Strident (bips carrés)',
  sirene: 'Sirène (dents de scie)',
  doux: 'Doux (notes montantes)',
  feutre: 'Feutré (double bip)',
  simple: 'Simple (bip unique)',
};

const SOUND_PRESETS = {
  strident: () => beep({ frequency: 920, duration: 220, times: 3, gap: 100, type: 'square' }),
  sirene: () => {
    beep({ frequency: 720, duration: 160, type: 'sawtooth' });
    setTimeout(() => beep({ frequency: 500, duration: 160, type: 'sawtooth' }), 180);
    setTimeout(() => beep({ frequency: 720, duration: 160, type: 'sawtooth' }), 360);
    setTimeout(() => beep({ frequency: 500, duration: 220, type: 'sawtooth' }), 540);
  },
  doux: () => {
    beep({ frequency: 523, duration: 220, type: 'sine' });
    setTimeout(() => beep({ frequency: 659, duration: 220, type: 'sine' }), 240);
    setTimeout(() => beep({ frequency: 784, duration: 500, type: 'sine' }), 480);
  },
  feutre: () => beep({ frequency: 440, duration: 180, times: 2, gap: 60, type: 'triangle' }),
  simple: () => beep({ frequency: 520, duration: 220, type: 'square' }),
};

export function playPreset(key) {
  (SOUND_PRESETS[key] || SOUND_PRESETS.strident)();
}
