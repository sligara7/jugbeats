// 16-bit mono PCM WAV. Build-time only; nothing here reaches the browser.
//
// Hand-rolled because a WAV header is 44 bytes and a dependency is forever.

export function encodeWav(samples, sampleRate) {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);        // fmt chunk size
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(1, 22);         // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);         // block align
  buf.writeUInt16LE(16, 34);        // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a sample over 1.0 wraps to full-scale negative and
    // reads as a loud tick, which is the single easiest way to ruin a drum.
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
