# Request Interceptor - Claude's Improvement Plan

## Context

**What is this project?** A "man-in-the-middle" HTTP proxy that logs all web requests passing through it, with special handling for AI API calls (OpenAI, Anthropic, etc). It has a web dashboard to view the logged requests.

**Why are we improving it?** The core functionality works, but the user experience needs significant improvement - requests are shown in a flat list with no grouping, there's no way to track where you were when navigating, and several code quality issues need fixing.

**Who is working on it?** Three AI assistants (Claude, Gemini, Codex) each on their own branch. We'll compare results and merge the best work.

---

## Quick Concepts You Need Before We Start

We'll learn deeper as we go, but here are the absolute basics:

### The Two Ports (3100 vs 3101)
- **Port 3100 = Admin Dashboard** - The website you see with the table of requests. This is for YOU to look at logs.
- **Port 3101 = The Proxy** - This is where other apps send their requests THROUGH. When you visited localhost:3101 in your browser, your browser sent a request through the proxy. That's why a new log appeared on 3100! Port 3101 isn't a website to view - it's a gateway that catches and logs requests passing through it.

### HTTP Methods (GET, POST, etc.)
Think of these like different "actions" you can do on the internet:
- **GET** = "Give me data" (loading a webpage, fetching a list)
- **POST** = "Here's new data, save it" (submitting a form, sending a message)
- **PUT** = "Replace this data entirely"
- **DELETE** = "Remove this data"

### What's a Proxy / Man-in-the-Middle?
Normally: `Your App --> API Server`
With this tool: `Your App --> Request Interceptor (port 3101) --> API Server`
The interceptor sits in the middle, logs everything it sees, then passes the request along. Like a security camera on a hallway - it records who walks through but doesn't block them.

### TypeScript vs Java
TypeScript is very similar to Java! Key differences you'll notice:
- `const` / `let` instead of type declarations (`const x = 5` instead of `int x = 5`)
- Functions: `function doThing(x: string): number` (type AFTER the name)
- Arrow functions: `(x) => x + 1` (like Java lambdas)
- `interface` works similarly to Java interfaces

We'll explain more as we encounter it in the code.

---

## Workflow Setup

### Step 1: Create Claude's Branch
```bash
cd request-interceptor
git checkout main
git checkout -b claude/ux-improvements
```

### Step 2: Seed Dummy Data
The dashboard is empty because no requests have been logged yet. We'll create a script that injects realistic test data directly into the database so we have something to look at while developing.

- **File to create:** `scripts/seed-dummy-data.ts`
- **What it does:** Inserts ~30 fake request logs (mix of GET, POST, AI and regular requests) with realistic URLs, status codes, response times, and a few AI request records with token/cost data
- **How to run:** Via Docker exec into the running container

### Step 3: How to Preview Changes
Since the project runs in Docker, after making code changes:
1. Rebuild: `docker compose up --build -d`
2. Open `http://localhost:3100` in Chrome
3. Check if the changes look right

For faster development later, we can set up local dev mode (no Docker rebuild needed).

---

## Phased Improvement Plan

### Phase 1: Foundation & Quick Wins
*High impact, low effort. Gets us visible improvements fast.*

#### 1.1 Seed Dummy Data for Development
- **Create** `scripts/seed-dummy-data.ts` - Script to populate DB with realistic test data
- **Why:** Can't improve UX if we can't see anything on screen

#### 1.2 Make Request Rows Proper Links (Enables "Open in New Tab")
- **File:** `frontend/src/pages/Dashboard.tsx` (lines 498-584)
- **What:** The table rows currently use `<Link>` on just the path text. We should make the entire row navigable and ensure right-click "Open in New Tab" works naturally
- **Current code:** Only the path cell (line 513-519) is a `<Link>`. The row itself just has hover styling
- **Fix:** Wrap each row properly so the browser's native "Open in new tab" (Ctrl+click or right-click) works on any part of the row

#### 1.3 Add "Back" Navigation on Request Detail Page
- **File:** `frontend/src/pages/RequestDetail.tsx`
- **What:** When you click into a request detail, add a "Back to list" button/breadcrumb that returns you to exactly where you were (preserving filters and scroll position)
- **Current:** Uses `navigate(-1)` which may not always work correctly

#### 1.4 Better Empty State
- **File:** `frontend/src/pages/Dashboard.tsx` (lines 476-494)
- **What:** When there are no logs, show helpful instructions explaining what the proxy is and how to generate traffic (instead of just "No requests logged yet")

#### 1.5 Persist All Filter State in URL
- **File:** `frontend/src/pages/Dashboard.tsx`
- **What:** Already partially done with `useSearchParams` (line 44). But scroll position isn't preserved. Add scroll restoration so when you go back from a detail view, you return to the same scroll position

---

### Phase 2: Core UX Improvements (Your Top 3 Goals)
*The main features you asked for.*

#### 2.1 Request Grouping by Connected Requests
- **Files:** `frontend/src/pages/Dashboard.tsx`, potentially new component `frontend/src/components/RequestGroup.tsx`
- **What:** Group requests that are related. For example:
  - Requests to the same host within a short time window (e.g., 5 seconds)
  - Requests that share the same target URL base
  - AI requests that are part of the same conversation
- **How:** Add a toggle "Group by connection" that collapses related requests under a single expandable row showing the count and summary
- **Grouping logic:** Match by `targetUrl` hostname + similar path prefix + timestamp within 5-second window
- **No database changes needed** - this is a frontend-only grouping

#### 2.2 Navigation History / Click Following
- **Files:** `frontend/src/App.tsx`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/RequestDetail.tsx`
- **What:** When you click through requests and hit "back", you should land exactly where you were:
  - Same filters active
  - Same scroll position
  - Visual indicator of which request you last viewed
- **How:** 
  - Use URL search params (already started) for filters
  - Use `sessionStorage` to save scroll position per route
  - Highlight the "last viewed" row with a subtle background color

#### 2.3 Open in New Tab Support
- **Files:** `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/AiDashboard.tsx`
- **What:** All clickable items should be real `<a>` links so users can:
  - Right-click -> "Open in new tab"
  - Ctrl/Cmd+click to open in new tab
  - Middle-click to open in new tab
- **Current issue:** The AiDashboard uses `navigate()` (programmatic) instead of `<Link>` components, which breaks native browser tab behavior
- **Fix:** Replace all `onClick={() => navigate(...)}` with proper `<Link to={...}>` components

---

### Phase 3: Code Quality & Bug Fixes
*Making the codebase more robust and maintainable.*

#### 3.1 Fix Socket.IO CORS Wildcard
- **File:** `src/lib/socketServer.ts`
- **What:** Currently `origin: '*'` which is a security issue. Restrict to the admin dashboard origin
- **Simple fix:** Use the admin port URL as the allowed origin

#### 3.2 Move Search/Filter to Server-Side
- **File:** `src/admin.ts` (the `/api/logs` endpoint), `frontend/src/pages/Dashboard.tsx`
- **What:** Currently, search and status filtering happen client-side (Dashboard.tsx lines 235-260). This means:
  - Search only works on the loaded 50 requests, not ALL requests in DB
  - Status filter same problem
- **Fix:** Add `search` and `statusCode` query params to the `/api/logs` backend endpoint, move filtering to SQL

#### 3.3 Improve Error Messages
- **Files:** All frontend pages
- **What:** Show user-friendly errors instead of raw "Failed to fetch" messages
- **Examples:** "Can't connect to server - is Docker running?" instead of "TypeError: Failed to fetch"

#### 3.4 Split admin.ts Into Route Modules
- **File:** `src/admin.ts` (1125 lines - too big)
- **What:** Split into separate route files:
  - `src/routes/logs.ts` - Request log endpoints
  - `src/routes/ai-requests.ts` - AI request endpoints
  - `src/routes/routing-rules.ts` - Routing rule endpoints
  - `src/routes/config.ts` - Config endpoints
  - `src/routes/stats.ts` - Analytics endpoints
  - `src/routes/models.ts` - Model info endpoints

---

### Phase 4: Polish & Nice-to-Haves
*If time allows, these make it professional.*

#### 4.1 Dark Mode Toggle
- **Files:** `frontend/src/App.tsx`, `frontend/tailwind.config.js`, all pages
- **What:** Add a dark/light mode toggle. Tailwind has built-in dark mode support

#### 4.2 Export Logs (CSV/JSON)
- **Files:** `src/admin.ts` (new endpoint), `frontend/src/pages/Dashboard.tsx` (export button)
- **What:** Add a "Download" button to export filtered logs as CSV or JSON

#### 4.3 Request Diff / Comparison
- **Files:** New page `frontend/src/pages/RequestCompare.tsx`
- **What:** Select two requests and see a side-by-side diff of their headers/bodies

#### 4.4 Keyboard Shortcuts
- **Files:** `frontend/src/App.tsx` or new hook
- **What:** `j`/`k` to move between requests, `Enter` to view details, `Escape` to go back

---

## How We Work

1. **Branch:** All Claude work goes on `claude/ux-improvements`
2. **Commits:** Small, clear commit messages (e.g., "feat: add request grouping toggle on dashboard")
3. **Testing:** After each change, rebuild Docker and check in Chrome at localhost:3100
4. **Learning:** I'll explain concepts as we encounter them in the code, not in advance
5. **Verification:** Use the Chrome browser to visually confirm each change works

## Verification Plan

After each phase:
1. `docker compose up --build -d` to rebuild
2. Open `http://localhost:3100` in Chrome
3. Check each new feature visually
4. Test edge cases (empty state, many requests, error states)
5. Commit the working code with a clear message
6. Push to the remote branch

## Key Files Summary

| File | Purpose | Phases |
|------|---------|--------|
| `frontend/src/pages/Dashboard.tsx` | Main request list | 1, 2, 3 |
| `frontend/src/pages/RequestDetail.tsx` | Single request view | 1, 2 |
| `frontend/src/pages/AiDashboard.tsx` | AI analytics | 2 |
| `frontend/src/App.tsx` | Router & navigation | 2, 4 |
| `src/admin.ts` | Backend API | 3 |
| `src/lib/socketServer.ts` | WebSocket setup | 3 |
| `scripts/seed-dummy-data.ts` | Test data generator | 1 |
| `prisma/schema.prisma` | Database schema | Reference only |
