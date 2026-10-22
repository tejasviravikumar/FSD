# Nexora Learning frontend

React + Vite application for the Nexora Industries training API.

## Run locally

1. Start the backend from the repository root with `npm run dev`.
2. Copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` if the API is not at `http://localhost:4000/api/v1`.
3. From this folder, run `npm ci`, then `npm run dev`.

The frontend runs at the Vite URL, normally `http://localhost:5173`. The backend must allow that origin in `CORS_ORIGINS`.

## Structure

- `src/auth`: login and password recovery UI.
- `src/layout`: role-aware app shell and navigation.
- `src/pages`: dashboards, course player, course management, admin tools, reports and notifications.
- `src/components`: shared tables, dialogs, headings and empty/error states.
- `src/app`: React Query client configuration.
- `src/api.js`: API base URL, in-memory access token, cookie refresh, CSRF header and downloads.
- `src/utils.js`: shared formatting and response helpers.

The refresh token stays in the backend's httpOnly cookie; the short-lived access token is held in memory only. Set the API URL through the `VITE_API_URL` environment variable.
