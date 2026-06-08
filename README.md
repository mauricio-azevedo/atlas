# Atlas

Atlas turns GitHub pull requests into concise project briefs.

The first product wedge is intentionally narrow:

> Given a repository and pull request number, explain what changed, what was validated, what remains uncertain, and what should happen next.

Atlas is not a dashboard, chat app, workspace, or autonomous agent yet. It starts as a reliable PR-to-brief generator.

## What Atlas does today

Atlas reads:

- GitHub pull request metadata
- changed files
- GitHub Actions workflow runs for the PR head commit
- optional manual validation signals

Then it emits either:

- a human-readable Markdown brief
- a structured JSON brief for downstream product layers

Atlas can print briefs to stdout or write them to files.

## Install

```bash
npm install
```

## Generate a Markdown brief

```bash
npm run brief -- owner/repo 123
```

Example:

```bash
npm run brief -- mauricio-azevedo/beachrank 88
```

## Generate JSON

```bash
npm run brief -- owner/repo 123 --format json
```

Markdown is the default:

```bash
npm run brief -- owner/repo 123 --format markdown
```

## Write a brief to a file

```bash
npm run brief -- owner/repo 123 --output briefs/pr-123.md
```

JSON output can also be written to a file:

```bash
npm run brief -- owner/repo 123 --format json --output briefs/pr-123.json
```

Atlas creates parent directories for the output path when needed.

## Private repositories and rate limits

For private repositories, or to avoid low unauthenticated API limits, set `GITHUB_TOKEN` in your shell before running Atlas.

## Manual validation signals

Atlas can ingest validation facts that GitHub cannot know, such as local build results, visual smoke tests, QA notes, or known baseline debt.

```bash
npm run brief -- owner/repo 123 --validation validation.json
```

Validation file shape:

```json
[
  {
    "label": "web build",
    "status": "passed",
    "summary": "The web build passed locally."
  },
  {
    "label": "web lint",
    "status": "failed",
    "summary": "Lint fails on this branch, but the same failures exist on main.",
    "isBaselineFailure": true
  }
]
```

Supported statuses:

- `passed`
- `failed`
- `neutral`
- `unknown`

Use `isBaselineFailure: true` when a failed signal is known repository debt rather than a regression introduced by the PR.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Current status logic

Atlas classifies a PR as:

- `blocked` when GitHub reports it as unmergeable or it is closed without merge
- `attention` when it is draft, too large, or has a non-baseline failed validation signal
- `ready` when no blocking or attention signal is detected

This is intentionally conservative. Atlas should surface risk and uncertainty, not pretend to replace human review.
