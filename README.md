# Love Matching Pipeline (AI SDK)

A starter "Ditto-style" matching pipeline using Vercel AI SDK + Anthropic:

- Parse and validate profile input.
- Apply deterministic rule checks (deal-breakers and overlap boost).
- Use an LLM for structured compatibility scoring.
- Rank candidates and return top K.

## 1) Setup

```bash
npm install
cp .env.example .env
```

Set your key in `.env`:

```bash
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-3-5-sonnet-latest
```

## 2) Run

```bash
npm run start
```

Optional custom inputs:

```bash
npm run start -- --seeker data/seeker.json --candidates data/candidates.json --top 3
```

## 3) Output

The CLI prints ranked JSON with:

- `score.compatibilityScore`: model score (0-100)
- `blockedByDealBreaker`: hard-filter state
- `hardFilterReasons`: triggered reasons
- `finalScore`: model score adjusted by deterministic boost

## 4) Project structure

- `src/types.ts`: schemas and types
- `src/pipeline.ts`: core matching pipeline
- `src/index.ts`: CLI entrypoint
- `data/*.json`: sample inputs
# cuddly
