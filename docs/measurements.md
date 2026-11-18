# What the comparison measures

EchoSpeak decodes the selected reference range and the recorded take to 16 kHz mono PCM locally. Activity detection uses 25 ms RMS frames and an adaptive threshold. It excludes edges from internal pause detection. Pitch estimates use Pitchy’s McLeod Pitch Method with a 42 ms window, clarity gate, and 65–520 Hz bounds. Scores are transparent heuristics for a practice exercise, not validated assessments of a voice, vocal health or pronunciation.

| Category | Score and interpretation |
| --- | --- |
| Pace | 100 × the smaller/larger ratio. Uses elapsed speech-span WPM only if both transcripts are available. Otherwise it compares speech spans rather than assuming a word rate. |
| Rhythm | Compares 32 time-normalized RMS bins, scaled to each clip's 90th-percentile activity. The mean absolute difference maps linearly from 100 at zero to 0 at 0.55. This is an energy-pattern proxy, not syllable alignment. |
| Intonation | A median-centered contour compares relative pitch in semitones across 16 normalized speech bins. Requires at least five paired voiced bins; average difference maps linearly to zero at seven semitones. |
| Pitch variation | 100 × the ratio of smaller/larger 10th-to-90th percentile pitch ranges in semitones. Absolute F0 is for viewing, not a score for sounding like another person. |
| Volume consistency | Absolute difference between active-frame 10th-to-90th-percentile dBFS ranges. A 24 dB difference maps to zero. Relative volume is not vocal projection or physical loudness. |
| Pauses | Quiet gaps of at least 180 ms. Placement across normalized speech (60%) plus total pause-duration ratio (40%). Music, noise and incorrect activity detection can move or conceal pause estimates. |
| Shadowing timing | First detected user activity minus first detected reference activity, after compensating for the recorded app playback-start offset. A 1.2 s absolute difference maps to zero. Only continuous shadowing at 1.0× is scored. It is not calibrated for hardware latency. |
| Transcript word match | `100 × (1 − word edit distance / reference words)`, clamped to `[0, 100]`. Cannot distinguish recognition errors from genuine word changes. There is no phoneme/articulation score. Edited text is not forced-aligned. |

Unavailable or unreliable measurements are left blank rather than invented. The coach maps its top priorities to available categories below 90 and generates bounded drills from those measures. That threshold is a practice heuristic, not a proficiency level. A difference between two scores may reflect the recording conditions rather than improvement.
