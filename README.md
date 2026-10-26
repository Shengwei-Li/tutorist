# TutorDesk

AI lesson-prep workbench for IELTS and PTE tutors. Product spec: [SPEC.md](SPEC.md) and the appendices in [spec/](spec/).

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron app: main process (IPC, services), sandboxed preload, React renderer |
| `packages/core` | Zod schemas, workspace service (student folders, lessons, error log, git history), path jail, locks |
| `packages/providers` | Agent provider contract and `ClaudeCliProvider` (`claude -p` stream-json, `runStructured` with repair loop) |
| `packages/tex` | Local TeX detection, sandboxed XeLaTeX compile, log parser, LaTeX escaping |
| `packages/ui` | Design tokens (light/dark) and UI primitives |
| `workspace-template/` | Copied into each new workspace: LaTeX classes, Beamer themes, fonts, samples |
| `prototypes/` | Original LaTeX and Beamer design prototypes |

## Setup

```bash
pnpm install
```

The desktop package's postinstall downloads the Electron binary. Requirements: Node 24+, pnpm 11, a TeX Live (or MiKTeX) install with `xelatex` and `latexmk`, and Claude Code signed in with `claude auth login`.

## Run

```bash
pnpm dev
```

`TUTORDESK_WORKSPACE=<dir>` points the app at a scratch workspace instead of `Documents/TutorDesk`.

## Test

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm smoke
```

`pnpm smoke` builds the app, drives it through its UI (add student, add lesson, check connections, compile a handout and a deck, dark mode) and writes screenshots plus `report.json` to `.tutordesk-dev/smoke/`.

To also run the live Claude Code test (uses your subscription, a few cents of usage):

```bash
TUTORDESK_LIVE=1 pnpm test
```
