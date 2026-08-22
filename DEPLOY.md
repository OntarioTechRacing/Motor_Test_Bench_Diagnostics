# Deploying the signal viewer (Option A)

## Architecture

- **Webapp repo** (this folder): React/Vite app + `convert_inverter_csv.py`
- **Motor_Test_Bench** (separate): source of truth for `session_logs/**`
- **GitHub Action** (`sync-session-logs.yml`): sparse-checkouts `session_logs`, converts, commits `public/data/` + `public/manifest.json`
- **Vercel**: builds static site from this repo (Git integration). No runtime backend.

Triggers: push to `session_logs` (via dispatch from MTB) · nightly 06:00 UTC · manual Actions button.

Dropdown labels look like `FolderName / 2026-08-04_16-47-17`.

## Session log format

- Motor_Test_Bench stores logs as **`session_logs/<folder>/*.csv.gz`** (gzip-compressed CSV).
- The converter decompresses `.csv.gz` automatically.
- Any row with **at least one non-empty signal cell** is kept (e.g. `INV_*` from M172 or `VCU_INV_*` from M192). Completely blank signal rows are dropped.
- When M172 timer messages exist they set the sample cadence; otherwise every row that carried signal data is emitted.
- If a sync finds no convertible logs, **existing `public/data` is left unchanged** (the workflow will not wipe the site).

## One-time setup

### 1. Put this webapp in its own GitHub repo

Root of the Git repo should be the `webapp/` directory (or keep monorepo and set Vercel root to `webapp`).

### 2. Secrets on the **webapp** repo

| Secret | Purpose |
|--------|---------|
| `MTB_READ_TOKEN` | Fine-grained or classic PAT: `contents:read` on `OntarioTechRacing/Motor_Test_Bench` |

### 3. Secrets / vars on **Motor_Test_Bench**

Copy [`deploy/motor-test-bench-notify-session-logs.yml`](deploy/motor-test-bench-notify-session-logs.yml) to:

`Motor_Test_Bench/.github/workflows/notify-session-logs.yml`

| Name | Where | Purpose |
|------|--------|---------|
| `WEBAPP_DISPATCH_TOKEN` | Secret | PAT with permission to send `repository_dispatch` to the webapp repo |
| `WEBAPP_REPO` | Variable | `OntarioTechRacing/Motor_Test_Bench_Diagnostics` |

### 4. Vercel

1. Import the webapp GitHub repo.
2. Framework: Vite. Build: `npm run build`. Output: `dist`.
3. Prefer **Pro** if `public/data` will exceed ~100 MB (Hobby CLI/source limits).
4. Do **not** deploy raw `logs/` (keep them gitignored).

### 5. First sync

Actions → **Sync session logs** → Run workflow. After it commits, Vercel redeploys.

## Local development

```bash
cd webapp
../.venv/bin/python convert_inverter_csv.py          # uses logs/ → public/data + manifest
# or pull session_logs and:
../.venv/bin/python convert_inverter_csv.py --input /path/to/session_logs --clean-out
npm run dev
```

## Size warning

Converted corpus can exceed Vercel Hobby upload limits (~100 MB). Prefer **Vercel Pro** (~1 GB) or:

- Omit huge sessions / never commit `all_sessions_inverter.csv`
- Use **Git LFS** for `public/data/**/*.csv` if GitHub file size limits hit
- If total converted stays above ~1 GB, move CSV bytes to object storage (Option B) and keep the same `manifest.json` `{ id, label, path|url }` shape

## Optional Git LFS

```bash
git lfs install
git lfs track "public/data/**/*.csv"
git add .gitattributes
```
