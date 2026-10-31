# Nexus

> A community-driven forum / Q&A platform.

Nexus lets people create and join communities, share text, link, image, and poll posts, and discuss them in nested comment threads. Voting drives both content ranking (hot/top feeds) and user karma, while follows, direct messages, and notifications keep members connected. Communities are self-governed: creators appoint moderators who manage rules and flairs, review held posts and reports, ban users, and pin posts.

The project is split into two independent applications: a Django REST Framework backend exposing a versioned JSON API (`/api/v1/`) secured with JWT, and a React single-page app that consumes it. Everything runs on PostgreSQL — including full-text search — and ships with Docker images and a production compose stack.

## Features

**Content & Communities**
- Communities with membership roles (admin / moderator / member), icons, rules, and NSFW flags
- Four post kinds: text, link, image (with upload validation), and poll
- Post flairs (per-community, managed by mods), sticky/pinned posts, NSFW tagging
- Nested comment trees with author avatars, inline replies, `@username` mention autocomplete and mentions rendered as profile links
- Markdown editor with server-rendered, sanitized preview; links keep only absolute `http(s)`/`mailto`, site-root (`/…`) and `#…` targets (anything else renders as plain text) and always carry `rel="nofollow noopener noreferrer ugc"`
- Post drafts — debounced autosave to localStorage with restore/discard

**Voting & Feeds**
- Up/down voting on posts and comments with optimistic UI and rollback
- User karma (post + comment) kept in sync via signals, plus a `recalculate_karma` management command
- Home feed (joined communities), Following feed, Popular/All feeds for anonymous visitors
- `new` / `top` / `hot` sorting with a time range (past hour … all time), post-kind filters, NSFW filtering, pagination

**Social**
- Follow system with followers/following lists
- Direct messages: conversations, read receipts (✓ / ✓✓), unread counters
- Notifications (comment, reply, mention, follow, DM, mod action) with bell dropdown, inbox page, and 30s polling
- Navbar badges for unread notifications and messages come from one call, `GET /api/v1/users/me/unread-counts/` (`{notifications, messages}`), polled every 30s and paused in hidden tabs
- User blocking — cuts DMs and follows both ways, suppresses notifications
- Public user profiles with karma badges, post/comment tabs, profile editing, and an optional country shown with its flag

**Discovery**
- Full-text search (PostgreSQL `SearchVector` + GIN, ranked with `SearchRank`) across posts, communities, and people
- Trending widgets: most active communities and top posts of the last 24h (cached)
- Karma leaderboard (top users, cached)
- Server-rendered Open Graph pages so shared links unfurl in Discord/WhatsApp/Twitter

**Moderation**
- Generic reporting (posts, comments, users) with a 24h per-target rate limit
- Mod panel: approval queue, report queue (resolve/dismiss), rules, flairs, community bans, moderator assignment, pin/remove actions
- Community settings editable by admins: icon, display name, description, NSFW flag, and "hold new posts for approval"
- Approvals are pinned to the version the moderator saw: a post edited while it waits in the queue must be reviewed again, and in approval-required communities an edit to an approved post's title, body, link, or image (or dropping its NSFW flag) sends it back to the queue
- AutoMod: a per-community keyword list that holds matching posts for approval. Matching folds case, accents, invisible characters, and punctuation (`b.a.d` matches `bad`) and also checks rendered markdown text, link targets (percent-decoded, punycode hosts decoded), and keywords added on later edits
- Mod action audit log — every pin, ban, approval, and report decision is recorded

**Accounts & Privacy**
- JWT auth (SimpleJWT) with refresh rotation and blacklist, register/login/logout
- The refresh token lives in an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth/`; the access token is kept in memory only, so scripts on the page can't read either from storage
- Password reset and email verification flows (console backend in dev, SMTP via env)
- Account settings: theme, interface language, NSFW preference, password change
- Data export: download everything you wrote or chose (profile, posts, comments, sent messages, votes, saves, follows, blocks, memberships) as JSON
- Account deletion: personal data is erased while content stays attributed to a `deleted-<id>` placeholder; communities you created are handed to their highest-ranked active member, and every outstanding token is revoked

**Interface**
- Light, dark, and system themes; Inter and JetBrains Mono are self-hosted, so the app loads no third-party resources
- One-click light/dark and EN/TR toggles in the navbar, available to signed-out visitors too
- Interface language picker (EN/TR via i18next) with full Turkish coverage, `<html lang>` and per-page titles; an ESLint rule blocks hard-coded English in JSX
- Responsive from 360 px: mobile navigation drawer below 960 px, tap-to-reveal for NSFW images
- Sessions survive refresh hiccups (429/network) and stay in sync across tabs; stale-chunk errors reload once
- Uploaded images are automatically downscaled (avatars 512px, post images 1920px)
- Rate throttling per scope (auth, write, vote), pagination, and permission classes throughout

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Backend  | Python 3.12, Django 6.1, Django REST Framework, SimpleJWT, markdown-it-py + nh3 |
| Database | PostgreSQL 16 (full-text search, GIN indexes) |
| Frontend | React 19 (Vite, TypeScript), React Router, Redux Toolkit, TailwindCSS 4, Lucide icons |
| Testing  | pytest + pytest-cov (backend), Vitest + React Testing Library (frontend) |
| Tooling  | ruff (lint + format), ESLint |
| Deploy   | Docker (gunicorn + WhiteNoise, nginx SPA + API proxy), Redis, docker-compose |

## Project Structure

```
community-forum/
├── .github/workflows/ci.yml    CI: backend lint + tests on PostgreSQL, frontend lint, build and tests
├── backend/                    Django + DRF API
│   ├── config/                 settings (base / dev / prod), root URLs, pagination, WSGI/ASGI
│   ├── apps/
│   │   ├── users/              accounts, JWT auth and refresh cookie, profiles, data export, account deletion
│   │   ├── communities/        communities, memberships and roles, rules, flairs, bans
│   │   ├── posts/              text/link/image/poll posts, feeds and sorting, approvals, AutoMod, edit history
│   │   ├── comments/           nested comment threads, mentions, edit history
│   │   ├── votes/              up/down votes and karma
│   │   ├── polls/              poll options and votes
│   │   ├── messaging/          direct-message conversations and read receipts
│   │   ├── notifications/      notification inbox and unread counts
│   │   ├── social/             follows and blocks
│   │   ├── saves/              saved posts and comments
│   │   ├── moderation/         reports and the mod action log
│   │   ├── search/             full-text search and trending widgets
│   │   ├── seo/                Open Graph pages for link previews
│   │   └── common/             markdown rendering, image handling, throttling, health check
│   ├── Dockerfile              gunicorn image; entrypoint.sh runs migrations on start
│   └── requirements*.txt       runtime and dev dependencies
├── frontend/                   React SPA
│   ├── src/
│   │   ├── api/                axios client (token refresh, cross-tab lock) and endpoint wrappers
│   │   ├── app/                Redux store and typed hooks
│   │   ├── features/           Redux slices and types per domain (auth, posts, comments, …)
│   │   ├── components/         UI kit (ui/), layout (navbar, sidebars, drawer) and domain components
│   │   ├── pages/              route-level screens
│   │   ├── router/             routes, protected routes, error page
│   │   ├── i18n/               English and Turkish strings
│   │   ├── lib/                shared helpers (theme, time, paths, paging, polling, drafts)
│   │   └── styles/             design tokens (dark and light) and self-hosted font faces
│   ├── public/                 logo, fonts, theme-init script
│   ├── nginx.conf, nginx/      SPA serving, API/media proxy, security headers
│   └── Dockerfile              build with Node, serve with nginx
├── docs/screenshots/           README images
├── docker-compose.yml          local PostgreSQL for development
└── docker-compose.prod.yml     production stack: PostgreSQL, Redis, backend, nginx frontend
```

## Installation

Requirements: Python 3.12+, Node 26+, Docker (or a local PostgreSQL 16).

```bash
# Database
docker compose up -d          # starts PostgreSQL on :5432 (DB_PORT=5433 docker compose up -d if 5432 is taken)

# Backend — http://localhost:8000
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt   # runtime deps + pytest/ruff; the Docker image installs requirements.txt only
cp .env.example .env          # fill in values (match DB_PORT if you changed it)
python manage.py migrate
python manage.py seed              # optional: demo users/communities/posts (login: any user / password123)
python manage.py runserver

# Frontend — http://localhost:5173
cd frontend
npm install
cp .env.example .env          # VITE_API_URL
npm run dev
```

## Testing

The backend has 800+ pytest tests and the frontend 340+ Vitest tests. Backend tests run against a real PostgreSQL (full-text search and GIN indexes don't exist in SQLite), so start the database first; pytest-django creates and drops its own test database.

```bash
# Backend
cd backend
docker compose up -d                  # from the repo root, if PostgreSQL isn't running yet
pytest                                # full suite
pytest apps/posts                     # one app
pytest --cov=apps --cov-report=term-missing
ruff check . && ruff format --check .

# Frontend
cd frontend
npm test                              # single run (npm run test:watch to watch)
npm run lint
npm run build                         # includes the TypeScript type check
```

What the suites cover:

- **API behavior** — endpoints are exercised through DRF's test client: permissions, validation, pagination, throttling, and error responses
- **Moderation rules** — approval snapshots and re-approval on edit, AutoMod normalization, ban enforcement, moderator hierarchy, held-post visibility
- **Race conditions** — concurrent votes (on real threads), interleaved edits and moderator actions, and ban races must not double-count or overwrite each other
- **Query budgets** — feeds, threads, inboxes, and mod queues assert an upper bound on SQL queries, so N+1 regressions fail the build
- **Security** — markdown sanitization and link filtering, token revocation, refresh-cookie handling, account deletion and data export
- **Frontend** — components and pages rendered with React Testing Library and driven with user-event; API client token refresh, cross-tab session sync, drafts, polling, and i18n

[GitHub Actions](.github/workflows/ci.yml) runs all of the above on every push to `main` and on every pull request, with a PostgreSQL 16 service container.

## Screenshots

![Home feed in the dark theme: poll post, hot/new/top sorting, post-kind filters and the trending sidebar](docs/screenshots/feed.png)
*Home feed — sorting, time range, post-kind filters, inline polls and trending widgets.*

![Post page in the light theme with share, save and report actions, moderator actions and a nested comment thread](docs/screenshots/post-thread.png)
*Post page in the light theme — share/save/report, pin/remove actions for moderators, and nested comments with avatars.*

![Moderator tools with a post held by AutoMod, an open comment report and the AutoMod keyword list](docs/screenshots/mod-panel.png)
*Moderator tools — a post held by AutoMod, the report queue, and AutoMod keywords.*

## License

MIT — see [LICENSE](./LICENSE).
