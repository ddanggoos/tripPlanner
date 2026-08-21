# AGENTS.md

## Cursor Cloud specific instructions

This repo is a static Korean trip-planner web app (vanilla HTML/JS/CSS, no bundler, no `package.json`). There is nothing to `npm install` or `pip install`.

### Run locally

Serve the repo root so ES modules and `data/trips.json` load:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`. Opening `index.html` via `file://` will fail.

There is no lint, unit test, or production-build step in this repo. The GitHub Pages workflow in `.github/workflows/pages.yml` stamps CSS/JS cache-bust query params; local `http.server` does not stamp them and that is expected.

### Hello-world check

1. Home shows seed trip **샘플 여행** (or previously saved localStorage trips).
2. **새 여행** → name/destination/dates → **만들기**.
3. Trip detail tabs: 정보 / 일정 / 지도 / 빙고.

Edits persist in browser `localStorage` (`tripPlanner:data`). **샘플로 되돌리기** reloads `data/trips.json`.

### Optional cloud pieces (not required to develop)

- Firebase Realtime Database: live share (`#/join/<shareId>`). Client config is committed in `js/firebase-config.js`.
- Google Maps: optional; key is read from Firebase `appConfig/googleMapsApiKey`. If that key is missing or blocked for `http://127.0.0.1:*`, the 지도 tab can show a Google Maps load error. Trip create/edit, 일정, and 빙고 still work without Maps.

See `README.md` for product behavior and Pages deploy.
