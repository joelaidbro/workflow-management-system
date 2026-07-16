/**
 * Sound utility — WAV data URIs played via HTMLAudioElement.
 *
 * Why not Web Audio API (oscillators + AudioContext):
 *   Every new AudioContext starts in "suspended" state and requires a user
 *   gesture to resume. Polling fires automatically with no gesture, so the
 *   context is almost always suspended → sounds silently dropped. The
 *   singleton + resume() approach still races in some Chromium versions.
 *   HTMLAudioElement.play() is governed by a separate, more permissive
 *   autoplay policy and is consistent across all modern browsers.
 *
 * Sounds are built once at module init from raw PCM math — no network
 * requests, no asset files needed.
 */

const SR = 44100; // sample rate (Hz)

// Returns a Float32Array of `length` samples containing one sine tone.
// The tone fades in over 15 ms and out over 50 ms to avoid clicks.
function tone(freq, startSec, durSec, amp) {
  const startI  = Math.round(startSec * SR);
  const endI    = Math.round((startSec + durSec) * SR);
  const fadeIn  = Math.round(0.015 * SR);
  const fadeOut = Math.round(0.050 * SR);
  const arr = new Float32Array(endI);
  for (let i = startI; i < endI; i++) {
    const rel = i - startI;
    const len = endI - startI;
    let env = 1;
    if (rel < fadeIn)           env = rel / fadeIn;
    else if (rel > len - fadeOut) env = (len - rel) / fadeOut;
    arr[i] += Math.sin(2 * Math.PI * freq * (rel / SR)) * amp * env;
  }
  return arr;
}

// Mixes Float32Array tracks and encodes them as a WAV data URI.
function buildWav(...tracks) {
  const len = Math.max(...tracks.map((t) => t.length));
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const t of tracks) if (i < t.length) s += t[i];
    pcm[i] = Math.max(-32767, Math.min(32767, s | 0));
  }
  const buf = new ArrayBuffer(44 + len * 2);
  const v   = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true);  v.setUint16(20, 1, true);   // PCM
  v.setUint16(22, 1, true);   v.setUint32(24, SR, true);  // mono, SR
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, pcm[i], true);
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

// Build all sound data URIs once at module init (sync, ~1 ms each).
const SOUNDS = (() => {
  if (typeof window === 'undefined') return null;
  try {
    return {
      // Two-tone ascending ding-dong (~0.65 s) — chat messages
      message: buildWav(
        tone(880,  0,    0.40, 20000),
        tone(1100, 0.25, 0.40, 18000),
      ),
      // Two-tone ascending chime (~0.50 s) — reports / leave / alerts
      action: buildWav(
        tone(600, 0,    0.32, 20000),
        tone(800, 0.20, 0.32, 18000),
      ),
      // Three descending beeps (~0.65 s) — staff alert panel
      alert: buildWav(
        tone(880, 0,    0.18, 22000),
        tone(770, 0.22, 0.18, 22000),
        tone(660, 0.44, 0.18, 22000),
      ),
    };
  } catch {
    return null;
  }
})();

function playDataUri(uri) {
  if (!uri) return;
  try {
    new Audio(uri).play().catch(() => {});
  } catch {
    // no-op — sound is non-critical
  }
}

export const playMessageSound = () => playDataUri(SOUNDS?.message);
export const playActionSound  = () => playDataUri(SOUNDS?.action);
export const playAlertSound   = () => playDataUri(SOUNDS?.alert);
