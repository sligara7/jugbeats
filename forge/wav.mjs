// 16-bit PCM WAV. Build-time only; nothing here reaches the browser.
//
// Hand-rolled because a WAV header is 44 bytes and a dependency is forever.
//
// Mono by default, because that is what the drum kit is and what every existing
// caller passes. `channels: 2` takes INTERLEAVED samples, and exists because a
// reverb rendered to mono throws away most of what a reverb is for.

export function encodeWav(samples, sampleRate, channels = 1) {
  const bytes = samples.length * 2;
  const blockAlign = 2 * channels;
  const buf = Buffer.alloc(44 + bytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);        // fmt chunk size
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buf.writeUInt16LE(blockAlign, 32);
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
