# Contributing

Setup and project layout are in the [README](README.md).

## Branches

Every change starts from a Jira ticket. Branch off the latest `main` as `SCRUM-<number>-<short-slug>` (or `<your-name>/SCRUM-<number>/<short-slug>`), and put the ticket in your commit messages, like `feat(SCRUM-58): import .xlsx files`.

## Before you open a PR

Run the same commands as the [Testing](README.md#testing) section of the README:

1. `bun run lint`, `bun run typecheck` and `bun run test` (unit tests). These need nothing else.
2. `bun run test:integration` and `bun run test:e2e`. These need the throwaway MongoDB on port 27018 from the README. The integration tests refuse to run unless `MONGODB_URI` points at `mongodb://127.0.0.1:27018/ung_auth_test`, so they can't touch real data.
3. `test:e2e` starts its own dev server on port 3100, and only one dev server can run per checkout, so stop your own `bun dev` first (or use a `git worktree`).

## Pull requests

1. Merge the latest `main` into your branch so the checks run against what will land.
2. Open a PR against `main` that names the ticket and says how you tested it.
3. CI has to pass (lint, typecheck, unit, integration, builds and Playwright on desktop and mobile Chromium).
4. Once it's green, merge with a merge commit.

Never commit real credentials. Local settings go in `.env.local`; `.env.example` lists every variable.
