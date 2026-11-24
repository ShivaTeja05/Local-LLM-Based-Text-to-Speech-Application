# How British is Ellie? A comparison with the Spoken BNC2014

Back to the [README](../README.md) · Script: [`britishness.py`](britishness.py) · Numbers:
[`results/britishness.json`](results/britishness.json)

Asking a model to "speak British English" is easy; checking that it does is harder. This note
measures Ellie's replies against **real British conversation**: the **Spoken BNC2014**, about
10.3 million words (by our tokenisation) of informal conversation recorded across the UK in
2012–16 (Love, Dembry, Hardie, Brezina & McEnery 2017).

## Data

| Sample | What | Words | Replies / turns |
|---|---|---|---|
| **Spoken BNC2014** | 1,251 recorded conversations, 1.18 million turns | 10,267,222 | 1,177,516 |
| `base-short` | `llama3.2:3b` with a one-line prompt (no fine-tune) | 10,695 | 120 |
| `base-full` | `llama3.2:3b` with the full style prompt (**the live app**) | 5,333 | 120 |
| `tuned-short` | **`ellie-british` LoRA fine-tune** with a one-line prompt | 4,175 | 120 |
| `teacher-full` | `qwen3.5:35b` with the full prompt (wrote the fine-tune's training data) | 4,507 | 120 |

The model samples are the replies to the 40 evaluation prompts × 3 samples from
[`training/eval`](../training/eval/), so all four setups answered exactly the same questions.

## Method

Each text is lower-cased and tokenised the same way. In the corpus, names (anonymised), laughter,
pauses and truncated words are removed first.

1. **Britishness index.** 56 British/American pairs that are unambiguous in conversation: spelling
   (colour/color, favourite/favorite, realise/realize, grey/gray…) and vocabulary (holiday/vacation,
   mum/mom, rubbish/trash, biscuit/cookie, film/movie…). Index = British forms ÷ all variant forms.
2. **Conversational features per 10,000 words**, compared with the corpus using **Log Ratio**
   (Hardie 2014: the binary log of the ratio of relative frequencies, so +1 = twice as frequent,
   −1 = half) for effect size, and **log-likelihood (G²)** for significance: \* p < .05 (3.84),
   \*\* p < .01 (6.63), \*\*\* p < .001 (10.83).
3. **Keywords**: the words each setup over- and under-uses relative to the corpus (G², |LR| > 1,
   minimum frequency 5).
4. **Turn length**: words per reply against words per conversational turn.

## Results

### 1. Spelling and vocabulary: the fine-tune is fully British

| Sample | British forms | American forms | **Britishness index** |
|---|---|---|---|
| Base model, one-line prompt | 36 | 11 (favorite, jewelry, cozy, colors, flavors) | **0.77** |
| Base model, full prompt (live app) | 45 | 1 (cozy) | 0.98 |
| **Fine-tune, one-line prompt** | 28 | 0 | **1.00** |
| Teacher | 21 | 0 | 1.00 |
| *Spoken BNC2014* | *23,315* | *1,375 (movie, realize, cookie, truck, candy…)* | *0.94* |

The fine-tune removes every Americanism the base model makes when it is not given a long prompt.
It is even "more British than the British": real speakers say *movie*, *cookie* and *truck*, and
the corpus transcriptions sometimes use *-ize* spellings.

### 2. But the *style* is not yet everyday British talk

Rates per 10,000 words (count in brackets), with Log Ratio against the corpus:

| Feature | Spoken BNC2014 | Live app (`base-full`) | Fine-tune (`tuned-short`) |
|---|---|---|---|
| *lovely* | 3.9 | 31.9 (17), LR **+3.1**\*\*\* | 91.0 (38), LR **+4.6**\*\*\* |
| *brilliant* | 1.5 | 50.6 (27), LR **+5.1**\*\*\* | 26.3 (11), LR **+4.2**\*\*\* |
| *mate* | 1.3 | 11.3 (6), LR +3.1\*\*\* | 0 |
| *cheers* / *cuppa* | 0.4 / 0.04 | 7.5 / 1.9 | 0 / 0 |
| *a bit* | 14.5 | 41.3 (22), LR +1.5\*\*\* | 4.8 (2) |
| *yeah* | **253.3** | 0, LR −8.1\*\*\* | 0, LR −7.7\*\*\* |
| *you know* | 44.6 | 0\*\*\* | 9.6 (4), LR −2.2\*\*\* |
| *I mean* | 18.9 | 0\*\*\* | 0\*\*\* |
| *I think* | 34.4 | 22.5 (12) | 2.4 (1), LR −3.8\*\*\* |
| tag questions (*isn't it?*, *don't you?*) | 23.5 | 37.5 (20) | 2.4 (1), LR −3.3\*\*\* |
| *erm / er / um* | 120.7 | 0\*\*\* | 0\*\*\* |

### 3. What each setup over- and under-uses (keywords against the corpus)

- **Fine-tune overuses:** *ai* (LR +13.9: "since I'm an AI", in 19 of 120 replies), *specific*,
  *personal*, *access*, *news*, *check*, *tips*, *chat*, *asking*, *lovely*, *favourite*: the
  vocabulary of an assistant explaining what it can and cannot do.
- **Live app overuses:** *favourite*, *brilliant*, *chat*, *plans*, *experiences*, *how's*.
- **Both under-use:** *yeah*, *oh*, *mm*, *erm*, *cos*, and the third-person pronouns *he*, *she*,
  *they* with past-tense *was*: the backchannels and storytelling that make up much of real
  conversation.

### 4. Turn length

| | Words per turn (mean / median) |
|---|---|
| Spoken BNC2014 | 8.7 / 5 |
| Fine-tune | 34.8 / 35 |
| Live app | 44.4 / 41.5 |
| Base, one-line prompt | 89.1 / 88 |

## What this tells us

1. **Spelling and vocabulary are solved.** With the fine-tune, a one-line prompt is enough for
   fully British spelling and word choice (index 0.77 → 1.00).
2. **Ellie performs Britishness rather than speaking like a British person.** She uses *lovely*
   23 times and *brilliant* up to 34 times as often as real speakers: a tourist-brochure picture of
   British English. The prompt-only model adds stereotypes (*mate*, *cheers*, *cuppa*); the
   fine-tune drops those but leans harder on *lovely*.
3. **She lacks the interactional texture of real talk:** almost no *yeah*, *you know*, *I mean*, or
   tag questions, no backchannels, and turns four to seven times longer than a typical turn.
   Some of this is right for the role (an assistant answering a question is not a friend chatting,
   and filled pauses are odd in synthesised speech). Some is not: tag questions and *you know*
   would make her sound more natural.
4. **The fine-tune traded one habit for another.** It stopped inventing a life (the goal), but by
   saying "since I'm an AI" in 16% of replies, which a corpus comparison spots immediately.

## Next steps this suggests

- **Use the corpus as the target, not intuition.** Score candidate training replies by how close
  their feature rates are to the Spoken BNC2014 (e.g. penalise *lovely* above a few per 10k, reward
  tag questions and *you know*), and keep the closest. The same script measures the result.
- **Shorter turns.** Aim nearer the corpus: one or two sentences unless asked for more.
- **Vary the boundary phrasing** so "since I'm an AI" stops being formulaic.
- **Regional variation.** Speaker metadata (dialect region) would allow comparing, say, the North
  and the South-West, to match the five regional voices with regional language, not just accent.

## Limitations

- The model samples are small (4–11 thousand words), so rare features have wide uncertainty; the
  table gives counts so this is visible, and the significance markers account for it.
- The corpus is peer conversation; Ellie is an assistant answering prompts. The comparison shows
  how *conversational* she sounds, not whether she does her job.
- The corpus is a transcription, whose conventions (e.g. *erm*, *cos*) differ from writing.

## Licence and reproduction

The Spoken BNC2014 is free for non-commercial research but must not be redistributed or stored in a
cloud service. It is therefore **not in this repository**: register and download it from
[corpora.lancs.ac.uk/bnc2014](https://corpora.lancs.ac.uk/bnc2014/signup.php), unzip it into
`research/data/` (git-ignored), and run:

```bash
python3 research/britishness.py
```

Only aggregate statistics are published here.

**Reference:** Love, R., Dembry, C., Hardie, A., Brezina, V., & McEnery, T. (2017). The Spoken
BNC2014: Designing and building a spoken corpus of everyday conversations. *International Journal
of Corpus Linguistics*, 22(3), 319–344.

Hardie, A. (2014). Log Ratio: an informal introduction. Lancaster University, ESRC Centre for
Corpus Approaches to Social Science (CASS).
