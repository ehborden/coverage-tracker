# Coverage Tracker

A coverage assignment tool for schools: who's absent, who covers them, and keeping that fair over time. It runs entirely as a **single HTML file** opened in a browser. There is no server, no backend, no build step, and no environment variables, because none of those exist here.

## What this actually is

`coverage system 08 26 26 (2) 1.html` is the whole application. Open it by double-clicking it (or opening it in a browser via a `file://` link). Everything, your roster, the coverage log, the schedule, the room chart, lives in that browser's `localStorage`, not in the file itself. The HTML file is just code; it has zero data in it.

That one fact explains almost everything else below.

## Running it day to day

Open the file in a browser. That's the whole setup. The app remembers everything between sessions because it's reading from `localStorage`, not from the file.

## Updating the app without losing your data

Because the file is just code and the data lives in the browser, updating to a newer version is simple **as long as you don't change where the file lives**:

1. **Export a Backup first** (Data menu → Backup). This costs nothing and means the next step can't actually hurt you.
2. Save the new version over the old file, **same filename, same folder**, don't rename it or move it.
3. Open it. Your data should be exactly where you left it.
4. Before doing any real work, check the Roster screen. If your teachers are listed, everything carried over. If it's empty, stop and Restore from the backup in step 1 instead of assuming it's gone.

### Why the filename and location matter (and when they don't)

Browsers scope `localStorage` to where a page is loaded from. For a page opened over the internet (`https://...`) that's the domain. For a page opened as a **local file** (`file://...`), browsers differ:

- **Chrome, Edge, and other Chromium-based browsers** treat *all* local files as one shared storage bucket. The filename and folder genuinely don't matter in these browsers, your data is tied to "local files in this browser," not to this specific file.
- **Firefox and Safari** may not share storage across local files the same way. If you ever switch browsers, don't assume your data will follow, same filename or not.

If this is ever hosted somewhere (an intranet site, a shared drive served over HTTP) instead of opened as a plain local file, that's a different storage origin entirely, and none of the above applies. Treat that as a fresh start unless you deliberately Restore a backup into it.

## Backup and Restore

**Backup** (Data menu → Backup) downloads a JSON snapshot of everything: roster, log, schedule, room chart, absences, notes, and settings. **Restore** (Data menu → Restore) loads one back in.

Restore is **not a merge**. The roster and log are fully replaced with whatever's in the file you load. Anything you did locally since your last backup, a coverage run, a roster edit, is gone the moment you restore. Always restore *before* you start a work session, never after.

## If you use more than one computer

There is no sync between computers. Each one has its own independent copy of everything in its own browser's `localStorage`. If you enter data on a second computer, run coverage, edit the roster, that computer's changes only exist there until you Export from it and Import that into whichever computer you treat as canonical.

The same applies to Start New Year (below): running it on one computer does not touch any other computer's data. If more than one computer runs this app, repeat it on each one, or Export the freshly-reset state from one and Restore that everywhere else.

## Key features

- **Run Coverage**: pick a date, list who's absent and what period, and the app assigns substitutes by tier, how much they've already covered this week, and who's gone longest without covering.
- **End Date (for range)**: for someone out several days in a row. Repeats the absence across every school day through that date, pulling each day's real class from the loaded schedule when one exists, rather than assuming the same class every day. Only checks the periods you actually listed for day one; if the same person has a totally different set of periods off on a different day, use Out All Week instead.
- **Out All Week**: adds a teacher's absences across the week straight from their real loaded schedule, covering every period they're actually scheduled for on each day.
- **Override**: manually change, clear, or remove a specific assignment after the fact.
- **Reset Day**: wipes every assignment for one date and rolls back the totals it affected.
- **Undo** (top of the header): reverses the single most recent action (a run, an override, a roster edit, Reset Day). It resets if you reload the page, and it does not cover loading a new Schedule or Room Chart CSV. Use Backup for anything you can't afford to redo by hand.
- **Recalculate from Log** (Roster screen): rebuilds every teacher's total coverages, last-covered date, and previous-covered date directly from the actual log. Safe to run any time you're unsure the numbers are right; it only derives from data that's already there.
- **Schedule / Room Chart**: load CSV exports (e.g. from Veracross) so the app knows who teaches what, when, and in which room.
- **Start New Year**: archives the year (downloads a backup and an Excel export first) and clears the log and running totals for a fresh year, while keeping teachers, tiers, availability, schedule, and room chart.

## Known limitations

- **Renaming a teacher breaks their history.** The app matches teachers by name across the log, schedule, and notes, not by a stable ID. Edit a teacher's name in Roster and their past coverage history, schedule lookups, and saved notes stay filed under the old name. If a name is wrong, delete and re-add rather than renaming.
- **No real multi-computer sync.** See above. Backup/Restore is a manual bridge, not a shared source of truth.
- **SharePoint storage mode exists in the code but isn't wired up.** There's a `STORAGE_MODE` constant and a full set of SharePoint REST helpers in the file, dead code today (`STORAGE_MODE` is hardcoded to `'local'`). This would be the real fix for multi-computer sync if someone takes it on, but it's untested and not a quick flip.

## Running the test suite

The test suite is for anyone developing this app, not for running the app day to day. It needs Node.js.

```bash
npm install
npx playwright install chromium   # first time only, downloads a browser for the tests to drive
npm test
```

This runs the Playwright suite in `tests/`: the assignment engine, overrides, Undo, the multi-day range feature, backup/restore, an automated accessibility scan (axe-core) of every screen and modal, and a performance stress test against a synthetic oversized dataset. No test touches your real data, each one seeds its own roster and log in an isolated browser context.
