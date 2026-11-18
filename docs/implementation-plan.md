# EchoSpeak build plan

The working branch starts from a README. The linked Personal Speech Training repo is a reference, not the target checkout. The available runtime is Node 22; there is no bundled PostgreSQL or FFmpeg instance. Build EchoSpeak here as a focused, local-first Next.js/TypeScript application with React, Tailwind, shared audio-studio components and server route handlers for opt-in integrations.

1. **Studio MVP:** initialize the application, import and preview permitted local or direct media, decode video audio in the browser, choose a range, edit timed transcript cues, record and keep takes, and deliver listen/repeat and shadowing. Gate optional transcription behind explicit consent. Verify the bundled exercise and real import/record/playback in a browser before extending the studio.
2. **Comparison:** calculate measurable results from decoded audio, display linked players, real waveforms, pitch and pauses, and optionally compare recognized words. Test DSP and time/word alignment with known fixtures and exercise the comparison UI.
3. **Coach and library:** create traceable recommendations from actual analysis, plus saved drills, source/speaker management and local progress. Verify workflows and persistence across reloads. No aggregate mimicry or identity score.
4. **Deployment boundaries:** IndexedDB is the built-in store (no service or account required). Document server-side transcription setup, optional cost, privacy/consent, and future authenticated PostgreSQL/object-storage sync. Clearly mark unsupported forced alignment, phoneme/articulation scoring and cloud accounts instead of simulating them.

Required services: none for import, recording, playback, acoustic comparison, coach or local library. Optional cost: usage-based OpenAI `whisper-1` transcription. No paid voice cloning, LLM coach, media downloader, or cloud storage is necessary for the local workflow.
