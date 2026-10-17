# ViralClips

Local, Opus Clip–style app: give it a long video, it transcribes locally, an LLM picks the best
short-form moments, you review/trim, and it exports captioned 9:16 MP4s. Everything runs on your Mac.

## Prerequisites (one time)

```bash
brew install ffmpeg whisper-cpp
mkdir -p data/models && curl -L -o data/models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
ollama pull qwen2.5:14b      # or any model you like; pick it in Settings
```

The app's **Setup** page checks all of this and shows the exact fix for anything missing.

## Run

```bash
npm install
npm run dev            # server :4777 + UI http://localhost:5173
# or production-style:
npm run build && npm start   # http://127.0.0.1:4777
```

## Using it

1. **Projects** → drop a video (or paste a local path — big files are used in place, not copied).
2. **Find best clips** → transcribe + AI analysis with live progress.
3. Review ranked clips: preview, drag trim handles, edit titles, tick the ones to export.
4. **Export** → 1080×1920 MP4s (center-crop / blurred-background / bars; word-highlight captions) in `data/exports/`.

## AI providers

- **Ollama** (default): local, free, private.
- **OpenAI**: add an API key in Settings. Only transcript text is sent, never video. (ChatGPT OAuth isn't offered: OpenAI has no public third-party OAuth.)

## Dev

`npm test` runs server + web tests. Design: `docs/superpowers/specs/`, plan: `docs/superpowers/plans/`.
