# The Deck - Task Manager

A full-stack task list application built around a physical metaphor: your tasks are a
deck of paper index cards on a dark desk. Instead of scanning a list to decide what to
do, you work the **top card** - finish it or send it to the back - one decision at a
time. A full management view (the spread) sits one tap away.

Backed by a REST CRUD API and a real SQLite database.

## Features

- **The deck** - active tasks as a stack of index cards; the top card is your focus
- **Drag the top card**: fling right to complete it, left to send it to the back of the
  deck - with real spring physics (the card tracks your pointer 1:1, keeps your throw's
  velocity, and stamps DONE as you commit)
- **Permanent Done / Later buttons** that do exactly what the gestures do (a drag cannot
  be made with a keyboard or switch), plus Undo on every completion toast
- Create cards with a title and optional note ("deal a card")
- Edit any card's title and note inline - on the deck card or in the spread
- Delete cards (two-step confirm)
- Mark tasks complete/incomplete from the spread's check circles too
- Spread view with All / Active / Completed filters and live counts
- Progress ring in the header ("X of Y done")
- Action feedback: toast on every add, edit, complete, reopen and delete, plus error toasts
- Responsive layout for phone and laptop; honors prefers-reduced-motion
- Proper API error handling: validation errors (400), not found (404), server errors (500)

## Tech stack

- **Backend:** Node.js + Express (REST API)
- **Database:** SQLite via Node's built-in `node:sqlite` module (file `tasks.db`, created automatically)
- **Frontend:** Vanilla HTML/CSS/JavaScript served by the same server (no build step)

## Live demo

Hosted on Cloudflare Workers + D1 (the same REST API, backed by a durable SQLite-compatible database):
**https://the-deck-tasks.scrollgrave.workers.dev**

It is a public assignment demo: anyone with the link can add, edit, complete and delete its tasks.

## Setup

Requires Node.js **22.5 or newer** (for the built-in SQLite module).

```bash
npm install
npm start
```

Then open http://localhost:3000 in a browser.

The SQLite database file `tasks.db` is created automatically in the project folder on first run.

## API endpoints

Base URL: `http://localhost:3000/api/tasks`

| Method | Endpoint             | Description                        | Success | Errors          |
| ------ | -------------------- | ---------------------------------- | ------- | --------------- |
| GET    | `/`                  | List tasks (`?status=all|active|completed`) | 200 | 400 bad status  |
| POST   | `/`                  | Create a task `{title, description?}`      | 201 | 400 validation  |
| GET    | `/:id`               | Get one task                       | 200     | 400, 404        |
| PUT    | `/:id`               | Edit `title`/`description`, set `completed`, set `sort_order` (deck position), and/or reattach a completion stamp with `completed_at` + `completed_at_estimated` (requires the task to be completed) | 200 | 400, 404   |
| DELETE | `/:id`               | Delete a task                      | 204     | 400, 404        |

All responses are JSON. Errors return `{ "error": "message" }`.

### Example requests

```bash
# Create a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy groceries", "description": "Milk, eggs, bread"}'

# Mark task 1 complete
curl -X PUT http://localhost:3000/api/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'

# List only active tasks
curl "http://localhost:3000/api/tasks?status=active"

# Delete task 1
curl -X DELETE http://localhost:3000/api/tasks/1
```

## Design rationale

The concept and its execution come from published design work on task interfaces,
swipe-deck patterns and interface motion - each decision below names its source.

**The concept: a deck, not a list.**
Doo (iOS) proved a card stack works as a task manager for "the one-track mind": enter
tasks as cards, handle them one at a time, swipe to complete or snooze
(<https://www.macstories.net/reviews/doo-review-a-different-take-on-the-task-manager-genre/>).
The Deck adopts that focus model and fixes its two known weak points using the
swipe-deck pattern's own usability notes
(<https://vocab.design/swipe-deck>):

- **Visible buttons for every gesture, permanently** - a drag cannot be performed with a
  keyboard, switch or voice, so Done and Later sit under the deck at all times and do
  exactly what the two drag directions do.
- **Undo for fast decisions** - deck decisions are quick and cheap, so every completion
  toast carries an Undo that deals the card back to the front.
- **Send-to-back keeps the card in the deck** (MacStories' reviewer criticised Doo for
  removing snoozed cards from the stack; here a "later" card rotates to the back and its
  position is persisted in the database via `sort_order`).

**The motion: real springs, direct manipulation.**
From Karl Koch's "10 Principles for Fluid UI"
(<https://karlkoch.me/writing/10-principles-for-fluid-ui/>):

- The card tracks the pointer 1:1 while dragged (principle 3, direct manipulation).
- Release velocity is preserved into the fling-off animation instead of restarting from
  zero (principle 4); a slow drag past the threshold and a fast flick both complete, and
  feel different.
- Snap-back uses a stiffness/damping spring (300/22, inside Koch's recommended ranges)
  rather than a fixed-duration ease, and every animation is interruptible (principles 1-2).
- Under-cards settle with an overshoot spring curve when the stack changes
  (principle 7, helped users follow layout changes).
- `prefers-reduced-motion` replaces all of it with instant state changes (principle 10).

**The surface: paper on a dark desk.**
The palette keeps the restraint praised in Things 3 - near-monochrome chrome, one
emerald accent reserved for completion and the primary action, red only for destructive
steps (<https://blakecrosley.com/guides/design/things>,
<https://www.tapsmart.com/features/the-classic-app-things/>) - while the warm paper card
with ruled lines makes the deck metaphor literal and keeps ink-on-paper contrast high
(WCAG AA on every text/background pair).

## Deployment (Cloudflare Workers + D1)

The app also ships a Workers port in `worker/` (same REST contract as `server.js`, D1 instead of the local SQLite file).

```bash
npm install
npx wrangler d1 create task-manager-db   # paste the returned database_id into wrangler.toml
npx wrangler d1 execute task-manager-db --remote --file=worker/schema.sql
npx wrangler deploy
```

`wrangler.toml` keeps a placeholder `database_id` on purpose: replace it with the id from your own `wrangler d1 create`.

### Deploy checklist (learned the hard way)

On 2026-11-05 a deploy built its config from scratch instead of from `wrangler.toml` and dropped the `[assets]` block. The worker deployed fine, but the frontend returned "Internal server error" until a corrected config was deployed (~15 seconds of outage). Two rules came out of it:

1. **Build any temporary deploy config from `wrangler.toml`** (e.g. `sed` the real `database_id` in), never from a minimal skeleton. The `[assets]` block and every other base setting must survive.
2. **Smoke-check the frontend right after every deploy**, not just the API: `curl -s <url>/` returns the app HTML, `styles.css` and `app.js` serve the current build, and the API regression suite passes. An API-only check would have called the broken deploy green.

## Project structure

```
task-manager/
├── server.js            # Entry point: Express setup, static files, error handler
├── src/
│   ├── db.js            # SQLite database layer (table creation + queries)
│   ├── validate.js      # Shared input validation
│   └── routes/
│       └── tasks.js     # REST CRUD routes
├── public/              # Frontend (served statically)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── screenshots/         # UI and API screenshots
├── package.json
└── README.md
```

## Screenshots

| The deck (desktop) | The deck (mobile) |
| ------- | ------ |
| ![Desktop deck view](screenshots/desktop.png) | ![Mobile deck view](screenshots/mobile.png) |

| Dragging a card to done | Spread (management) view |
| ------- | ------ |
| ![Mid-drag with DONE stamp](screenshots/deck-mid-drag.png) | ![Spread view](screenshots/spread.png) |

- [Add-card validation error state](screenshots/error-state.png)

API examples:

- [Write operations: create (201), update (200), invalid type (400)](screenshots/api-create.png)
- [List active tasks (200)](screenshots/api-list.png)
- [Error handling: validation, not found, malformed JSON (400/404)](screenshots/api-errors.png)

### Interaction refinement

Done and Later update the local deck immediately and save in parallel with a 230ms exit.
The next card moves forward without a follow-up list fetch. Writes are locked per task;
rapid double clicks cannot submit the same card twice. A saving indicator distinguishes
pending changes from confirmed saves. Failed writes restore the card, show an error,
and reconcile with the server. Undo failures are caught and reported. Drag and snap-back
transforms no longer compete with a CSS transition. Reduced motion skips the exit.
Desktop arrow keys also operate the deck when focus is outside a form or button.

The compact responsive layout keeps the paper-card deck and separates the composer
from the active card. API routes and the SQLite/D1 schema are unchanged.

### Workspace and gesture refinement

The focus/spread switch sits in a shared toolbar with the active-card count, so it
stays in the same place in both views. The composer has its own labelled section.
Laptop layouts adjust vertically on shorter displays; mobile retains full-width
controls. During a horizontal drag, the underlying cards move forward in proportion
to the drag distance and settle back on cancellation. The view switch crossfades
when the browser supports View Transitions, with an immediate fallback and reduced-
motion support. Saves and card handoff keep the same non-blocking path.

### The spread becomes a real spread

The management view now lays tasks out as paper mini-cards on the desk instead of
generic list rows, keeping the deck metaphor in both views. Cards alternate a
slight desk-drop rotation and lift flat on hover. Completed cards tilt and
carry a small DONE stamp, a filled check and a crossed-out title instead of an
opacity fade: fading the whole card composited text down to unreadable contrast,
so the completed state now comes from paper cues while every word and action on
the card stays fully legible (4.5:1 or better against the muted paper). Entering the
spread or changing a filter deals the cards in with a staggered spring entrance;
a card created while the spread is open deals itself in on its own. Editing and
the two-step delete stay on each card, and the check circle still completes or
reopens a task. All of it honors prefers-reduced-motion, and the API and deck
handoff path are untouched.

### Desk transitions and empty desks

The view switch uses named view transitions for the stable chrome - header,
toolbar and composer morph smoothly between the two layouts instead of
double-exposing as full-page ghosts, while the deck and spread content crossfade
in place. The spread remembers itself across reloads, so the desk you were
managing is the desk you return to. Empty states say which filter emptied the
desk: "The deck is clear" for no active cards, "Nothing done yet" for no
completed ones, and a prompt to deal the first card when there are none at all.

### Toolbar text swaps without double-exposure

The desk toolbar keeps its place across views, but its words change: "Focus
deck" becomes "All your cards" and the toggle flips its label. Crossfading the
whole bar showed both texts overlapped mid-transition. The swapping pieces now
get their own named transitions with a quick out-then-in (80ms out, 120ms in),
so the bar stays put while its words flip one at a time. Verified frame by
frame at slowed speed: no two labels share the bar at any moment.

### Finished cards say when they were finished

Completing a card used to look like an edit: the meta line read "edited" for
every finished card, because completion bumped the same timestamp as a content
change. The API now stamps `completedAt` the moment a card is done (and clears
it if the card is reopened), so completed cards read "Done ..." instead, and
"edited" only appears for true content edits. Existing databases gain the
column through an additive migration. Stamps carry provenance: cards completed
before tracking existed are backfilled from their last update (exact only if
finishing was the last change to the card) and are marked estimated - the API
returns `completedAtEstimated: true` for them and the UI reads "Done around ..."
instead of "Done ...". Completions from this version on are recorded exactly.
The one-time flip happens only in the moment the migration column is first
added, so restarts never mislabel a fresh exact stamp.

**Pick up a card from the spread, and cards that read as decks.**
Two cues from the Tactile Card Stack page design
(<https://antjanus.com/page-designs/card-stack>): every spread card now carries
hard-edged card layers beneath it (offset solid paper tones, not more blur), so
each card reads as a small deck on the desk; and clicking an active card in the
spread picks it up - it jumps to the top of the focus deck so you can act on it
immediately. Completed cards stay put, an open edit form absorbs its own clicks,
and the move is optimistic with the same rollback discipline as a swipe. The
deck edge stays flat under reduced motion and adds no work to first paint.

**Cards lean toward the cursor.**
On fine pointers, a spread card tilts a few degrees toward the cursor (same
Tactile Card Stack reference as above) and settles back when the cursor leaves.
Resting rotation, hover lift and the lean compose through CSS custom properties
so they never fight each other. Touch and reduced-motion users get the flat,
stable spread. Picking up also has an explicit Pick up button on every active
card - keyboard reachable - and a click that ends a text selection never moves
a card.

**Spread card footers stack.**
The card meta line sits on its own row above the action buttons, so added/done
stamps never wrap into orphaned fragments when all three actions are present.

**Deleted cards can be brought back.**
Deleting shows Undo for five seconds, same as completing. The restore re-deals
the card's content at its old deck position and reattaches the original
completion stamp with its provenance flag - an estimated "Done around" stays
estimated, an exact "Done" stays exact (the API accepts `completed_at` and
`completed_at_estimated` on PUT for exactly this). A restored card is a new
row, so its Added stamp starts fresh; an update within a minute of creation no
longer shows as "edited", so restores (and quick touch-ups) don't stamp noise.
