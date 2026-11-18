import { boundedRange, type Range } from './model';

export const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
export const MAX_SOURCE_DURATION = 20 * 60;
export const MAX_TAKE_SECONDS = 90;
export const IMPORT_ACCEPT = '.mp3,.wav,.m4a,.aac,.mp4,.webm,.ogg,.opus,.flac,.mov,audio/*,video/mp4,video/webm';
const ext = /\.(?:mp3|wav|m4a|aac|mp4|webm|ogg|opus|flac|mov)$/i;
const types = /^(?:audio\/(?:mpeg|mp3|x-mp3|wav|wave|x-wav|vnd\.wave|mp4|m4a|x-m4a|aac|x-aac|ogg|webm|opus|flac|x-flac)|video\/(?:mp4|webm|quicktime)|application\/ogg)(?:;|$)/i;

export function validateMedia(file: File) {
  if (!file.size) throw new Error('This file is empty. Try a different recording.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a file under 80 MB.');
  if (!ext.test(file.name) && !types.test(file.type)) throw new Error('Choose an MP3, WAV, M4A, MP4, WebM or another supported audio file.');
}

export async function decodeMedia(media: Blob | string, rate = 16000) {
  if (typeof AudioContext === 'undefined') throw new Error('This browser does not support Web Audio. Try a current version of Chrome or Firefox.');
  const blob = typeof media === 'string' ? await fetch(media).then(r => {
    if (!r.ok) throw new Error('The reference audio could not be downloaded.');
    return r.blob();
  }) : media;
  const context = new AudioContext({ sampleRate: rate });
  try { return await context.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('No supported audio track could be decoded. Try exporting the recording as WAV or MP3.'); }
  finally { await context.close().catch(() => undefined); }
}

export function monoSamples(buffer: AudioBuffer, range?: Range) {
  const clip = range ? boundedRange(range, buffer.duration) : { start: 0, end: buffer.duration };
  const offset = Math.floor(clip.start * buffer.sampleRate);
  const end = Math.min(buffer.length, Math.ceil(clip.end * buffer.sampleRate));
  const out = new Float32Array(end - offset);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    if (buffer.numberOfChannels === 1) { out.set(data.subarray(offset, end)); break; }
    for (let j = 0; j < out.length; j++) out[j] += data[j + offset] / buffer.numberOfChannels;
  }
  return out;
}

export function envelope(samples: Float32Array, buckets = 392): number[] {
  return Array.from({ length: buckets }, (_, i) => {
    const start = Math.floor(i * samples.length / buckets);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * samples.length / buckets)));
    let max = 0;
    for (let j = start; j < end; j++) max = Math.max(max, Math.abs(samples[j]));
    return Math.round(max * 1000) / 1000;
  });
}

export function wavFromBuffer(buffer: AudioBuffer, range?: Range, mono = false) {
  const clip = range ? boundedRange(range, buffer.duration) : { start: 0, end: buffer.duration };
  const start = Math.floor(clip.start * buffer.sampleRate);
  const length = Math.min(buffer.length, Math.ceil(clip.end * buffer.sampleRate)) - start;
  const channels = mono ? [monoSamples(buffer, clip)] : Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, ch) => buffer.getChannelData(ch).subarray(start, start + length));
  const stride = channels.length * 2;
  const bytes = new ArrayBuffer(44 + length * stride);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(i + offset, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * stride, true);
  view.setUint16(32, stride, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * stride, true);
  for (let i = 0; i < length; i++) for (let ch = 0; ch < channels.length; ch++) {
    const n = Math.max(-1, Math.min(1, channels[ch][i]));
    view.setInt16(44 + i * stride + ch * 2, n * (n < 0 ? 32768 : 32767), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function prepareImport(file: File) {
  validateMedia(file);
  const video = file.type.startsWith('video/') || /\.(?:mp4|mov)$/i.test(file.name) || (/\.webm$/i.test(file.name) && !file.type.startsWith('audio/'));
  const decoded = await decodeMedia(file, video ? 32000 : 16000);
  if (decoded.duration < 0.1 || decoded.duration > MAX_SOURCE_DURATION) throw new Error('Choose a recording between 0.1 seconds and 20 minutes.');
  const peaks = envelope(monoSamples(decoded));
  return { duration: decoded.duration, peaks, blob: video ? wavFromBuffer(decoded, undefined, decoded.duration > 600) : file };
}

export async function fetchDirectMedia(address: string, progress: (percent: number | null) => void, signal?: AbortSignal) {
  let url: URL;
  try { url = new URL(address); } catch { throw new Error('Enter a valid direct HTTPS media URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS media URL without credentials.');
  let response: Response;
  try { response = await fetch(url, { credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal }); }
  catch { throw new Error('The source did not allow browser access. Download a permitted copy and import the file instead.'); }
  if (!response.ok || !response.body) throw new Error('This link did not return a readable recording.');
  const mime = response.headers.get('Content-Type') ?? '';
  if (/text\/html|application\/json/i.test(mime)) { await response.body.cancel(); throw new Error('This is a webpage, not a direct media file.'); }
  const bytes = Number(response.headers.get('Content-Length'));
  if (bytes > MAX_IMPORT_BYTES) { await response.body.cancel(); throw new Error('Choose a recording under 80 MB.'); }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_IMPORT_BYTES) { await reader.cancel(); throw new Error('The download exceeded 80 MB.'); }
      chunks.push(value.slice().buffer);
      progress(bytes > 0 ? Math.min(100, Math.round(received / bytes * 100)) : null);
    }
  } finally { reader.releaseLock(); }
  let fileName = url.pathname.split('/').pop() || 'Imported recording';
  try { fileName = decodeURIComponent(fileName); } catch { /* use encoded path */ }
  const file = new File(chunks, fileName, { type: mime.split(';')[0] });
  validateMedia(file);
  return file;
}
