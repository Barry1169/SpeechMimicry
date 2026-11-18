import { normalizeTranscript, type ProviderTranscript } from '@/lib/transcription';

export const runtime = 'nodejs';
const MAX = 24 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;
let quota = { starts: 0, used: 0, inFlight: 0 };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return error('Automatic transcripts are not configured on this server. Add cues manually, or configure OPENAI_API_KEY.', 503);
  if (request.headers.get('sec-fetch-site') === 'cross-site') return error('Cross-site requests are not allowed.', 403);
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() ?? request.headers.get('host');
  if (!origin || !host) return error('The request must come from the EchoSpeak studio.', 403);
  try { if (new URL(origin).host !== host) return error('Cross-site requests are not allowed.', 403); }
  catch { return error('Invalid request origin.', 403); }
  if (!/^multipart\/form-data/i.test(request.headers.get('content-type') ?? '')) return error('A multipart audio upload is required.', 415);
  if (Number(request.headers.get('content-length')) > MAX + 65536) return error('Keep the transcription upload under 24 MB.', 413);
  // Bound the actual body even when Content-Length is not provided. Avoid buffering unbounded multipart data.
  const reader = request.body?.getReader();
  if (!reader) return error('A recording is required.', 400);
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX + 65536) { await reader.cancel(); return error('Keep the transcription upload under 24 MB.', 413); }
      chunks.push(value.slice().buffer);
    }
  } catch { return error('The upload could not be read.', 400); }
  finally { reader.releaseLock(); }
  let input: FormData;
  try { input = await new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
  catch { return error('The upload could not be read.', 400); }
  const audio = input.get('audio');
  if (!(audio instanceof Blob) || audio.size <= 44 || audio.size > MAX) return error('A WAV recording under 24 MB is required.', 400);
  const language = input.get('language');
  const header = new DataView(await audio.slice(0, 44).arrayBuffer());
  if (header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645 || header.getUint32(12) !== 0x666d7420
    || header.getUint32(36) !== 0x64617461 || header.getUint32(16, true) !== 16 || header.getUint16(20, true) !== 1
    || header.getUint16(22, true) !== 1 || header.getUint16(34, true) !== 16 || header.getUint32(24, true) !== 16000
    || header.getUint32(40, true) !== audio.size - 44) return error('The recording must be a 16 kHz mono PCM WAV from the studio.', 415);
  const duration = (audio.size - 44) / 32000;
  if (duration > 720) return error('Automatic transcription supports recordings of up to 12 minutes.', 413);

  // A process-wide cap limits accidental provider usage. This is not authentication; put the endpoint behind access controls on shared deployments.
  const configured = Number(process.env.ECHOSPEAK_STT_HOURLY_LIMIT ?? 12);
  const limit = Number.isFinite(configured) ? Math.min(120, Math.max(1, Math.floor(configured))) : 12;
  const now = Date.now();
  if (now - quota.starts >= HOUR) quota = { starts: now, used: 0, inFlight: quota.inFlight };
  if (quota.used >= limit || quota.inFlight >= 2) return error('This workspace has reached its transcription limit. Try again later or enter cues manually.', 429);
  const form = new FormData();
  form.append('file', audio, 'recording.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');
  if (typeof language === 'string' && /^[a-z]{2}$/.test(language)) form.append('language', language);
  quota.used++;
  quota.inFlight++;
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) return error(response.status === 429 ? 'The transcription service is busy or its quota has been reached.' : 'Transcription was rejected by the provider. Check the server configuration or enter cues manually.', 502);
    const result = await response.json() as ProviderTranscript;
    return Response.json({ transcript: normalizeTranscript(result, duration) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return error('The transcription service is unreachable. You can still enter cues manually.', 502); }
  finally { quota.inFlight--; }
}
