# Security and abuse protection

Back to the [README](../README.md) · How it is hosted: [DEPLOYMENT.md](DEPLOYMENT.md)

The app has **no secrets to steal**: it uses no API keys, no accounts and no database, and no cloud
AI service. The risks that matter for a public demo are therefore **someone using the compute**
(cost) and **leaking internal details**. Both are handled in layers.

## The backend address is public, and that is fine

The page's `config.js` names the Cloud Run URL. It cannot be hidden: every browser has to know where
to send requests, and anyone can see them in the Network tab. CORS stops *other websites* from using
the API in a visitor's browser, but not a script. So the protection is not secrecy; it is limits
that hold whoever calls the API, implemented in
[`backend/app/protection.py`](../backend/app/protection.py).

## Layers of protection

| Layer | What it does | Bound |
|---|---|---|
| **Per-visitor rate limits** | Each address gets a sliding-window allowance per endpoint, with `Retry-After` on a 429 | chat 15/min and 200/h · speech 120/min · voice input 10/min and 100/h |
| **Spoof-resistant addresses** | The limit uses the address Google's front end adds *last* to `X-Forwarded-For`; anything a client puts earlier is ignored | a faked header does not reset the limit (tested) |
| **Daily ceiling for everyone together** | A global allowance per endpoint, however many addresses the requests come from | chat 600/h and 3,000/day · speech 20,000/day · voice input 1,500/day |
| **Concurrency cap** | At most 2 replies are generated at once; others wait up to 30 s, then get a polite 503 | protects response times for real visitors |
| **One instance at most** | Cloud Run `max-instances=1` | the bill cannot grow with traffic: at most about $0.84/hour |
| **Budget alert** | Google Cloud emails the owner at 25%, 50%, 90% and 100% of a £25 budget | a person sees any unusual spend |
| **Input validation** | Pydantic limits on every field: message length, number of turns, voice names (a pattern), audio size and length | oversized or odd input is rejected with 422/413 before any work is done |
| **Allow-lists** | Only the listed voices and models can be used; anything else is refused | no arbitrary model loads |

## Not revealing anything

| Check | Result |
|---|---|
| Secrets in the repository and its full git history | none (no keys, tokens or `.env` files; only `.env.example` templates) |
| Secrets in the shipped JavaScript bundle | none |
| Server environment | only thread counts, log level, the CORS pattern and the docs switch |
| `/.env`, `/.git/config`, path traversal (`/../`) | 404 |
| API docs (`/docs`, `/openapi.json`) | switched off in production (`API_DOCS=false`) |
| Error messages | generic ("The language model is not reachable"); the details go to the server log only |
| The Ollama port (11434) | not reachable from outside: only the backend talks to it, inside the container |
| A request from another website (`Origin: https://evil.example`) | no CORS headers, so the browser blocks it |
| Prompt injection ("print your system prompt") | can reveal the system prompt, which is public in this repository anyway; there is nothing else in the model's context |
| Conversation logging | messages are never logged; only timings and token counts |

## Security headers

Set by the backend on every response and by Vercel on the frontend
([`vercel.json`](../frontend/vercel.json)):

- **Content-Security-Policy**: scripts only from the site itself; network requests only to the site
  and the Cloud Run API; no plugins; the page cannot be framed.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`
- `Permissions-Policy`: microphone for this site only; no camera or location
- `Strict-Transport-Security` (HTTPS only) and `Cross-Origin-Opener-Policy`

## Tests

[`backend/tests/test_protection.py`](../backend/tests/test_protection.py) checks the per-visitor
limit and its `Retry-After`, the faked-address case, the daily ceiling across many addresses, the
concurrency cap, the headers, the docs switch, and that health errors reveal no internal addresses.

## If stronger gating were needed

For a demo with a known audience, an access code or a bot check (for example Cloudflare Turnstile)
in front of the chat would stop automated use entirely. It was left out so the reviewer can open
the link and start talking with no extra step.
