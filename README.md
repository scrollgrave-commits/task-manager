# Task Manager

A full-stack task list application: add, edit, complete/incomplete and delete tasks
through a clean responsive web UI, backed by a REST CRUD API and a real SQLite database.

## Features

- Create tasks with a title and optional description
- Edit any task's title and description inline
- Mark tasks complete or incomplete
- Delete tasks (two-step confirm)
- Filter by All / Active / Completed with live counts
- Action feedback: toast messages on every add, edit, toggle and delete, plus error toasts
- Responsive layout that works on phone and laptop widths
- Proper API error handling: validation errors (400), not found (404), server errors (500)

## Tech stack

- **Backend:** Node.js + Express (REST API)
- **Database:** SQLite via Node's built-in `node:sqlite` module (file `tasks.db`, created automatically)
- **Frontend:** Vanilla HTML/CSS/JavaScript served by the same server (no build step)

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
| PUT    | `/:id`               | Edit title/description and/or set `completed` | 200 | 400, 404   |
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

The UI is a dark, content-first task list built from published design writing on
task-management interfaces, not arbitrary styling:

- **Neutral palette, color only for meaning** - the interface is near-monochrome with one
  emerald accent for the primary action and completion, red only for delete. Pattern from
  Things 3's visual restraint: <https://blakecrosley.com/guides/design/things> and
  <https://www.tapsmart.com/features/the-classic-app-things/>
- **Rewarding completion** - the custom circular checkbox fills and draws its check with a
  small pop, because the check-off moment is the core loop of a task app:
  <https://blakecrosley.com/guides/design/things>, <https://xavd.id/blog/post/my-perfect-task-app/>
- **Low visual noise, fast ease-out motion** - hairline borders, one accent, short
  decelerating transitions, following Linear's redesign notes:
  <https://linear.app/now/how-we-redesigned-the-linear-ui> and
  <https://www.figma.com/blog/the-linear-method-opinionated-software/>
- **Immediate feedback for every action** - toast confirmation on add, edit, complete,
  reopen and delete, inline validation, and the destructive action in red:
  <https://ixd.prattsi.org/2024/01/design-critique-todoist-ios-app/>
- **Progress at a glance** - the header shows a live "X of Y done" count with a thin
  progress bar; completed tasks sink to the bottom, fade and take a dashed border instead
  of competing with active work.
- **Mobile-first** - full-width rows, 44px touch targets, action buttons move to their own
  row on narrow screens, and reduced-motion users get instant transitions.

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

| Desktop | Mobile |
| ------- | ------ |
| ![Desktop view](screenshots/desktop.png) | ![Mobile view](screenshots/mobile.png) |

API examples:

- [Write operations: create (201), update (200), invalid type (400)](screenshots/api-create.png)
- [List active tasks (200)](screenshots/api-list.png)
- [Error handling: validation, not found, malformed JSON (400/404)](screenshots/api-errors.png)
