import { test, expect, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import path from 'node:path';

const button = (p: Page, name: string) => p.getByRole('button', { name, exact: true });
const nav = (p: Page, name: string) => p.getByRole('link', { name, exact: true });
const input = (p: Page) => p.locator('input[type=file][aria-label="Choose audio or video file"]');

async function studio(page: Page) {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Practice Studio', exact: true })).toBeVisible();
}
async function selectRange(page: Page, start: number, end: number) {
  await button(page, 'Edit clip range').click();
  await page.getByLabel('Clip start (seconds)').fill(String(start));
  await page.getByLabel('Clip end (seconds)').fill(String(end));
  await button(page, 'Apply clip range').click();
}
async function record(page: Page, duration = 1100) {
  await button(page, 'Start recording').or(button(page, 'Record again')).click();
  await expect(button(page, 'Stop')).toBeVisible();
  await page.waitForTimeout(duration); // Capture a real interval of MediaRecorder data.
  await button(page, 'Stop').click();
  await expect(button(page, 'Compare takes')).toBeEnabled();
}
function knownWave(seconds: number) {
  const rate = 16000, frames = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    if (t % .8 < .58) buf.writeInt16LE(Math.round(Math.sin(t * 2 * Math.PI * 220) * 6400), 44 + i * 2);
  }
  return buf;
}

test('selects 15 seconds, records with pause/resume, compares real media, and persists a take', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', m => { if (m.type() === 'error' && m.text().includes('hydrated but')) errors.push(m.text()); });
  await studio(page);
  await page.getByLabel('Reference options', { exact: true }).click();
  await button(page, 'Speaking style profile').click();
  await expect(page.getByRole('dialog', { name: 'Speaking-style profile' }).getByRole('img', { name: /fundamental frequency/ })).toBeVisible();
  await button(page, 'Close dialog').click();
  await selectRange(page, 5.85, 20.85);
  await expect(page.getByText('15s selected', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('0.7');
  await expect.poll(() => page.locator('.reference-panel audio').evaluate((audio: HTMLAudioElement) => [audio.playbackRate, audio.preservesPitch])).toEqual([.7, true]);
  await button(page, 'Play original').click();
  await expect(button(page, 'Pause original')).toBeVisible();
  await button(page, 'Pause original').click();
  await button(page, 'Start recording').click();
  await expect(button(page, 'Stop')).toBeVisible();
  await page.waitForTimeout(550);
  await button(page, 'Pause recording').click();
  await expect(button(page, 'Resume recording')).toBeVisible();
  await button(page, 'Resume recording').click();
  await page.waitForTimeout(850);
  await button(page, 'Stop').click();
  await expect(button(page, 'Compare takes')).toBeEnabled();
  await button(page, 'Save recording').click();
  await expect(page.getByText('Recording kept in My Recordings.')).toBeVisible();
  await button(page, 'Compare takes').click();
  await expect(page.getByRole('heading', { name: 'Voice Comparison' })).toBeVisible();
  await expect(page.locator('.delivery-metric')).toHaveCount(8);
  await expect(page.getByRole('slider', { name: 'Original comparison waveform' })).toBeVisible();
  await button(page, 'My recording').click();
  await button(page, 'Play comparison').click();
  await expect(button(page, 'Pause comparison')).toBeVisible();
  await button(page, 'Pause comparison').click();
  await button(page, 'Together').click();
  await button(page, 'Play comparison').click();
  await expect.poll(() => page.locator('.comparison-media audio').evaluateAll(elements => elements.filter(e => !(e as HTMLAudioElement).paused).length)).toBe(2);
  await button(page, 'Pause comparison').click();
  await button(page, 'Edit take text').click();
  await page.getByRole('textbox', { name: 'Cue 1 text' }).fill('But a little silence gives the listener room to think.');
  await button(page, 'Save transcript').click();
  await expect(page.locator('.word-alignment .word-tag')).not.toHaveCount(0);
  await expect(button(page, 'Open Mimicry Coach')).toBeEnabled();
  await button(page, 'Open Mimicry Coach').click();
  await expect(page.getByRole('heading', { name: 'Targeted practice plan' })).toBeVisible();
  await nav(page, 'Voice Comparison').click();
  const id = await page.getByRole('combobox', { name: 'Select a take' }).inputValue();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Select a take' })).toHaveValue(id);
  await expect(page.locator('.word-alignment .word-tag')).not.toHaveCount(0);
  await nav(page, 'Progress & Analytics').click();
  await expect(page.getByRole('heading', { name: 'Recording history' })).toBeVisible();
  await expect(button(page, 'Open comparison')).toBeVisible();
  expect(errors).toEqual([]);
});

test('validates local upload, displays waveform and supports editing, selecting and saving cues', async ({ page }) => {
  await studio(page);
  await button(page, 'Import audio').click();
  await input(page).setInputFiles({ name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
  await expect(page.getByText('Choose an MP3', { exact: false })).toBeVisible();
  await input(page).setInputFiles({ name: 'Narration example.wav', mimeType: 'audio/wav', buffer: knownWave(18) });
  await expect(page.getByRole('heading', { name: 'Narration example' })).toBeVisible();
  await expect(page.getByText('15s selected', { exact: true })).toBeVisible();
  await button(page, 'Add transcript').click();
  await page.getByRole('textbox', { name: 'Cue 1 text' }).fill('The next phrase is the part we will practise.');
  await page.getByLabel('Cue 1 start').fill('2');
  await page.getByLabel('Cue 1 end').fill('5.25');
  await button(page, 'Save transcript').click();
  await button(page, 'Select sentence 1: The next phrase is the part we will practise.').click();
  await expect(page.getByRole('slider', { name: 'Original waveform timeline' })).toHaveAttribute('aria-valuenow', '2');
  await button(page, 'Bookmark sentence 1').click();
  await expect(page.getByText('Added to Saved Sentences.')).toBeVisible();
  await nav(page, 'Saved Sentences').click();
  await expect(page.getByText('The next phrase is the part we will practise.', { exact: true }).filter({ visible: true })).toBeVisible();
  await button(page, 'Practise').click();
  await expect(page.getByRole('slider', { name: 'Original waveform timeline' })).toHaveAttribute('aria-valuenow', '2');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Narration example' })).toBeVisible();
});

for (const format of ['webm', 'mp4']) {
  test(`extracts and plays audio from a ${format.toUpperCase()} video`, async ({ page }) => {
    await studio(page);
    test.skip(format === 'mp4' && !await page.locator('.reference-panel audio').evaluate((e: HTMLAudioElement) => e.canPlayType('audio/mp4; codecs="mp4a.40.2"')), 'This Chromium build cannot decode AAC.');
    await button(page, 'Import audio').click();
    await input(page).setInputFiles(path.resolve(`tests/fixtures/reference-video.${format}`));
    await expect(page.getByRole('heading', { name: 'reference-video' })).toBeVisible();
    await button(page, 'Play original').click();
    await expect(button(page, 'Pause original')).toBeVisible();
    const result = await page.locator('.reference-panel audio').evaluate(async (audio: HTMLAudioElement) => ({ duration: audio.duration, mediaType: (await fetch(audio.src)).headers.get('content-type') }));
    expect(result.duration).toBeGreaterThan(2);
    expect(result.mediaType).toBe('audio/wav');
  });
}

test('imports a direct HTTPS recording only after confirmation', async ({ page }) => {
  await page.route('https://media.example.invalid/example.wav', route => route.fulfill({ contentType: 'audio/wav', body: knownWave(1.8), headers: { 'access-control-allow-origin': '*' } }));
  await studio(page);
  await button(page, 'Import audio').click();
  await button(page, 'Media URL').click();
  await page.getByLabel('Direct HTTPS media URL').fill('https://media.example.invalid/example.wav');
  await expect(button(page, 'Import link')).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I have permission to use this recording.' }).check();
  await button(page, 'Import link').click();
  await expect(page.getByRole('heading', { name: 'example', exact: true })).toBeVisible();
});

test('runs shadowing, independent recall and guided repetition', async ({ page }) => {
  await studio(page);
  await selectRange(page, 6.02, 7.35);
  await page.getByRole('button', { name: 'Shadowing Speak in sync' }).click();
  await button(page, 'Start recording').click();
  await expect(button(page, 'Stop')).toBeVisible();
  await expect.poll(() => page.locator('.reference-panel audio').evaluate((e: HTMLAudioElement) => e.paused)).toBe(false);
  await expect(button(page, 'Compare takes')).toBeEnabled(); // Stops at clip end.
  await page.getByRole('button', { name: 'Independent Speak from memory' }).click();
  await button(page, 'Play original').click();
  await expect(button(page, 'Reveal transcript')).toBeVisible();
  await button(page, 'Reveal transcript').click();
  await page.getByRole('button', { name: 'Listen & Repeat Listen, then echo' }).click();
  await page.getByRole('combobox', { name: 'Repetitions' }).selectOption('1');
  await button(page, 'Start guided repeat').click();
  await expect(button(page, 'Cancel guided repeat')).toBeVisible();
  await expect(button(page, 'Stop')).toBeVisible();
  await expect(page.getByText('Repetition 1 of 1 saved for review.')).toBeVisible();
  await expect(button(page, 'Next sentence')).toBeVisible();
});

test('handles microphone denial without creating a recording', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Blocked for this test', 'NotAllowedError'); }; });
  await studio(page);
  await button(page, 'Start recording').click();
  await expect(page.getByText('Microphone access was denied.', { exact: false })).toBeVisible();
  await expect(button(page, 'Compare takes')).toBeDisabled();
});

test('speaker profiles, a custom word drill and confirmed local deletion work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await studio(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const menu = () => button(page, 'Open menu').click();
  await menu(); await nav(page, 'Speaker Library').click();
  await button(page, 'Add speaker').click();
  await page.getByLabel('Speaker name').fill('My reference narrator');
  await page.getByLabel('Category', { exact: true }).fill('Narrators');
  await button(page, 'Create speaker').click();
  await expect(page.getByRole('heading', { name: 'My reference narrator' })).toBeVisible();
  await button(page, 'Favorite My reference narrator').click();
  await expect(button(page, 'Favorite My reference narrator')).toHaveAttribute('aria-pressed', 'true');
  await menu(); await nav(page, 'Saved Sentences').click();
  await button(page, 'Add word drill').click();
  await page.getByLabel('Word or short phrase').fill('silence');
  await page.getByLabel('Start (s)').fill('7');
  await page.getByLabel('End (s)').fill('7.55');
  await button(page, 'Save drill').click();
  await button(page, 'Open drill').click();
  await expect(page.getByRole('heading', { name: 'Drill: silence' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Repetitions' })).toHaveValue('5');
  await record(page, 850);
  await menu(); await button(page, 'Dark mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await nav(page, 'Settings').click();
  await button(page, 'Delete all local data').click();
  await button(page, 'Cancel').click();
  await button(page, 'Delete all local data').click();
  await button(page, 'Delete all data').click();
  await expect(page.getByText('Local workspace cleared.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await menu(); await nav(page, 'My Recordings').click();
  await expect(page.getByText('No recordings yet', { exact: true })).toBeVisible();
});

test('keeps a microphone reference private, previews it and requires confirmation to remove a take', async ({ page }) => {
  await studio(page);
  await button(page, 'Import audio').click();
  await button(page, 'Microphone').and(page.getByRole('dialog').getByRole('button')).click();
  await button(page, 'Start microphone').click();
  await button(page, 'Stop recording').waitFor();
  await page.waitForTimeout(1000);
  await button(page, 'Stop recording').click();
  await page.getByLabel('Reference name').fill('My reference audio');
  await expect(page.getByRole('dialog').locator('audio')).toHaveAttribute('src', /^blob:/);
  await button(page, 'Add to studio').click();
  await expect(page.getByRole('heading', { name: 'My reference audio' })).toBeVisible();
  await record(page, 850);
  await nav(page, 'My Recordings').click();
  await page.getByRole('button', { name: /^Rename Take/ }).click();
  await page.getByLabel('Take name').fill('My edited take');
  await button(page, 'Save name').click();
  await button(page, 'Delete My edited take').click();
  await button(page, 'Cancel').click();
  await expect(page.getByText('My edited take', { exact: true })).toBeVisible();
  await button(page, 'Delete My edited take').click();
  await button(page, 'Discard recording').click();
  await expect(page.getByText('No recordings yet', { exact: true })).toBeVisible();
});

test('opens transcription consent before sending audio and exposes only returned word timings', async ({ page }) => {
  let uploads = 0;
  await page.route('**/api/status', route => route.fulfill({ json: { transcription: true, storage: 'local-indexeddb' } }));
  await page.route('**/api/transcribe', route => {
    uploads++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataBuffer()?.includes('recording.wav')).toBe(true);
    return route.fulfill({ json: { transcript: { origin: 'recognition', language: 'en', cues: [{
      id: 'remote-1', start: .15, end: 1.2, text: 'Listen closely.', words: [{ start: .15, end: .5, text: 'Listen' }, { start: .62, end: 1.2, text: 'closely.' }],
    }] } } });
  });
  await studio(page);
  await button(page, 'Import audio').click();
  await input(page).setInputFiles({ name: 'Timed example.wav', mimeType: 'audio/wav', buffer: knownWave(2.6) });
  await button(page, 'Generate transcript').click();
  await expect(page.getByRole('dialog', { name: 'Generate transcript' })).toBeVisible();
  expect(uploads).toBe(0);
  await button(page, 'Send & transcribe').click();
  await expect(page.getByText('Estimated recognition timing', { exact: true })).toBeVisible();
  await button(page, 'closely.').click();
  await expect(page.getByRole('slider', { name: 'Original waveform timeline' })).toHaveAttribute('aria-valuenow', '0.62');
  await expect(page.getByText('0.6s selected', { exact: true })).toBeVisible();
  expect(uploads).toBe(1);
});
