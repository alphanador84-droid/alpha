import * as lamejs from 'lamejs';

export type AudioFormat = 'wav' | 'mp3';

export interface AudioQuality {
  sampleRate: number;
  bitrate?: number;
  label: string;
}

export const QUALITY_PRESETS: Record<string, AudioQuality> = {
  high: { sampleRate: 24000, bitrate: 320, label: 'Studio (24kHz)' },
  medium: { sampleRate: 16000, bitrate: 128, label: 'Broadcast (16kHz)' },
  low: { sampleRate: 8000, bitrate: 64, label: 'Radio (8kHz)' },
};

/**
 * Converts a base64 PCM string from Gemini TTS to an AudioBuffer.
 * Gemini 3.1 Flash TTS returns 16-bit LPCM at 24000Hz.
 */
export async function base64ToAudioBuffer(base64: string, sourceSampleRate: number = 24000): Promise<AudioBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = ctx.createBuffer(1, float32Array.length, sourceSampleRate);
  buffer.getChannelData(0).set(float32Array);
  return buffer;
}

/**
 * Resamples an AudioBuffer to a target sample rate.
 */
export async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.ceil(buffer.duration * targetRate),
    targetRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();

  return await offlineCtx.startRendering();
}

/**
 * Encodes an AudioBuffer to a WAV Blob.
 */
export function encodeWAV(buffer: AudioBuffer): Blob {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const length = channelData.length * 2;
  const view = new DataView(new ArrayBuffer(44 + length));

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);

  const offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Encodes an AudioBuffer to an MP3 Blob using lamejs.
 */
export function encodeMP3(buffer: AudioBuffer, bitrate: number = 128): Blob {
  // Use property access that's safer for different module environments
  const Lame = (lamejs as any).default || lamejs;
  
  // lamejs 1.2.x has issues in ESM environments where it expects certain globals.
  // We inject them into window if they are missing to satisfy internal references.
  if (typeof window !== 'undefined') {
    if (!(window as any).MPEGMode && Lame.MPEGMode) (window as any).MPEGMode = Lame.MPEGMode;
    if (!(window as any).Lame && Lame.Lame) (window as any).Lame = Lame.Lame;
    if (!(window as any).BitStream && Lame.BitStream) (window as any).BitStream = Lame.BitStream;
  }

  const mp3encoder = new Lame.Mp3Encoder(1, buffer.sampleRate, bitrate);
  const channelData = buffer.getChannelData(0);
  const samples = new Int16Array(channelData.length);
  
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const mp3Data = [];
  const sampleBlockSize = 1152;
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const sampleChunk = samples.subarray(i, i + sampleBlockSize);
    const mp3tmp = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3tmp.length > 0) {
      mp3Data.push(mp3tmp);
    }
  }

  const mp3Last = mp3encoder.flush();
  if (mp3Last.length > 0) {
    mp3Data.push(mp3Last);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

/**
 * Mixes two AudioBuffers (speech and background music) with independent volume control.
 * Background music will loop or stretch to match/surround speech duration if needed, 
 * but for simplicity here we assume it covers the speech duration.
 */
export async function mixAudioBuffers(
  speechBuffer: AudioBuffer,
  musicBuffer: AudioBuffer,
  speechVolume: number,
  musicVolume: number
): Promise<AudioBuffer> {
  const targetRate = speechBuffer.sampleRate;
  
  // Resample music to match speech rate if they differ
  const resampledMusic = await resampleBuffer(musicBuffer, targetRate);
  
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const mixedBuffer = ctx.createBuffer(1, speechBuffer.length, targetRate);
  
  const speechData = speechBuffer.getChannelData(0);
  const musicData = resampledMusic.getChannelData(0);
  const mixedData = mixedBuffer.getChannelData(0);
  
  for (let i = 0; i < mixedData.length; i++) {
    const s = (speechData[i] || 0) * speechVolume;
    const m = (musicData[i % musicData.length] || 0) * musicVolume; // Loop music if shorter
    mixedData[i] = Math.max(-1, Math.min(1, s + m)); // Clamp
  }
  
  return mixedBuffer;
}
