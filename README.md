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
