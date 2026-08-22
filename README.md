# Inverter signal viewer (React + Vite)

Static viewer for converted motor-test inverter CSVs. Production lists files from
`public/manifest.json` (folder-aware labels) and loads CSVs from `public/data/`.

## Quick start

```bash
../.venv/bin/python convert_inverter_csv.py   # logs/ → public/data + manifest
npm install
npm run dev                                   # http://127.0.0.1:5173/
```

## Deploy (Vercel + GitHub Actions)

See [DEPLOY.md](DEPLOY.md) for Option A: sync `session_logs` from Motor_Test_Bench on push/nightly, convert in CI, ship static assets to Vercel.
