import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignWords, coaching, compareSignals, inspectSignal, recordingQuality, tokens } from '../src/lib/analysis';
import { envelope, validateMedia } from '../src/lib/media';
import { boundedRange, timeLabel } from '../src/lib/model';
import { coversTextRange, normalizeTranscript, splitWords, transcriptInRange } from '../src/lib/transcription';

const sampleRate = 16000;
function signal(f0: number, duration = 2.6, onset = .15, pauseStart = .85, pauseEnd = 1.25) {
  return Float32Array.from({ length: Math.round(duration * sampleRate) }, (_, i) => {
    const t = i / sampleRate;
    return t < onset || (t >= pauseStart && t < pauseEnd) || t > duration - .12 ? 0 : .23 * Math.sin(2 * Math.PI * f0 * t);
  });
}

test('measures known pitch, activity and a quiet gap instead of assuming speech features', () => {
  const wave = inspectSignal(signal(220), sampleRate);
  assert.ok(Math.abs(wave.medianPitch! - 220) < 2);
  assert.ok(wave.speech && Math.abs(wave.speech.start - .15) < .04);
  assert.equal(wave.pauses.length, 1);
  assert.ok(Math.abs(wave.pauses[0].end - wave.pauses[0].start - .4) < .045);
  assert.ok(wave.loudness! < -10);
  assert.equal(wave.rhythm.length, 32);
  assert.equal(recordingQuality(wave), undefined);
});

test('silence returns unavailable acoustic scores, not zeros or perfect results', () => {
  const silent = inspectSignal(new Float32Array(sampleRate), sampleRate);
  const audible = inspectSignal(signal(150), sampleRate);
  assert.equal(silent.medianPitch, null);
  assert.equal(silent.speech, null);
  const result = compareSignals(audible, silent);
  assert.equal(result.summary.metrics.every(m => m.score === null), true);
  assert.deepEqual(coaching(result.summary), []);
  assert.match(recordingQuality(silent) ?? '', /Very little/);
});

test('relative intonation does not require the same pitch or imply identity', () => {
  const a = inspectSignal(signal(180), sampleRate);
  const b = inspectSignal(signal(270), sampleRate);
  const { summary } = compareSignals(a, b);
  assert.ok(summary.original?.hz && summary.recorded?.hz && summary.recorded.hz - summary.original.hz > 75);
  assert.ok(summary.metrics.find(m => m.key === 'intonation')!.score! >= 95);
  assert.equal(summary.metrics.some(m => /identity/i.test(m.title)), false);
});

test('timing is reported only when original playback onset has been measured', () => {
  const a = inspectSignal(signal(190), sampleRate);
  const b = inspectSignal(signal(190, 2.6, .5), sampleRate);
  const timing = (delay?: number) => compareSignals(a, b, undefined, undefined, delay).summary.metrics.find(m => m.key === 'timing')!;
  assert.equal(timing().score, null);
  assert.match(timing(.1).detail, /250 ms behind/);
});

test('lexical alignment recognizes missing and changed words, with transparent scoring', () => {
  assert.deepEqual(alignWords(tokens('a little pause can help'), tokens('a longer pause help')).map(w => w.status), ['match', 'substitution', 'match', 'missing', 'match']);
  const a = inspectSignal(signal(200), sampleRate);
  const report = compareSignals(a, a, tokens('a little pause can help'), tokens('a longer pause help'));
  assert.equal(report.summary.metrics.find(m => m.key === 'words')?.score, 60);
  assert.ok(report.wpmA! > report.wpmB!);
  assert.ok(coaching(report.summary).some(m => m.key === 'words'));
  assert.deepEqual(splitWords('Don’t rush. कठिन शब्द।'), ["don't", 'rush', 'कठिन', 'शब्द']);
});

test('edited transcript tokens never borrow mismatching speech recognition timings', () => {
  const times = [{ start: 0, end: .4, text: 'listen' }, { start: .45, end: .9, text: 'carefully' }];
  assert.ok(tokens('Listen carefully!', times).every(t => t.timing));
  assert.ok(tokens('Listen closely.', times).every(t => !t.timing));
});

test('segments by actual STT word times, clamps outliers and never fabricates word cues', () => {
  const result = normalizeTranscript({ language: 'english', segments: [{ start: -.4, end: 4, text: 'Hello there. Wait now.' }], words: [
    { word: 'Hello', start: .1, end: .35 }, { word: 'there.', start: .4, end: .8 }, { word: 'Wait', start: 1.7, end: 2 }, { word: 'now.', start: 2.3, end: 4.1 },
    { word: 'bad', start: 'a', end: 1 },
  ] }, 3);
  assert.equal(result.cues.length, 2);
  assert.equal(result.cues[0].end, .8);
  assert.equal(result.cues[1].end, 3);
  const untimed = normalizeTranscript({ segments: [{ start: .1, end: 1.7, text: 'One sentence. Two sentences.' }] }, 3);
  assert.equal(untimed.cues.length, 1);
  assert.equal(untimed.cues[0].words, undefined);
  assert.equal(coversTextRange(untimed, { start: .2, end: 1.2 }), false);
  assert.deepEqual(transcriptInRange(untimed, { start: .2, end: 1.2 }), []);
  assert.equal(transcriptInRange(result, { start: .38, end: .88 })[0].text, 'there.');
});

test('ranges and media data are bounded and validated', () => {
  assert.deepEqual(boundedRange({ start: -5, end: 99 }, 20), { start: 0, end: 20 });
  assert.equal(timeLabel(65.019, true), '01:05.01');
  assert.deepEqual(envelope(new Float32Array([0, -.5, .25, 0]), 2), [.5, .25]);
  assert.throws(() => validateMedia(new File(['test'], 'file.txt', { type: 'text/plain' })), /MP3/);
  assert.throws(() => validateMedia(new File([], 'file.wav')), /empty/);
});
