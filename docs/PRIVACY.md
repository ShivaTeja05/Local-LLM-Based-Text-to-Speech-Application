# Privacy: what Ellie stores, where, and how it is deleted

Back to the [README](../README.md) · Related: [SECURITY.md](SECURITY.md)

**In one sentence:** everything Ellie remembers about you lives in a small database **in your own
browser**; the server answers each request and keeps nothing about you once it is done.

## Where each piece of data lives

| Data | Where | How long | How it is deleted |
|---|---|---|---|
| **The conversation** (your messages and Ellie's replies) | Your browser: IndexedDB database `ellie`, record `conversation` | Until you delete it, or 30 days unused | **New conversation**, or **Your data → Delete**; automatically after 30 days unused |
| **Memory note** (a summary of the early part of a long chat) | Your browser: record `memory` | With the conversation | Deleted together with the conversation |
| **My voice** (a 256-number voice fingerprint) | Your browser: record `my-voice` | Until you delete it, or 30 days unused | **✕** beside My voice, or **Your data → Delete** |
| **Your voice recording** (Use my voice) | Nowhere | Never stored: read once to make the fingerprint, then discarded | Nothing to delete |
| **Preferences** (voice, theme, speech switches) | Your browser: localStorage `ellie.settings.v1` | Until reset | **Your data → Reset** |
| **Push-to-talk recordings** | Nowhere | Transcribed, then discarded | Nothing to delete |

**Delete everything** (two clicks, in Your data) removes all of the above at once. Clearing the
browser's site data for Ellie does the same.

## What the server sees, and for how long

The backend is **stateless**: the browser sends the conversation with each request, and nothing is
written to a database or to disk.

| What | Where | How long |
|---|---|---|
| Your messages, while a reply is being written | Server memory (and the model's prompt cache) | Until the instance stops: Cloud Run shuts it down after a quiet spell (up to ~15 minutes) |
| Recent sentences turned into speech | An in-memory speech cache (last 256 sentences), so replays are instant | Same: gone when the instance stops |
| Rate-limit counters (your IP address and request times) | Server memory | At most 24 hours, and gone when the instance stops |
| Request logs: time, endpoint, status, duration, IP address, browser type | Google Cloud Logging (Google Cloud's standard request log for the service) | 30 days (the project's log retention), then deleted automatically |
| App logs: timings and counts only (e.g. `chat turns=4 total_ms=2100`, `my-voice speech_s=11.2`) | Google Cloud Logging | 30 days |

**Never logged or stored by the server:** message text, replies, voice recordings or voice
fingerprints.

## Why it is built this way

- **Local first.** The brief asks for a local model and local speech; keeping your data on your own
  device follows the same idea. A server-side database would mean holding personal data (and
  voice data, which can be biometric) on a cloud server for no benefit.
- **Nothing to leak.** With no server database there is nothing to breach, back up or forget to
  delete.
- **Easy to inspect.** Anyone can open the browser's developer tools (Application → IndexedDB →
  `ellie`) and see exactly what is kept.

## In code

- Browser database: [`frontend/src/app/core/local-db.service.ts`](../frontend/src/app/core/local-db.service.ts)
  (one store, a last-written time on every record, 30-day expiry on start-up, per-item and full
  deletion; a localStorage fallback where IndexedDB is blocked).
- Your data panel: [`frontend/src/app/ui/settings-panel.html`](../frontend/src/app/ui/settings-panel.html).
- Use my voice (nothing stored on the server): [`backend/app/voiceclone/cloner.py`](../backend/app/voiceclone/cloner.py).
- Tests: `local-db.service.spec.ts` (storage, deletion, expiry) and `e2e/your-data.spec.ts` (the
  real IndexedDB in Chrome: stored, survives a reload, deleted).
