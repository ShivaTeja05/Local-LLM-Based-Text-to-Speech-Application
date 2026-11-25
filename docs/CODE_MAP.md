# Code map

Where each part of Ellie lives in the code. Use it to open the right file quickly in a demo or
review. Links go straight to the line.

Back to the [README](../README.md) · Design reasons: [ARCHITECTURE.md](ARCHITECTURE.md)

## Quick answers

| If someone asks… | Open this |
|---|---|
| **Where is the British persona prompt?** | [`backend/app/llm/prompt.py`](../backend/app/llm/prompt.py#L13) (`SYSTEM_PROMPT`; the one-line prompt for the fine-tune is [`SHORT_PROMPT`](../backend/app/llm/prompt.py#L29)) |
| **Where does the browser call the model?** | [`backend/app/api/chat.py`](../backend/app/api/chat.py#L54) (`POST /api/chat/stream`) |
| **How do you talk to the local LLM?** | [`backend/app/llm/ollama_adapter.py`](../backend/app/llm/ollama_adapter.py#L45) (`stream_chat`; settings such as `num_ctx` and `keep_alive` at [line 27](../backend/app/llm/ollama_adapter.py#L27)) |
| **How is the reply streamed to the browser?** | Server: [`_sse` in chat.py](../backend/app/api/chat.py#L40). Browser: [`frontend/src/app/core/sse-parser.ts`](../frontend/src/app/core/sse-parser.ts#L13) |
| **How do you trim long conversations?** | [`backend/app/llm/context.py`](../backend/app/llm/context.py#L76) (`build_messages`; drops whole turns in blocks of six) |
| **How does the memory note work?** | Server: [`backend/app/api/memory.py`](../backend/app/api/memory.py#L18) and [`backend/app/llm/memory.py`](../backend/app/llm/memory.py#L15). Browser: [`remember` in conversation.service.ts](../frontend/src/app/core/conversation.service.ts#L96) |
| **Where is text turned into speech?** | [`backend/app/api/tts.py`](../backend/app/api/tts.py#L18) → [`backend/app/tts/piper_engine.py`](../backend/app/tts/piper_engine.py#L133) (`synthesize`) |
| **Where are the five British voices chosen?** | [`REGIONAL` in piper_engine.py](../backend/app/tts/piper_engine.py#L35) |
| **How are numbers, £ and dates read aloud?** | [`backend/app/tts/normalise.py`](../backend/app/tts/normalise.py#L51) |
| **How does speech start before the reply is finished?** | [`frontend/src/app/core/sentence-splitter.ts`](../frontend/src/app/core/sentence-splitter.ts#L58), used in [`send` in conversation.service.ts](../frontend/src/app/core/conversation.service.ts#L51) |
| **How is the audio played, with pauses?** | [`frontend/src/app/core/audio-player.service.ts`](../frontend/src/app/core/audio-player.service.ts#L81) (pause lengths: [`pauseAfter`](../frontend/src/app/core/audio-player.service.ts#L21)) |
| **How does the avatar lip-sync?** | Loudness: [`AnalyserNode` in audio-player.service.ts](../frontend/src/app/core/audio-player.service.ts#L111). Mouth: [`frontend/src/app/ui/avatar.ts`](../frontend/src/app/ui/avatar.ts#L100) |
| **How does the avatar pick a mood or gesture?** | [`frontend/src/app/ui/gesture.ts`](../frontend/src/app/ui/gesture.ts#L51) and [`frontend/src/app/core/expression.ts`](../frontend/src/app/core/expression.ts#L7) |
| **Where are the play button and speech switch?** | [`frontend/src/app/ui/conversation.html`](../frontend/src/app/ui/conversation.html) and [`frontend/src/app/ui/settings-panel.html`](../frontend/src/app/ui/settings-panel.html) |
| **How does voice input work?** | Browser: [`voice-input.service.ts`](../frontend/src/app/core/voice-input.service.ts#L15). Server: [`backend/app/api/stt.py`](../backend/app/api/stt.py#L16) → [`whisper_engine.py`](../backend/app/stt/whisper_engine.py#L13) |
| **How does "Use my voice" work?** | [`backend/app/voiceclone/cloner.py`](../backend/app/voiceclone/cloner.py#L89) and [`backend/app/api/my_voice.py`](../backend/app/api/my_voice.py#L20) |
| **Where is the conversation stored?** | Only in the browser: [`frontend/src/app/core/local-db.service.ts`](../frontend/src/app/core/local-db.service.ts#L30) (IndexedDB, 30-day retention) |
| **Where are the rate limits and security headers?** | [`backend/app/protection.py`](../backend/app/protection.py#L22) |
| **Where is the app started and wired together?** | [`backend/app/main.py`](../backend/app/main.py#L104) (`create_app`) |
| **Where are the settings?** | [`backend/app/config.py`](../backend/app/config.py) and [`.env.example`](../.env.example) |
| **How was the fine-tune data built?** | [`training/data/build_dataset.py`](../training/data/build_dataset.py) |
| **Where is the training script?** | [`training/kaggle/kernel/train.py`](../training/kaggle/kernel/train.py) |
| **How do you score the model?** | [`training/eval/score.py`](../training/eval/score.py) and [`training/eval/run_eval.py`](../training/eval/run_eval.py) |
| **Where is the BNC2014 comparison?** | [`research/britishness.py`](../research/britishness.py) and [`research/README.md`](../research/README.md) |
| **How is it deployed?** | [`deploy/cloudrun/Dockerfile`](../deploy/cloudrun/Dockerfile) and [`deploy/cloudrun/start.sh`](../deploy/cloudrun/start.sh); local: [`docker-compose.yml`](../docker-compose.yml) |
| **Where is CI?** | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |

## One chat turn, file by file

1. You type a message: [`ui/conversation.ts`](../frontend/src/app/ui/conversation.ts#L34) calls
   [`ConversationService.send`](../frontend/src/app/core/conversation.service.ts#L51).
2. The browser posts the conversation: [`ApiService`](../frontend/src/app/core/api.service.ts#L21) →
   [`POST /api/chat/stream`](../backend/app/api/chat.py#L54).
3. The backend trims the history and adds the persona:
   [`build_messages`](../backend/app/llm/context.py#L76) + [`pinned_messages`](../backend/app/llm/prompt.py#L34).
4. Ollama writes the reply: [`OllamaAdapter.stream_chat`](../backend/app/llm/ollama_adapter.py#L45).
5. Words stream back over SSE and appear on screen: [`SseParser.feed`](../frontend/src/app/core/sse-parser.ts#L16).
6. Each finished sentence is cut off: [`SentenceSplitter.push`](../frontend/src/app/core/sentence-splitter.ts#L78).
7. The sentence is spoken: [`ApiService.tts`](../frontend/src/app/core/api.service.ts#L31) →
   [`POST /api/tts`](../backend/app/api/tts.py#L18) → [`PiperEngine.synthesize`](../backend/app/tts/piper_engine.py#L133).
8. The audio plays and drives the mouth: [`AudioPlayerService.enqueue`](../frontend/src/app/core/audio-player.service.ts#L126) →
   [`Avatar`](../frontend/src/app/ui/avatar.ts#L42).
9. If old turns were dropped, a memory note is made in the background:
   [`POST /api/memory`](../backend/app/api/memory.py#L18).

## Folders

| Folder | What is in it |
|---|---|
| [`frontend/src/app/ui/`](../frontend/src/app/ui/) | What you see: chat page, avatar, settings panel, model comparison |
| [`frontend/src/app/core/`](../frontend/src/app/core/) | Logic behind the screen: API calls, streaming, sentence splitting, audio, local database |
| [`frontend/e2e/`](../frontend/e2e/) | Browser tests (Playwright) |
| [`backend/app/api/`](../backend/app/api/) | The HTTP endpoints, one file each |
| [`backend/app/llm/`](../backend/app/llm/) | Prompt, context trimming, memory note, Ollama client |
| [`backend/app/tts/`](../backend/app/tts/) | Text-to-speech: Piper, optional Kokoro, text clean-up |
| [`backend/app/stt/`](../backend/app/stt/) | Speech-to-text (Whisper) |
| [`backend/app/voiceclone/`](../backend/app/voiceclone/) | "Use my voice" (OpenVoice v2 converter) |
| [`backend/tests/`](../backend/tests/) | Backend tests (pytest) |
| [`training/`](../training/) | Fine-tuning: dataset, training, evaluation, results |
| [`research/`](../research/) | Comparison with the Spoken BNC2014 |
| [`deploy/`](../deploy/) | Cloud Run deployment |
| [`docs/`](./) | Architecture, install, deployment, security, privacy |

## Which test proves what

| Claim | Test |
|---|---|
| The brief's "How are you?" example is written, spoken and lip-synced | [`frontend/e2e/app.spec.ts`](../frontend/e2e/app.spec.ts) |
| Replay uses cached audio; speech can be switched off | [`frontend/e2e/app.spec.ts`](../frontend/e2e/app.spec.ts) |
| Speech starts before the reply is finished | [`frontend/e2e/early-speech.spec.ts`](../frontend/e2e/early-speech.spec.ts) |
| Natural pauses between sentences | [`frontend/e2e/pauses.spec.ts`](../frontend/e2e/pauses.spec.ts) |
| Trimming keeps the persona and whole turns | [`backend/tests/test_context.py`](../backend/tests/test_context.py) |
| The memory note keeps facts from dropped turns | [`backend/tests/test_e2e.py`](../backend/tests/test_e2e.py) (real model, after 70 filler turns) and [`backend/tests/test_memory.py`](../backend/tests/test_memory.py) |
| Real model → API → Piper → WAV works end to end | [`backend/tests/test_e2e.py`](../backend/tests/test_e2e.py) |
| Rate limits and security headers | [`backend/tests/test_protection.py`](../backend/tests/test_protection.py) |
| Every voice loads and speaks | [`backend/tests/test_piper_engine.py`](../backend/tests/test_piper_engine.py) |
