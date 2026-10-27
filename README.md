# TutorDesk

AI lesson-prep workbench for IELTS and PTE tutors. Product spec: [SPEC.md](SPEC.md) and the appendices in [spec/](spec/).

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron app: main process (IPC, services), sandboxed preload, React renderer |
| `packages/core` | Zod schemas (students, lessons, submissions, artifacts), workspace service, path jail, locks, git history |
| `packages/providers` | Agent provider contract; `ClaudeCliProvider` (local `claude -p`, your subscription) and `ApiProvider` (OpenRouter, Anthropic, OpenAI, OpenAI-compatible via the Vercel AI SDK); `runStructured` with repair loop |
| `packages/render` | Artifact JSON → LaTeX using only the semantic macros (handout, worksheet, script, Beamer deck) |
| `packages/pipeline` | `ArtifactStudio` (render, check, compile, save, export: no model), the API-mode lesson pipeline, writing review, exam knowledge, rubrics, eval harness |
| `packages/toolbox` | The `tutordesk` MCP server: teaching tools agents call (student context, plan cards, artifacts with checks and typesetting, essay reviews, materials), plus the generated `AGENTS.md` and skills ([appendix E](spec/agent-harness.md)) |
| `packages/harness` | Chat sessions with local agents: Claude Code (Agent SDK), Codex (`codex app-server`), OpenCode (ACP); permission modes, approvals, thread store |
| `packages/tex` | Local TeX detection, sandboxed XeLaTeX compile, log parser, LaTeX escaping |
| `packages/ui` | Design tokens (light/dark) and UI primitives |
| `workspace-template/` | Copied into each new workspace: LaTeX classes, Beamer themes, fonts, samples |
| `prototypes/` | Original LaTeX and Beamer design prototypes |

## Setup

```bash
pnpm install
```

Requirements: Node 24+, pnpm 11, TeX Live (or MiKTeX) with `xelatex` and `latexmk`. The desktop package's postinstall downloads the Electron binary.

## Run

```bash
pnpm dev
```

In the app, open **Settings → AI connection**, choose **API key**, pick a service (OpenRouter by default), paste your key and press **Check connection**. Model ids per tier can be edited there. The key is stored encrypted with the OS keychain. Alternatively set `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) before starting the app.

Flow: **Students → add a student → New lesson → open it → Draft plan card → edit stages → Approve and prepare materials**. Each document gets checked, compiled, reviewed against a rubric and revised up to twice; anything still failing is marked "Needs your review". Essays: **Writing → Paste text** (or **From photo…**) → **Review essay** → set your final bands → save.

`TUTORDESK_WORKSPACE=<dir>` points the app at a scratch workspace instead of `Documents/TutorDesk`.

## Use the toolbox from your own agent

TutorDesk's tools work in a plain Claude Code or Codex session too, without the app:

```bash
pnpm mcp:build
```

```bash
node packages/toolbox/dist/tutordesk-mcp.mjs --workspace <workspace> --write-kit
```

```bash
claude mcp add tutordesk -- node <repo>/packages/toolbox/dist/tutordesk-mcp.mjs --workspace <workspace> --by claude-code
```

One real turn per agent on your own subscription (cheap models by default: haiku, gpt-6-luna), after `pnpm mcp:build`:

```bash
TUTORDESK_LIVE_HARNESS=claude-code,codex pnpm vitest run packages/harness/test/live-harness.test.ts
```

For Codex, add `[mcp_servers.tutordesk]` with the same command and args to `~/.codex/config.toml`. Then start the agent in the workspace folder and ask it to prepare a lesson. Plan cards still need your approval in the app (or `--require-plan-approval false` while testing).

## Test

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm smoke:full
```

`pnpm smoke:full` builds the app and drives it end to end with a fake AI (fixture documents, real LaTeX): student, lesson, plan, approval, all four documents with QA and compile, PDF previews, essay review, finalise, settings, dark mode. Screenshots and `report.json` land in `.tutordesk-dev/smoke-full/`. `pnpm smoke` runs the shorter flow without AI.

## Evaluate quality with a real model

Spends API credit (roughly a few dollars for all personas with the default models):

```bash
OPENROUTER_API_KEY=sk-or-... pnpm eval
```

Runs the full pipeline for four personas from spec appendix A.4 (golden IELTS student, weak adult GT, band-7 writer, PTE 79) plus an essay review against expected bands, and writes `eval-results/<timestamp>/summary.md`, QA reports and teacher-edition PDFs. Narrow it with `TUTORDESK_EVAL_PERSONAS=P01` and `TUTORDESK_EVAL_KINDS=handout,worksheet`; use `TUTORDESK_EVAL_GATEWAY=anthropic` or `TUTORDESK_EVAL_BACKEND=claude-cli` to switch backends.
