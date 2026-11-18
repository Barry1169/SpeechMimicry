import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../src/app/api/transcribe/route';
import { GET } from '../src/app/api/status/route';
import { wavFromBuffer } from '../src/lib/media';

const headers = { origin: 'https://studio.example', host: 'studio.example', 'sec-fetch-site': 'same-origin' };
function upload(media?: Blob, requestHeaders = headers) {
  const form = new FormData();
  form.append('audio', media ?? wavFromBuffer({ duration: .5, sampleRate: 16000, length: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) } as unknown as AudioBuffer, undefined, true), 'source.wav');
  form.append('language', 'en');
  return new Request('https://studio.example/api/transcribe', { method: 'POST', headers: requestHeaders, body: form });
}

test('transcription is optional, validates consent surface and bounds the provider request', async context => {
  const realKey = process.env.OPENAI_API_KEY;
  const realLimit = process.env.ECHOSPEAK_STT_HOURLY_LIMIT;
  const realFetch = globalThis.fetch;
  context.after(() => {
    if (realKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = realKey;
    if (realLimit === undefined) delete process.env.ECHOSPEAK_STT_HOURLY_LIMIT; else process.env.ECHOSPEAK_STT_HOURLY_LIMIT = realLimit;
    globalThis.fetch = realFetch;
  });
  delete process.env.OPENAI_API_KEY;
  assert.equal((await POST(upload())).status, 503);
  assert.deepEqual(await GET().json(), { transcription: false, storage: 'local-indexeddb' });
  process.env.OPENAI_API_KEY = 'test-placeholder-not-a-real-key';
  process.env.ECHOSPEAK_STT_HOURLY_LIMIT = '1';
  const status = await GET().json();
  assert.equal(status.transcription, true);
  assert.equal(JSON.stringify(status).includes('test-placeholder'), false);
  assert.equal((await POST(upload(undefined, { ...headers, origin: 'https://another.example' }))).status, 403);
  assert.equal((await POST(upload(new Blob([new Uint8Array(55)])))).status, 415);
  assert.equal((await POST(new Request('https://studio.example/api/transcribe', { method: 'POST', headers: { ...headers, 'content-type': 'multipart/form-data', 'content-length': '30000000' }, body: 'x' }))).status, 413);
  let seen = 0;
  globalThis.fetch = async (url, options) => {
    seen++;
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-placeholder-not-a-real-key');
    const form = options?.body as FormData;
    assert.equal(form.get('model'), 'whisper-1');
    assert.equal(form.get('language'), 'en');
    assert.deepEqual(form.getAll('timestamp_granularities[]'), ['segment', 'word']);
    return Response.json({ segments: [{ start: 0, end: .7, text: 'Listen.' }], words: [{ start: .1, end: .7, word: 'Listen.' }], language: 'english' });
  };
  const done = await POST(upload());
  assert.equal(done.status, 200);
  const result = await done.json();
  assert.equal(result.transcript.origin, 'recognition');
  assert.equal(result.transcript.cues[0].words[0].end, .5);
  assert.equal((await POST(upload())).status, 429);
  assert.equal(seen, 1);
});
