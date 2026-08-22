#!/usr/bin/env python3
"""Convert raw CAN-decoded CSVs into time-aligned inverter CSVs + static manifest.

Raw logs are sparse (one CAN message per row). This script:
  1. Keeps every signal column that has at least one non-empty cell (INV_*, VCU_INV_*, …)
  2. Forward-fills them in time order
  3. Emits one row per M172_Torque_And_Timer_Info when present; otherwise keeps
     every row that originally had at least one signal value
  4. Adds `time` + `time_s` (seconds from the first emitted sample)
  5. Preserves subfolders under the input root in the output tree
  6. Writes public/manifest.json for the Vercel static viewer
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
DEFAULT_IN = ROOT / "logs"
DEFAULT_OUT = ROOT / "public" / "data"
DEFAULT_MANIFEST = ROOT / "public" / "manifest.json"

SIGNAL_COLS = [
    "INV_Power_On_Timer",
    "INV_Torque_Feedback",
    "INV_Commanded_Torque",
    "INV_Run_Fault_Hi",
    "INV_Post_Fault_Hi",
    "INV_Run_Fault_Lo",
    "INV_Post_Fault_Lo",
    "INV_Direction_Command",
    "INV_Inverter_Enable_State",
    "INV_Relay_3_Status",
    "INV_Relay_4_Status",
    "INV_Relay_2_Status",
    "INV_Inverter_Run_Mode",
    "INV_Inverter_Command_Mode",
    "INV_Relay_1_Status",
    "INV_Inverter_State",
    "INV_VSM_State",
    "INV_Inverter_Enable_Lockout",
    "INV_Inverter_Discharge_State",
    "INV_Relay_5_Status",
    "INV_Relay_6_Status",
    "INV_BMS_Active",
    "INV_BMS_Torque_Limiting",
    "INV_Max_Speed_Limiting",
    "INV_Low_Speed_Limiting",
    "INV_Rolling_Counter",
    "INV_PWM_Frequency",
    "INV_Start_Mode_Active",
    "INV_Reference_Voltage_12_0",
    "INV_Reference_Voltage_5_0",
    "INV_Reference_Voltage_2_5",
    "INV_Reference_Voltage_1_5",
    "INV_VBC_Vq_Voltage",
    "INV_VAB_Vd_Voltage",
    "INV_Output_Voltage",
    "INV_DC_Bus_Voltage",
    "INV_DC_Bus_Current",
    "INV_Phase_C_Current",
    "INV_Phase_B_Current",
    "INV_Phase_A_Current",
    "INV_Delta_Resolver_Filtered",
    "INV_Electrical_Output_Frequency",
    "INV_Motor_Speed",
    "INV_Motor_Angle_Electrical",
    "INV_Torque_Shudder",
    "INV_Motor_Temperature",
    "INV_RTD5_Temperature",
    "INV_RTD4_Temperature",
    "INV_RTD3_Temperature",
    "INV_RTD2_Temperature",
    "INV_RTD1_Temperature",
    "INV_Control_Board_Temperature",
    "INV_Gate_Driver_Board",
    "INV_Module_C",
    "INV_Module_B",
    "INV_Module_A",
    "INV_Fast_Torque_Command",
    "INV_Fast_Torque_Feedback",
    "INV_Fast_Motor_Speed",
    "INV_Fast_DC_Bus_Voltage",
    "INV_Diag_Record",
    "INV_Diag_Segment",
    "INV_Diag_Gamma_Resolver",
    "INV_Diag_Gamma_Observer",
    "INV_Diag_Sin",
    "INV_Diag_Cos",
    "INV_Diag_Ia",
    "INV_Diag_Ib",
    "INV_Diag_Ic",
    "INV_Diag_Vdc",
    "INV_Diag_Iq_cmd",
    "INV_Diag_Id_cmd",
    "INV_Diag_Mod_Index",
    "INV_Diag_FW_Output",
    "INV_Diag_Vq_Cmd",
    "INV_Diag_Vd_Cmd",
    "INV_Diag_Vqs_Cmd",
    "INV_Diag_12V",
    "INV_Diag_Run_Faults_Lo",
    "INV_Diag_Run_Faults_Hi",
]

EMIT_MESSAGE = "M172_Torque_And_Timer_Info"
TIMESTAMP_COL = "timestamp"
MESSAGE_COL = "message_name"
META_COLS = frozenset({TIMESTAMP_COL, MESSAGE_COL, "arbitration_id"})


def discover_signal_cols(raw: pd.DataFrame) -> list[str]:
    """Columns with at least one non-null value, excluding timestamp / message metadata.

    Prefer the known INV_* schema order, then any other populated signal columns
    (e.g. VCU_INV_* from M192 command messages).
    """
    candidates = [c for c in raw.columns if c not in META_COLS]
    populated: list[str] = []
    for c in candidates:
        series = raw[c]
        if series.isna().all():
            continue
        # Keep columns that have any non-empty / non-null cell
        if series.dtype == object:
            nonempty = series.astype(str).str.strip().ne("") & series.notna()
            if not nonempty.any():
                continue
        populated.append(c)

    preferred = [c for c in SIGNAL_COLS if c in populated]
    extras = sorted(c for c in populated if c not in SIGNAL_COLS)
    return preferred + extras


def convert_frame(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Convert a raw decoded CAN CSV dataframe to inverter time-series format.

    A row is kept if it has any signal cell with data. When M172 timer messages
    exist they are preferred as the emit cadence; otherwise every row that
    originally carried at least one signal value is retained (e.g. M192-only logs).
    """
    meta: dict = {
        "input_rows": int(len(raw)),
        "output_rows": 0,
        "empty": True,
        "missing_cols": [],
    }

    empty_out = pd.DataFrame(columns=["time", "time_s"])
    if raw.empty or TIMESTAMP_COL not in raw.columns:
        return empty_out, meta

    present = discover_signal_cols(raw)
    meta["missing_cols"] = [c for c in SIGNAL_COLS if c not in present]
    if not present:
        return empty_out, meta

    cols = [TIMESTAMP_COL]
    if MESSAGE_COL in raw.columns:
        cols.append(MESSAGE_COL)
    cols.extend(present)

    sub = raw.loc[:, cols].copy()
    for c in present:
        sub[c] = pd.to_numeric(sub[c], errors="coerce")

    # Row has data if any signal cell is non-null before forward-fill
    row_has_data = sub[present].notna().any(axis=1)

    if present:
        sub[present] = sub[present].ffill()

    if MESSAGE_COL in sub.columns and (sub[MESSAGE_COL] == EMIT_MESSAGE).any():
        out = sub[sub[MESSAGE_COL] == EMIT_MESSAGE].copy()
    else:
        # Keep every row that had at least one populated signal cell
        out = sub[row_has_data].copy()
        if out.empty:
            out = sub.drop_duplicates(TIMESTAMP_COL, keep="last").copy()

    # Drop rows that are still entirely empty after selection
    if present:
        out = out[out[present].notna().any(axis=1)].copy()

    if out.empty:
        return empty_out, meta

    out = out.rename(columns={TIMESTAMP_COL: "time"})
    times = pd.to_datetime(out["time"], utc=True, errors="coerce")
    t0 = times.iloc[0]
    out["time_s"] = (times - t0).dt.total_seconds()
    out = out.loc[:, ["time", "time_s", *present]].reset_index(drop=True)

    meta["empty"] = False
    meta["output_rows"] = int(len(out))
    meta["signal_cols"] = present
    meta["t0"] = str(out["time"].iloc[0])
    meta["t1"] = str(out["time"].iloc[-1])
    meta["duration_s"] = float(out["time_s"].iloc[-1]) if len(out) else 0.0
    return out, meta


def input_stem(path: Path) -> str:
    """Base name without .csv or .csv.gz."""
    name = path.name
    if name.endswith(".csv.gz"):
        return name[: -len(".csv.gz")]
    if name.endswith(".csv"):
        return path.stem
    return path.stem


def read_raw_csv(path: Path) -> pd.DataFrame:
    if path.name.endswith(".gz"):
        return pd.read_csv(path, compression="gzip", low_memory=False)
    return pd.read_csv(path, low_memory=False)


def list_raw_csvs(root: Path) -> list[Path]:
    """Recursively list raw CSV / CSV.GZ under root (skip *_inverter.csv)."""
    if not root.is_dir():
        return []
    out: list[Path] = []
    for p in root.rglob("*"):
        if not p.is_file() or p.name.endswith("_inverter.csv"):
            continue
        if p.suffix == ".csv" or p.name.endswith(".csv.gz"):
            out.append(p)
    return sorted(out)


def relative_folder(path: Path, input_root: Path) -> str:
    """POSIX-style parent path relative to input_root ('' if file is at root)."""
    try:
        rel = path.resolve().relative_to(input_root.resolve())
    except ValueError:
        return ""
    parent = rel.parent.as_posix()
    return "" if parent == "." else parent


def manifest_entry(rel_folder: str, stem: str, out_name: str) -> dict:
    """Build one manifest file entry with folder-aware label."""
    rel_path = f"{rel_folder}/{out_name}" if rel_folder else out_name
    file_id = f"{rel_folder}/{stem}" if rel_folder else stem
    label = f"{rel_folder} / {stem}" if rel_folder else stem
    return {
        "id": file_id.replace("\\", "/"),
        "label": label.replace("\\", "/"),
        "path": f"/data/{rel_path.replace(chr(92), '/')}",
    }


def convert_file(path: Path, out_dir: Path, *, rel_folder: str = "") -> dict:
    """Convert one raw CSV into out_dir[/rel_folder]/<stem>_inverter.csv."""
    summary: dict = {"file": path.name, "rel_folder": rel_folder}
    try:
        raw = read_raw_csv(path)
    except Exception as exc:  # noqa: BLE001
        summary.update({"empty": True, "error": str(exc), "input_rows": 0, "output_rows": 0})
        return summary

    if len(raw) == 0:
        summary.update({"empty": True, "input_rows": 0, "output_rows": 0})
        return summary

    out, meta = convert_frame(raw)
    summary.update(meta)

    if meta.get("empty") or out.empty:
        return summary

    out_name = f"{input_stem(path)}_inverter.csv"
    dest_dir = out_dir / rel_folder if rel_folder else out_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    out_path = dest_dir / out_name
    out.to_csv(out_path, index=False)
    summary["output"] = out_name
    summary["output_relpath"] = f"{rel_folder}/{out_name}" if rel_folder else out_name
    summary["manifest"] = manifest_entry(rel_folder, input_stem(path), out_name)

    def _mm(col: str) -> tuple[float | None, float | None]:
        if col not in out or out[col].isna().all():
            return None, None
        return float(out[col].max()), float(out[col].min())

    for key, col in [
        ("cmd_tq", "INV_Commanded_Torque"),
        ("fb_tq", "INV_Torque_Feedback"),
        ("speed", "INV_Motor_Speed"),
        ("vdc", "INV_DC_Bus_Voltage"),
        ("motor_temp", "INV_Motor_Temperature"),
        ("mod_a", "INV_Module_A"),
        ("mod_b", "INV_Module_B"),
        ("mod_c", "INV_Module_C"),
    ]:
        mx, mn = _mm(col)
        if mx is not None:
            summary[f"{key}_max"] = mx
            summary[f"{key}_min"] = mn

    if "INV_DC_Bus_Current" in out:
        summary["idc_max_abs"] = float(out["INV_DC_Bus_Current"].abs().max())

    if "INV_Inverter_Enable_State" in out:
        en = out["INV_Inverter_Enable_State"].fillna(0)
        summary["enable_true"] = int((en != 0).sum())
        summary["enable_false"] = int((en == 0).sum())

    return summary


def write_manifest(entries: list[dict], manifest_path: Path) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "files": sorted(entries, key=lambda e: e["label"].lower()),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(payload, indent=2) + "\n")


def resolve_input(item: str | Path) -> Path:
    p = Path(item)
    if p.is_absolute():
        return p
    in_logs = (DEFAULT_IN / p).resolve()
    if in_logs.exists():
        return in_logs
    return (ROOT / p).resolve()


def collect_inputs(args_inputs: list[str], default_in: Path) -> tuple[Path, list[Path]]:
    """Return (input_root, file_paths) for relative-folder calculation."""
    if not args_inputs:
        root = default_in
        return root, list_raw_csvs(root)

    paths: list[Path] = []
    roots: list[Path] = []
    for item in args_inputs:
        p = resolve_input(item)
        if p.is_dir():
            roots.append(p)
            paths.extend(list_raw_csvs(p))
        else:
            roots.append(p.parent)
            paths.append(p)

    if len(args_inputs) == 1 and resolve_input(args_inputs[0]).is_dir():
        input_root = resolve_input(args_inputs[0])
    else:
        input_root = default_in
        try:
            for p in paths:
                p.resolve().relative_to(default_in.resolve())
        except ValueError:
            input_root = roots[0] if roots else default_in

    return input_root, paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "inputs",
        nargs="*",
        help="Raw CSV files or dirs (default: recursive *.csv under logs/)",
    )
    parser.add_argument(
        "--input",
        dest="input_root_flag",
        type=Path,
        default=None,
        help="Input root directory (recursive). Overrides positional defaults.",
    )
    parser.add_argument(
        "-o",
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output directory (default: {DEFAULT_OUT})",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Manifest JSON path (default: {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="Also write all_sessions_inverter.csv at out-dir root (not included in manifest)",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=None,
        help="Write conversion summary JSON (default: <out-dir>/summary.json)",
    )
    parser.add_argument(
        "--clean-out",
        action="store_true",
        help="Delete existing *_inverter.csv under out-dir before writing",
    )
    args = parser.parse_args(argv)

    if args.input_root_flag is not None:
        input_root = args.input_root_flag if args.input_root_flag.is_absolute() else (ROOT / args.input_root_flag)
        input_root = input_root.resolve()
        paths = list_raw_csvs(input_root)
    else:
        input_root, paths = collect_inputs(args.inputs, DEFAULT_IN)

    seen: set[Path] = set()
    uniq: list[Path] = []
    for p in paths:
        rp = p.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        uniq.append(rp)

    out_dir = args.out_dir if args.out_dir.is_absolute() else (ROOT / args.out_dir)
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.clean_out and out_dir.exists():
        for old in out_dir.rglob("*_inverter.csv"):
            old.unlink(missing_ok=True)

    manifest_path = args.manifest if args.manifest.is_absolute() else (ROOT / args.manifest)

    summaries: list[dict] = []
    written: list[Path] = []
    manifest_entries: list[dict] = []

    for path in uniq:
        if not path.exists():
            print(f"skip missing: {path}", file=sys.stderr)
            continue
        rel_folder = relative_folder(path, input_root)
        display = f"{rel_folder}/{path.name}" if rel_folder else path.name
        print(f"converting {display} …", flush=True)
        summary = convert_file(path, out_dir, rel_folder=rel_folder)
        summaries.append(summary)
        if summary.get("output"):
            rel = summary["output_relpath"]
            written.append(out_dir / rel)
            manifest_entries.append(summary["manifest"])
            print(
                f"  -> {rel} "
                f"({summary.get('input_rows', 0)} -> {summary.get('output_rows', 0)} rows)"
            )
        else:
            print(f"  -> empty / skipped ({summary.get('input_rows', 0)} input rows)")

    write_manifest(manifest_entries, manifest_path.resolve())
    print(f"wrote {manifest_path.resolve()} ({len(manifest_entries)} files)")

    summary_path = args.summary or (out_dir / "summary.json")
    if not summary_path.is_absolute():
        summary_path = ROOT / summary_path
    summary_path.write_text(json.dumps(summaries, indent=2) + "\n")
    print(f"wrote {summary_path}")

    if args.merge and written:
        frames = []
        for p in written:
            df = pd.read_csv(p)
            try:
                rel = p.relative_to(out_dir).as_posix()
            except ValueError:
                rel = p.name
            df.insert(0, "source_file", rel)
            frames.append(df)
        merged = pd.concat(frames, ignore_index=True)
        merge_path = out_dir / "all_sessions_inverter.csv"
        merged.to_csv(merge_path, index=False)
        print(f"wrote {merge_path} ({len(merged)} rows) [not in manifest]")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
