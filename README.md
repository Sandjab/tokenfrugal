# tokenfrugal

Find where your Claude Code tokens go — context repaid on every turn, cache rebuilds after a pause,
compactions, restarts after `/clear` — and what to change. Reads your local session logs; nothing
leaves your machine.

Status: v1 works locally. Run `node bin/tokenfrugal.mjs report --open` (Node ≥ 22, after `npm install`).
Data is stored in `~/.tokenfrugal/`. See [docs/brief.md](docs/brief.md) and the
[v1 spec](docs/superpowers/specs/2026-10-19-tokenfrugal-design.md) (in French).
