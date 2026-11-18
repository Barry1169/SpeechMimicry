# EchoSpeak — Voice Mimicry Studio

EchoSpeak is a local-first studio for learning a reference speaker’s **delivery**: listen, select a clip, shadow or repeat it, record a take, and see what changed. It does not create voice clones, evaluate identity, or produce a universal mimicry score.

## Start the studio

Requires Node.js 22 or later. Use a current browser; Chromium is recommended for the widest codec and microphone support.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Microphone access requires HTTPS or `localhost`. If an embedded preview denies permission, open the preview in its own tab. `npm run build && npm start` starts a production build.

### Try a 15-second practice session

1. Start in **Practice Studio** with the bundled sample, or choose **Import audio** and add a recording you have permission to use. You can import by dropping a file, entering a direct HTTPS media URL that allows CORS, or recording a reference.
2. Drag the waveform’s clip handles, enter exact times in **Edit clip range**, or select a timed transcript sentence. Shift-click selects consecutive sentences; Shift-drag selects a new waveform range. The bundled exercise opens with 15 seconds selected.
3. Listen to the clip. Choose **Shadowing** to speak while the clip plays, **Start guided repeat** to hear it before recording, or **Start recording** to capture a manual take.
4. Stop and review. Completed audio is retained as a local draft; **Save recording** keeps it and **Compare takes** opens the linked review. Delete or discard only through a confirmation.
5. Use separate delivery measures, listen side by side, and open **AI Mimicry Coach** for a practice plan based on the measurements. Try the same clip again to see changes between comparable takes.

## What works without services

| Area | Working features |
| --- | --- |
| Import | Local MP3, WAV, M4A, MP4, WebM and browser-supported audio. Native Web Audio decoding extracts the audio from supported videos; EchoSpeak stores audio, not video. URL import is browser-only and does not bypass access controls. Limit: 80 MB input, 20 minutes. |
| Timeline & transcript | Interactive waveform, pitch-preserving playback speeds, volume, skips, A/B boundaries, clip/whole-track repeat, keyboard shortcuts, manual timestamped cues, line selection and local bookmarks. |
| Practice | Listen, simultaneous Shadowing, guided Listen & Repeat, Independent recall, and Loop Practice. Guided and loop counts are 1, 3, 5, or 10; guided takes are reviewed individually. Takes and comparable reference clips are capped at 90 seconds. |
| Recording | Browser permission/device selection, timer, input meter and live waveform, pause/resume/stop, level/clipping checks, playback, download, keep and confirmed discard. |
| Comparison | Separate, sequential, or approximately synchronized playback; linked timeline, waveform and quiet gaps, pitch plot, estimated pace/rhythm/intonation/pitch variation/volume/pauses, and onset offset for continuous 1.0× shadowing. Word edit comparisons work with manually entered or recognized transcripts. Only available timecodes are played as word clips. |
| Coach, library & progress | Local rule-based coaching from the analysis, changes between takes of the same clip, reference acoustic profiles, searchable speaker and media library, favorites and collections, bookmarks and custom word drills, seven- and thirty-day local progress reports, and historical recordings. |
| Privacy & accessibility | Light/Dark/System themes, keyboard controls, responsive layouts, no account requirement, private local storage, and confirmed deletion of individual records or all local data. |

## Optional server-side transcription

1. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` on the server. Never use a `NEXT_PUBLIC_` variable for it.
2. Restart the app. In Studio, select **Generate transcript**. For a take, use **Transcribe take** on the comparison screen. Each asks for permission before sending any audio. The server must be allowed to reach `api.openai.com`.
3. Check names, words, and cues against playback. **Word times are speech recognition estimates, not forced alignment.** Edited cues lose their old word times. Where the provider returns only segment timing, the app does not invent word boundaries.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Optional server-only credential for OpenAI `whisper-1`. The provider can charge for usage. Leave unset to keep all practice local. |
| `ECHOSPEAK_STT_HOURLY_LIMIT` | Optional process-wide hourly transcription request cap, default `12`, clamped to `1`–`120`. It is not an authentication mechanism. |

- `GET /api/status` returns capability flags (`transcription`, `storage`), not secrets. A configured flag means a key is present, not that provider access has been verified.
- `POST /api/transcribe` accepts same-origin multipart `audio` (16-bit, 16 kHz mono PCM WAV from the studio) and optional two-letter `language`. Limited to 12 minutes / 24 MiB. It sends the file to `/v1/audio/transcriptions`, requests segment and word granularity, and returns `{ transcript }` with bounded estimated cues. It does not persist the audio on the application server.
- Keep the endpoint behind authenticated access and deployment-level body limits, durable rate limits and provider spend controls if you enable it on a shared deployment. The built-in request/non-origin checks and process quota are not substitutes for sign-in.

## Architecture and storage

Next.js App Router and TypeScript provide the UI and optional server route. React, Tailwind CSS, custom studio components and Lucide compose the interface. Web Audio decodes media and analyzes PCM samples, `pitchy` estimates F0, and MediaRecorder captures microphone takes. IndexedDB provides local persistence without a database server or account. The schema is in [`docs/storage.md`](docs/storage.md); the scoring methods and caveats are in [`docs/measurements.md`](docs/measurements.md).

No local data is synchronized or backed up to a cloud account. Browser storage quotas, private-browsing behavior, clearing site data and switching origins or browsers can affect access; download anything you want to keep. The microphone still needs permission in the user’s browser. Files are not copied to another service unless you explicitly opt into transcription. Deleting local data cannot remove copies already sent to a provider. Only use recordings you have permission to use.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Verification for this build: TypeScript, ESLint, production build, 9 unit/API tests, and 10 Chromium end-to-end tests passed. The browser suite ran against the production build with a Chromium test microphone, generated WAV data, and tiny MP4/WebM fixtures with actual audio tracks. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an installed Chromium, or `ECHOSPEAK_TEST_URL` to test an already running instance. The API test stubs the provider transport; a live provider call requires your own key and network access. Manual and acoustic workflows do not rely on that service.

## Limits and next steps

- **Not measured:** phoneme or articulation accuracy, exact syllable alignment, pronunciation diagnoses, biometric voice similarity, or accent/background inference. Word match is a text comparison, even when generated by recognition. No paid AI or external language model is used by the current coach.
- **Acoustic results are estimates:** unrelated speech, room noise, music, microphone gain, and device latency affect them. Speaking pace in WPM needs usable text; without it, the pace card shows audible activity span instead.
- **Codec support depends on your browser.** A valid video may contain an unsupported or protected track. Convert an authorized copy to WAV if the browser cannot decode it. Retain important takes by downloading them; crashes and abrupt mobile/browser shutdown can interrupt an in-flight recording.
- **Cloud accounts, PostgreSQL, and object storage are not configured or implemented.** Add authenticated per-user cloud sync as a separate deployment phase rather than exposing local audio to a shared database by default.

The built-in practice clip is an original script rendered with Flite’s distributed SLT demonstrator, not a recording of a named creator or a real-person voice clone. Source cue times and waveform peaks are measured from that asset. The thumbnail is illustrative.
