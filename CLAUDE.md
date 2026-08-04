# CLAUDE.md

This repository uses **`AGENTS.md`** as the single source of truth for AI coding
assistant instructions (it is shared by Cursor, OpenAI Codex, and Claude Code).

**Read [`AGENTS.md`](./AGENTS.md) first** — it documents how to run, build, lint,
and test this project, plus the non-obvious caveats.

Key reminders (see `AGENTS.md` for full detail):

- This repo is a **static site + Node build/test tooling**. There is no backend
  server and no `npm run dev`; serve the static files with `python3 -m http.server 8080`.
- `mrb/inspection/recording-assistant.js` is a **built file — do not edit it directly.**
  Edit `tools/recording-assistant/src/` and rebuild with `npm run build:ra`.
- `npm test` builds the Recording Assistant then runs the full Node test harness
  (this is the lint + test gate). CI also enforces
  `git diff --exit-code mrb/inspection/recording-assistant.js`, so commit the rebuilt
  output whenever you change the source.
- The overlay PNG golden-snapshot tests need IBM Plex fonts installed
  (`sudo apt-get install -y fonts-ibm-plex`).
