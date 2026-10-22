# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # runs the full Playwright suite
```

Run a single file: `npx playwright test tests/sync.spec.js`
Run a single test by name: `npx playwright test -g "the stripped class id"`

There is no build step, no lint command, and no dev server — see Architecture below for why. Tests open `index.html` directly via a `file://` URL (`tests/helpers.js`), so nothing needs to be served.

## Architecture

**This is a single HTML file.** `index.html` (~6000 lines) contains all markup, CSS, and JavaScript for the whole app — every screen, every modal, the assignment engine, and the GitHub sync client. There is no bundler, no framework, no modules; everything is one `<script>` tag of plain functions and globals. When making a change, search `index.html` directly rather than looking for separate source files — there aren't any. The file is organized into banner-commented sections (`// ═══... SECTION NAME`); grep for these to navigate (e.g. `ASSIGNMENT ENGINE`, `OVERRIDE`, `GITHUB SYNC`, `SCHEDULE (VERACROSS CSV) IMPORT`).

**Data lives in `localStorage`, not in the file.** `index.html` has zero data in it — roster, log, schedule, room chart, and all day-to-day entries are read/written through a small set of data-layer functions (`getRoster`/`setRoster`, `getLog`/`setLog`, etc., under `DATA LAYER`) that currently always target `localStorage` directly. A `STORAGE_MODE` constant and a parallel set of SharePoint REST helpers exist in the file but are dead code (`STORAGE_MODE` is hardcoded to `'local'`) — don't assume the SharePoint path is exercised or tested.

**GitHub sync is optional and layered on top.** When connected (`GITHUB SYNC` section), the app pushes/pulls JSON blobs to/from a private GitHub repo via the Contents API, authenticated by a personal access token stored only in that browser's `localStorage`. Three merge strategies apply depending on the data type:
- `roster` and `log` merge **item by item** (per-teacher, per-log-entry) via `mergeByKey`, with tombstones so a deletion on one device doesn't silently get undone by a stale copy on another.
- `daily` (absences, notes, outside-sub count/exclusions, Grade Out / Field Trip settings) merges **per date**, also via `mergeByKey` (keyed by date string, no tombstones needed — a date is never "deleted," it just becomes empty). `syncDailyFile` reads an old whole-blob-shaped remote file (pre-dating this per-date merge) through `migrateOldDailyRemote` rather than treating it as empty. The two fields that aren't date-scoped (`seniorClassesEnded`, `emailTemplate`) are tracked and merged separately as simple globals, still last-write-wins. Unlike roster/log/schedule/roomchart, absence/notes/outside-sub edits don't call `touchBlob`/`markDirty` at the point of edit — a dedicated short interval in `initSync` (`stampDailyItemChanges`/`checkDailyChanged`) detects changes and marks them dirty instead, so an edit doesn't sit unpushed waiting for the next full poll.
- `schedule` and `roomchart` are each a **single snapshot** — last write wins for the whole blob, no field-level merge. Schedule entries added by hand (Add Class, Add Co-Teacher) carry `manual: true` inside `scheduleData` itself (co-teacher entries also carry `coTeacherOf: <main teacher>`), so they sync with the snapshot; a re-upload goes through `applyScheduleUpload`, which shows a change summary (`diffSchedules`) before replacing anything and re-applies the manual entries via `carryOverManualEntries`.

This distinction matters when touching sync code: adding a new field to roster/log needs to fit the item-merge logic; adding a new per-date setting needs to flow through `dailyItemData`/`applyDailyItem` (and `migrateOldDailyRemote` if it's genuinely new); adding a new schedule/roomchart field just needs to be part of the blob those two already carry.

**The assignment engine (`assignCoverage`, under `ASSIGNMENT ENGINE`) picks substitutes in a strict priority order**, and most engine bugs come from something being consulted at the wrong point in this order:
1. Hard eligibility filters (tier, availability for that period, not already used today, not also absent).
2. Fairness score (tier, weekly coverage count, temp-period penalty, remaining capacity).
3. MS/HS level and subject match — a **tie-breaker only**, consulted exclusively when the fairness score above is exactly equal between two candidates. It never outranks a fairer pick. A teacher's own level/subject is derived from their *distinct classes* in the loaded Schedule's `Subject` column (`MS: X` / `US: X` format), not from raw weekly meeting counts — a class meeting 5x/week must not outweigh one meeting 2x/week when deciding what level a teacher "is."
4. A same-period swap pass runs after initial assignment: if two absences in the same period each got a fairness-correct pick that still crosses MS/HS lines, it swaps which of the two already-chosen teachers covers which class, when that improves the level/subject match on one side without hurting the other. This never changes who's used or anyone's coverage count — only which class they're assigned to.

**Existing/locked assignments vs. fresh picks**: re-running coverage for a date with prior assignments treats most existing log entries as locked (carried forward untouched), *except* soft outside-sub assignments (re-assignable unless manually locked) and UNASSIGNED entries (from Override's Reset — these must remain eligible for a real pick on the next run, not frozen as UNASSIGNED forever). The log-merge step that writes new picks back (`runCoverage`) upserts by `(date, absentTeacher, period)` key rather than append-only, specifically so a reassigned UNASSIGNED slot overwrites the stale row instead of being skipped as a duplicate.

**Room Chart / Schedule CSV matching is string-key based and case/suffix-fuzzy on purpose.** Two independently-exported Veracross CSVs don't reliably agree on capitalization or session-suffix formatting (`ENG 11-4` vs `Eng 11-4`; `MTH 8-1.G1.SCH` vs `Mth 8-1.g1`) for the same class. `getRoomFromChart` normalizes case and falls back to progressively stripping trailing `.XXX` segments when the exact key doesn't match — but only as a fallback after an exact match fails, never overriding one.

## Testing conventions

Tests seed their own roster/log/schedule directly via page-exposed globals (`setRoster`, `setLog`, `scheduleData = {...}`) rather than driving the UI to create fixtures, then interact with real UI elements for the behavior under test. GitHub sync tests run against a fake in-memory GitHub API (`installGithubMock` in `tests/helpers.js`), never the real network. No test touches real data or a real repo.
