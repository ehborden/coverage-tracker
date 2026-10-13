# Coverage Tracker

A coverage assignment tool for schools: who's absent, who covers them, and keeping that fair over time. It runs entirely as a **single HTML file** opened in a browser. There is no server, no backend, no build step, and no environment variables, because none of those exist here.

## What this actually is

`index.html` is the whole application. Open it by double-clicking it (or opening it in a browser via a `file://` link), or visit the hosted copy in any browser (see below). Everything, your roster, the coverage log, the schedule, the room chart, lives in that browser's `localStorage`, not in the file itself. The HTML file is just code; it has zero data in it.

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

Without sync (below), there is no connection between computers. Each one has its own independent copy of everything in its own browser's `localStorage`. If you enter data on a second computer, run coverage, edit the roster, that computer's changes only exist there until you Export from it and Import that into whichever computer you treat as canonical.

The same applies to Start New Year (below): running it on one computer does not touch any other computer's data unless sync is on. If more than one computer runs this app without sync, repeat Start New Year on each one, or Export the freshly-reset state from one and Restore that everywhere else.

## Syncing to GitHub (optional)

Data menu → **Connect with GitHub** connects this computer to a private GitHub repo. Every other computer that connects to the *same* repo sees the same roster, log, schedule, room chart, and day-to-day entries, without anyone exporting or importing a file by hand.

**Setting it up:**
1. Create a private repo on GitHub to hold the data (any name; `coverage-tracker-data` is the suggested default). It must be private, since this is school data, your coverage schedule, and the app refuses to connect to a public one.
2. Create a [personal access token](https://github.com/settings/tokens) scoped to just that one repo, with Contents set to **Read and write**.
3. Data menu → Connect with GitHub → enter your GitHub username, the repo name, and the token. Repeat on every computer you want connected.

The token is saved only in that browser's `localStorage`. It's never written into the HTML file and never included in a Backup. Each computer needs its own token entered once.

**What happens once it's on:**
- Every change (a run, an edit, an override, a Reset Day, a new Schedule or Room Chart CSV) is saved to GitHub within a couple of seconds, and the app checks GitHub for other computers' changes when the tab becomes active, about once a minute while it's open, and when the computer comes back online.
- The roster and log merge item by item: if two computers each log a coverage while the other was offline, both show up afterward, and totals are rebuilt from the combined log rather than from whichever device happened to sync last. Deleting a teacher or a log entry on one computer removes it everywhere once the others sync. Absences, notes, and the Outside Subs settings merge per date, the same way — entering an absence for one date on one computer can't get wiped out by a different date's edit on another computer. Schedule and Room Chart are each a single saved snapshot; whichever computer saved most recently wins outright for those two. The senior-classes flag and the email template aren't tied to a date, so they're also simple last-write-wins.
- The small pill next to Undo shows the state: **Saving...** (about to push), **Syncing...** (talking to GitHub), **Synced**, **Offline** (can't reach GitHub right now, nothing is lost, it'll catch up), or **Sync problem** (click it to check the token or repo name).
- About once a week, the app saves a dated backup to a `backups` folder in the data repo and keeps the last 12. Data menu → **Restore from GitHub** lists them by date, the same way Restore does for a local file.

Turning sync off (Connect with GitHub → Turn off sync) stops this computer from syncing; its data stays exactly where it is.

Sync and manual Backup/Restore work together: a manual Restore still fully replaces local data as described above, and with sync on, that restored state is then pushed out to every other connected computer, the same way any other local edit would be.

## Key features

- **Run Coverage**: pick a date, list who's absent and what period, and the app assigns substitutes by tier, how much they've already covered this week, and who's gone longest without covering.
- **End Date (for range)**: for someone out several days in a row. Day one is entered as usual (who, what periods); every later day through the end date pulls that teacher's actual periods for that specific day straight from the loaded Schedule, not day one's period numbers repeated forward, since the same person can easily have a totally different set of periods on a different day. A day they genuinely have nothing scheduled still keeps them marked absent (so they can't be picked to cover someone else that day), it just needs no coverage itself. No Schedule loaded, or that teacher missing from it: falls back to repeating day one's row, flagged so you know to double-check it.
- **Override**: manually change, clear, or remove a specific assignment after the fact. Opens to whichever date Run Coverage is currently on, not always today. Reset All / Remove All clear every assignment on the date at once instead of one at a time. A Reset assignment (shown as UNASSIGNED) stays eligible for a real pick on the next Run Coverage — it's not stuck as UNASSIGNED forever.
- **Reset Day**: wipes every assignment for one date and rolls back the totals it affected.
- **Undo** (top of the header): reverses the single most recent action (a run, an override, a roster edit, Reset Day). It resets if you reload the page, and it does not cover loading a new Schedule or Room Chart CSV. Use Backup for anything you can't afford to redo by hand.
- **Recalculate from Log** (Roster screen): rebuilds every teacher's total coverages, last-covered date, and previous-covered date directly from the actual log. Safe to run any time you're unsure the numbers are right; it only derives from data that's already there.
- **Schedule / Room Chart**: load CSV exports (e.g. from Veracross) so the app knows who teaches what, when, and in which room. If the Schedule CSV has a `Subject` column (values like `MS: Mathematics` or `US: Science`), the app uses it to nudge picks: prefer a middle-school teacher for a 6-8 class, and a same-subject teacher for a high-school class, when it doesn't make anyone's pick less fair. This only kicks in as a tie-breaker between otherwise-equally-fair choices; it never overrides tier, weekly fairness, or who's gone longest. No `Subject` column, no effect, picks work exactly as before. If two absences land in the same period and each got the fairness-correct pick but still crossed MS/HS lines, the app swaps which of those two already-chosen teachers covers which class, whenever that improves the match on one side without hurting the other — same two people, same coverage counts, just matched correctly. Uploading a new Schedule CSV also now automatically offers to sync roster availability from it (same as clicking Sync with Schedule on the Roster screen), so that step doesn't get missed after a mid-year schedule refresh.
- **Outside Subs Coming** (Run Coverage): once you say how many are coming, you can check off periods a specific one can't cover that day (e.g. "anything but last period"). The engine skips that sub for those periods and falls back to a real teacher, same as a day with no outside sub at all.
- **Start New Year**: archives the year (downloads a backup and an Excel export first) and clears the log and running totals for a fresh year, while keeping teachers, tiers, availability, schedule, and room chart.

## Known limitations

- **Renaming a teacher breaks their history.** The app matches teachers by name across the log, schedule, and notes, not by a stable ID. Edit a teacher's name in Roster and their past coverage history, schedule lookups, and saved notes stay filed under the old name. If a name is wrong, delete and re-add rather than renaming.
- **SharePoint storage mode exists in the code but isn't wired up.** There's a `STORAGE_MODE` constant and a full set of SharePoint REST helpers in the file, dead code today (`STORAGE_MODE` is hardcoded to `'local'`) — an alternative backend nobody finished. Not needed for multi-computer sync now that GitHub sync (above) handles that.

## Running the test suite

The test suite is for anyone developing this app, not for running the app day to day. It needs Node.js.

```bash
npm install
npx playwright install chromium   # first time only, downloads a browser for the tests to drive
npm test
```

This runs the Playwright suite in `tests/`: the assignment engine, overrides, Undo, the multi-day range feature, backup/restore, GitHub sync (against a fake, in-memory GitHub API, never the real one), an automated accessibility scan (axe-core) of every screen and modal, and a performance stress test against a synthetic oversized dataset. No test touches your real data or a real GitHub repo; each one seeds its own roster and log in an isolated browser context.
