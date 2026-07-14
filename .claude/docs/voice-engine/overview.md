# Voice-engine — Overview

> Vynel's speech engine: the model-agnostic seam that turns text into spoken audio and spoken audio back into text, all natively on the CPU with no Python.
>
> **Status:** shipped (synthesis · transcription · segmentation) · **Depends on:** the `sherpa-onnx-node` native runtime only — no Vynel kernel or sibling features · **Code map:** [structure.md](./structure.md)

## Purpose

Voice-engine is the thin, stateful boundary between Vynel and a speech-model backend. Everything else that wants a voice — the always-on daemon, the browser overlay — talks to *three small contracts* here (speak, listen, segment) and never touches an ONNX model, a native addon, or a download layout directly. Swapping the backend (sherpa-onnx today, an optional Python voice-cloning sidecar later) is meant to be a config change that never reaches a caller's function signatures.

This is **plumbing, not a product surface**. It ships no routes, no schema, no tools, no UI. Its whole job is to be the one place the speech models live, wrapped so a model change lands in a single folder. Its defining bet is *realtime on CPU, offline, zero Python* — the answer to "Whisper was too slow": a native ONNX backend that runs speech-to-text at many times realtime on an ordinary machine.

## What it can do

- **Speak** — synthesize a line of text into mono audio at the model's native rate, choosing a speaker for multi-voice models and scaling the tempo.
- **Listen** — transcribe one complete spoken utterance into text (empty string when nothing was said); the backend resamples any input rate internally.
- **Segment a live stream** — feed it a continuous 16 kHz microphone stream and it hands back complete utterances (speech closed by silence), so a caller transcribes natural sentences instead of fixed windows.
- **Read and write WAV files** — a small helper pair for smoke scripts, benchmarks, and fixtures.
- **Stand in for a real model in tests** — a deterministic, model-free fake voice that returns sized silence and records what it was asked to say, so consumers can unit-test their wiring without loading an ONNX model or the native addon.

## Responsibilities

**Owns** — the three speech contracts and their sherpa-onnx backends: text-to-speech synthesis, speech-to-text transcription, and voice-activity segmentation; the audio interchange format shared between the engine and its callers; the pure mappers that translate Vynel's model configs into the backend's own config shapes; the anti-corruption boundary that quarantines the native addon to one file (and works around its CommonJS-under-ESM load quirk); the WAV read/write helpers; and the model-free fake for downstream tests.

**Does not own** —
- **wake-word detection and the turn-taking logic** — the phrase match, barge-in, sentence buffering, and turn-summarizing live in the separate [voice](../voice/overview.md) leaf; this engine only supplies the raw transcribe/segment/speak primitives the loop composes.
- **the always-on loop, microphone and speaker I/O, and the multi-turn state machine** — the [voice daemon app](../_apps/voice/overview.md) drives them (native audio via `node-cpal`, the browser/overlay handoff, the loopback channel).
- **resolving model file paths and the download step** — the app reads env (Zod-validated) and hands in resolved paths; the engine never reads env or knows where models are fetched from.
- **which speech models are chosen or pinned, and their on-disk files** — those are a deployment concern (a gitignored models directory + a fetch script), not this package's.
- **the brain turn itself** — this engine never calls Claude; it only produces and consumes audio around a turn someone else runs.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **PCM audio** | The lingua franca: mono samples in the −1…1 range plus the sample rate. Every contract speaks it, in and out. |
| **Voice engine (TTS)** | The speaking half — text in, spoken audio out at the model's native rate. |
| **Speech recognizer (STT)** | The listening half — one complete utterance in, text out; non-streaming, so it's given a whole segment. |
| **Voice-activity detector (VAD)** | The segmenter — a continuous 16 kHz stream in, closed utterances out (speech ended by silence). Trusts its configured rate; does not resample. |
| **Kokoro / vits** | The two text-to-speech model families the backend loads. Kokoro is multi-speaker (ships 11 voices); vits is single-voice. |
| **Moonshine** | The speech-to-text model family — the low-latency, realtime-on-CPU recognizer chosen over Whisper. |
| **silero-VAD** | The voice-activity model behind the segmenter. |
| **The native backend** | `sherpa-onnx-node` — the native ONNX addon (not the slower WASM build) that actually runs every model. Reached through one quarantined file. |
| **The fake** | A deterministic, model-free voice engine for consumers' tests — returns silence sized to the text and remembers what it was told to say. |

## Rules & invariants

- **Callers touch contracts, never the backend.** The whole point is a model-agnostic seam: consumers depend on the speak/listen/segment interfaces, and the swap from one backend to another never reaches their signatures.
- **The native addon is quarantined to one file.** The `sherpa-onnx-node` lib is imported in exactly one place — the anti-corruption boundary — because it is CommonJS with non-lexable named exports and throws under Node ESM unless loaded as a default import.
- **The engine never reads env or knows the download layout.** Model file paths are resolved by the app and handed in; the engine only loads what it's given.
- **A backend holds a model for its whole life.** Each speaking, listening, and segmenting object loads its ONNX model once at construction and reuses it — a genuinely stateful native resource, which is why these are classes where the rest of Vynel is functional.
- **Model work runs off the main thread.** Synthesis and transcription use the backend's async paths so a speech call never blocks the event loop that's also streaming audio.
- **The detector demands 16 kHz.** Unlike the recognizer, the segmenter trusts its configured rate and does not resample — feed it anything else and segmentation is wrong. Its internal buffer is sized longer than any single utterance so a long sentence is never dropped before the hard cap force-closes it.
- **Config mapping is pure and tested.** Translating Vynel's model configs into the backend's config shapes is done in pure functions, unit-tested without ever loading a native model; unset tuning knobs are omitted so the model's own defaults win.
- **The models themselves are live-smoke, not unit-tested.** The TypeScript side rides the normal test gate against the fake and the pure mappers; real voice quality, transcription accuracy, and segmentation sensitivity are verified by hand — inherent to audio ML.

## Where it sits in the bigger picture

Voice-engine is a pure leaf at the bottom of Vynel's voice stack: it depends on nothing inside Vynel — only the external native backend — and everything voice-related depends on it. Directly above sits the [voice](../voice/overview.md) leaf, which adds the model-free conversation logic (wake-phrase matching, turn-taking, barge-in, sentence buffering) that decides *when* to speak and listen. Above that, the [voice daemon app](../_apps/voice/overview.md) owns the always-on loop, the microphone and speaker, and the overlay handoff — it wires this engine's transcribe/segment/speak primitives to the [voice](../voice/overview.md) leaf's decisions and re-enters the brain through the existing chat-turn seam. This split is deliberate: keeping the native speech dependency isolated here preserves the [voice](../voice/overview.md) leaf's purity and lets an optional Python voice-cloning backend plug in later behind the same three contracts, without a rewrite reaching any consumer.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
