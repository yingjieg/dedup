# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-purpose web tool for cleaning up duplicate files reported by [`fclones`](https://github.com/pkolaczk/fclones). You upload an fclones group report, review the duplicate groups in the browser, check the copies you want to remove, and the backend runs `rm` on the selected paths. UI text is in Chinese.

## Commands

```bash
npm install      # install express (only dependency)
npm start        # start server on http://localhost:3000
```

There are no tests, linter, or build step.

## Architecture

Two files hold all the logic:

- **`server.js`** — Express server. Serves the current directory as static files (so `index.html` is the landing page) and exposes a single endpoint `POST /api/delete-files` that takes `{ files: string[] }` and shells out to `rm` via `child_process.exec`. Returns `{ success, deletedCount, message }`.
- **`index.html`** — self-contained frontend (inline CSS + vanilla JS in one IIFE, no framework, no bundler). It parses the fclones report client-side, renders duplicate groups with per-file checkboxes, and calls the delete endpoint. All state lives in two in-memory variables: `groups` (`[{hash, size, paths}]`) and `checkedState` (a `Map<path, boolean>`).

`sample.txt` is an example fclones report for manual testing.

### Data flow
1. User uploads a report → `parseFclonesText()` splits it into groups by matching header lines of the form `hash, size * count:` followed by indented file paths.
2. Selected paths POST to `/api/delete-files`; the server builds `rm "path1" "path2" ...` and executes it.
3. On success the frontend removes deleted paths from `groups`/`checkedState` and re-renders — it does not re-fetch.

## Critical constraints when editing

- **The delete endpoint is a shell-injection surface.** `server.js` interpolates user-supplied paths directly into a shell `rm` command wrapped only in double quotes — a path containing `"`, `$`, backticks, or `;` can break out. Any change touching path handling must preserve or improve safety (prefer passing paths as `execFile('rm', [...paths])` args rather than string interpolation).
- **Deletes are real and unrecoverable.** `rm` runs on the server's actual filesystem with the server process's permissions. There is no trash/undo and no path validation against a base directory.
- If the fetch fails with "Failed to fetch" (backend not running), the frontend *simulates* a successful delete for local UI testing — it removes paths from the view without deleting anything. Keep this fallback in mind when debugging "it said it deleted but the file is still there."
- The fclones parser is heuristic (regex + prefix checks on `/`, `.`, `-`, `*`). If a new report format doesn't parse, `parseFclonesText()` is the place to look.
