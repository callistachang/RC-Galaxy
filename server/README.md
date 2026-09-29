# RC Galaxy Server

Python side of RC Galaxy: scripts that pull data from the [RC API](https://github.com/recursecenter/wiki/wiki/Recurse-Center-API), and later the API server for the frontend.

## Setup

Requires [uv](https://docs.astral.sh/uv/).

```sh
cd server
uv sync
```

This creates `.venv/` with the pinned Python version and all dependencies.

Then create `.env` in the **repo root** (not in `server/`):
 
```bash
cp ../.env.example ../.env
```
 
and set `RC_TOKEN` to a personal access token from your [RC settings](https://www.recurse.com/settings/apps).

## Commands
 
Run from `server/`:
 
| Command | What it does |
|---|---|
| `uv run fetch-profiles` | Dumps every RC profile to `data/profiles.json`, which is gitignored |
