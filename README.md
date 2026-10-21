# tokenfrugal

Find where your Claude Code tokens go — context paid again on every turn, cache rebuilds after a
break, compactions, restarts after `/clear` — and what to change. It reads your local session logs;
nothing leaves your machine.

## Use it in your browser

Open **https://sandjab.github.io/tokenfrugal/**, choose your `~/.claude/projects` folder and read the
report. The analysis runs entirely in your browser: the page carries a Content Security Policy that
forbids any network connection, so your logs cannot be sent anywhere. Claude Code deletes old logs
(after 30 days by default): to follow your weeks over time, save your history file at the end and give
it back on your next visit.

## Or from the command line

Node ≥ 22:

    npm install
    node bin/tokenfrugal.mjs report --open

This reads `~/.claude/projects` into `~/.tokenfrugal/` (kept even after Claude Code purges its logs)
and writes `~/.tokenfrugal/report.html`. Other commands:

    node bin/tokenfrugal.mjs collect                        # record new or changed sessions only
    node bin/tokenfrugal.mjs history --export history.json  # the same file as the web page's history
    node bin/tokenfrugal.mjs history --import history.json
    --lang fr|en                                             # default: from LANG

## What it measures

- Context size paid again on every turn, and the share of cost above 150k tokens.
- Cache rebuilds after a break, by break length, and their extra cost.
- Compactions, `/clear` restarts, and the fixed base every session starts with.
- A what-if that replays your sessions with other habits (fixed base trimmed, switching at a context
  threshold, switching before long breaks) and ranks the levers by what they would have saved.
- Cost and key indicators by project, with a selector that narrows the whole report to one project.

Costs are shown in API-equivalent dollars and in weighted tokens (each token weighted by its price
ratio). Anthropic does not publish how subscription limits count tokens, so weighted tokens are an
estimate.

## Privacy

Only numbers, times, model names, project folder names and hashed identifiers are stored — never a
line of conversation or a file path. An automated test checks this on the stored data, the history file and the pages.

## Development

    npm test          # unit tests
    npm run e2e       # browser tests (Playwright, Chromium)
    npm run build:web # dist/index.html

Specs and plans are in `docs/superpowers/` (in French). Licence: MIT.
