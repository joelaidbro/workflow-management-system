/**
 * Sound utility using Web Audio API
 * Generates notification sounds without external audio files
 */

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  return new (window.AudioContext || window.webkitAudioContext)();
};

export const playAlertSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Three descending beeps — noticeable alert sound
    [0, 0.2, 0.4].forEach((delay, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 880 - (i * 110);
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15);
      oscillator.start(ctx.currentTime + delay);
      oscillator.stop(ctx.currentTime + delay + 0.15);
    });
  } catch (e) {
    // Silent fail — sound is non-critical
  }
};

export const playMessageSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Single soft ping — subtle message notification
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = 660;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // Silent fail
  }
};
