# Parlay Lab — Daily Sports Research

An MIT-licensed, self-hosted Next.js app for daily sports research, player props, and mixed-sport parlay building. All application dependencies are open source. External data APIs are permitted and remain subject to their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Start locally

Use Node.js 22.9+ or 24, and pnpm. From this directory:

```sh
pnpm install --frozen-lockfile
# Copy .env.example to .env.local if it doesn't already exist.
# PowerShell: Copy-Item .env.example .env.local
pnpm dev
```

Open http://127.0.0.1:3000. ESPN fallback works without a key. To start the app and the daily scheduler together, populate `RESEARCH_API_TOKEN` in `.env.local`, then run:

```sh
pnpm dev:daily
```

`dev:daily` uses `PORT` from `.env.local` (default `3000`) for both the app and scheduler. If that port is occupied, set another port and open its local URL, for example http://127.0.0.1:3001 for `PORT=3001`.

Generate a token locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste it into `.env.local`. Keep that file private. A locally generated token may already be present from initial setup; preserve it. The generated token protects research snapshot requests, not the whole dashboard.

If pnpm is unavailable, npm can install and run the same scripts (`npm install`, `npm run dev`). The checked-in lockfile is pnpm's; use pnpm for reproducible installs.

## What works

- A date-specific board in America/New_York with daylight saving time support, game statuses, search, and sport filters.
- Soccer, NBA, baseball, hockey, international basketball, AFL (Australian football), and NFL (American football).
- API-Sports primary schedules and per-sport ESPN fallback on missing keys or errors. A valid empty primary schedule is respected.
- Primary betting odds from **The Odds API (the-odds-api.com)**. The separate **odds-api.net** integration is an optional backup, followed by API-Sports and ESPN where available. Keys for these two odds services are not interchangeable.
- Player-prop markets returned by the odds provider, plus manual sportsbook props for any sport. Player names, market periods, lines, bookmakers, and available update timestamps are preserved.
- ESPN roster selection and up to 10 prior recorded games in the matchup's season. Choose a statistic and line to inspect the average and historical over/under counts. Coverage varies by sport; missing history is shown as unavailable.
- Mixed-sport slips with 2–10 legs, one leg per game, adjustable stake, illustrative decimal payout, date-specific browser persistence, and JSON export.
- Provider health messages, bounded in-memory caching, request deduplication, masked credential errors, and input validation.
- Daily protected snapshot endpoint, local scheduler, and a deployment workflow.

## Provider setup

All keys stay in the server environment. Do not prefix them with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `API_SPORTS_KEY` | Shared key for API-Sports services |
| `API_SPORTS_SOCCER_KEY`, `API_SPORTS_NBA_KEY`, `API_SPORTS_BASEBALL_KEY`, `API_SPORTS_BASKETBALL_KEY`, `API_SPORTS_HOCKEY_KEY`, `API_SPORTS_AFL_KEY`, `API_SPORTS_NFL_KEY` | Optional overrides for individual subscriptions |
| `THE_ODDS_API_KEY` | Primary key from **https://dash.the-odds-api.com/api**, used server-side with `https://api.the-odds-api.com/v4` |
| `THE_ODDS_API_REGIONS` | Bookmaker regions: `us` by default; optionally comma-separated `us2`, `uk`, `eu`, `au`. More regions consume more credits. |
| `ODDS_API_KEY` | Key from **odds-api.net**, sent as `X-API-Key` to `https://api.odds-api.net/v1` |
| `ESPN_FALLBACK_ENABLED` | Defaults to `true`; `false` disables ESPN schedule/odds fallback and ESPN player research |
| `RESEARCH_API_TOKEN` | Random secret required for scheduled `POST /api/research` |
| `RESEARCH_URL` | Scheduler target, defaults to `http://127.0.0.1:3000` |
| `PORT` | Local app port for `dev:daily`, defaults to `3000`; the combined runner automatically targets this port |

The six supplied hosts are wired directly: `v3.football.api-sports.io`, `v1.afl.api-sports.io`, `v1.baseball.api-sports.io`, `v1.basketball.api-sports.io`, `v1.hockey.api-sports.io`, and `v2.nba.api-sports.io`. NFL support retains the original project scope using `v1.american-football.api-sports.io` or ESPN. Access depends on the key's subscriptions.

API-NBA and API-Basketball use different IDs. NBA games are only mapped to basketball odds when both team names and start times agree; ambiguous name differences are not guessed. ESPN IDs never get passed into API-Sports endpoints. The odds-api.net adapter matches both teams and start time, rejecting ambiguous events, suspended prices and invalid odds. Event and odds pagination are bounded at five pages with a visible partial-result notice.

The Odds API integration discovers active leagues for all seven sport categories, matches both teams and start time, and rejects ambiguous events. The matching window is 15 minutes for basketball (to accommodate tip-off differences) and five minutes for other sports. Game odds request moneyline, spreads and totals. Player props are discovered and fetched only when their tab is opened, with at most eight available market types per event. Prices are cached for five minutes and the last reported remaining credits are shown. Discovery of sports/events is quota-free; market discovery costs one credit and odds use credits per returned market and requested region. Exchange/lay prices are excluded. Unsupported leagues or team-name differences fall back without guessing matches. See the [official API guide](https://the-odds-api.com/liveapi/guides/v4/).

ESPN fallback covers MLB, NHL, NBA, NFL, AFL, soccer's aggregate scoreboard, WNBA and NCAA men's/women's basketball. It does not reproduce API-Sports' complete international coverage. ESPN endpoints are unofficial and can change. API-Sports AFL odds are not assumed supported: the app uses a configured odds provider, ESPN if available, or manual entry. Authenticated API-Sports and optional odds-api.net access still depend on separate keys and subscriptions.

## Daily operation

`pnpm dev:daily` starts the local app and scheduler. Or keep a production server running with `pnpm build && pnpm start` and run `pnpm schedule` in another process. The local scheduler:

- Runs at or after **8 AM America/New_York every day**, handling daylight saving time.
- Catches up once when started later that day and retries failures after five minutes.
- Saves the last successful day to `.data/scheduler.json` and the normalized daily research snapshot to `.data/research/YYYY-MM-DD.json`.
- Uses atomic file replacement. Slips are saved separately in the browser; they are not scheduled predictions.

Use `pnpm research` for an immediate snapshot. Keep the machine and both processes running for unattended local operation. Scheduling is not a Windows service and is not installed at boot. Scheduled research refreshes the game board; odds and player histories load on demand to limit API use.

For a hosted app, `.github/workflows/daily-research.yml` replaces the weekly trigger. Set repository secrets `RESEARCH_URL` and `RESEARCH_API_TOKEN`; enable Actions and place the workflow on the default branch. The workflow skips runs until those secrets are configured. The two UTC triggers are gated to 8 AM Eastern. GitHub may delay or skip scheduled jobs, so this is approximate. Publishing this repository does not deploy the app. Use either the local scheduler or the deployed workflow to avoid duplicate daily jobs.

Local JSON storage is suitable for a single process on a persistent filesystem. Ephemeral serverless hosts need persistent storage and a shared cache before multi-instance operation. The development/start scripts bind to loopback. Before public hosting, add dashboard authentication and per-user request limits; the read endpoints can consume provider quotas.

## API and checks

| Endpoint | Behavior |
| --- | --- |
| `GET /api/research?date=YYYY-MM-DD` | Normalized schedule and per-sport source status |
| `POST /api/research?date=YYYY-MM-DD` | Bearer-protected daily snapshot; reports complete, partial or unavailable |
| `GET /api/markets?date=...&game=...&kind=game\|player\|all` | Upcoming event's provider prices and fallback notice; default `all`, dashboard requests each tab separately |
| `GET /api/players?date=...&game=...` | ESPN roster |
| `GET /api/players?date=...&game=...&player=...` | Recorded player statistics before the selected game |
| `POST /api/parlays` | Validated payout arithmetic for supplied decimal odds and optional probability estimates |

```sh
pnpm test
pnpm typecheck
pnpm build
```

Tests cover provider schemas, fallback, pagination, source identity, credential redaction, Eastern date boundaries, player-log exclusions, and API validation without consuming real provider credits.

## Research limits

This version does not generate calibrated predictions, auto-select profitable picks, place bets, or settle historical bets. Historical hit counts are not probability forecasts. No synthetic games, player statistics, or odds are displayed as live data. Missing data remains missing.

The builder blocks duplicate games and begun/postponed events, and disables provider prices with known update times older than 15 minutes. Unknown timestamps are labeled. Exported slips are research records, not validated sportsbook quotes. Cross-book prices cannot be placed as one wager; correlation, price changes, voids, limits and book rules can change the result.

## License

MIT for original app code. Dependency licenses and external data terms are documented separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
