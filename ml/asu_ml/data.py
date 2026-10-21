"""Strict acquisition, event-level quarantine and frozen chronological splits."""

from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

SOURCE_URL = "https://www.datosabiertos.gob.pe/sites/default/files/Interrupciones_Dataset.csv"
EXPECTED_SHA = "0798ed3ef4a649b8f4b0c75a37a3799d3694abfcaa7d7524c80cb0ebf04d2a4c"
COLUMNS = ["IDINTERRUPCION", "EPS", "SEDE", "TIPOINTERRUPCION", "TIPOSERVICIO",
           "MOTIVOINTERRUPCION", "FECHAINICIO", "HORAINICIO", "FECHAFIN", "HORAFIN",
           "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "NUMCONEXDOM", "UNIDADESUSO",
           "NUMCAMIONESPUNTOS"]
SEMANTICS = {"status": "experimental", "target_semantics": "reported_duration_not_actual_restoration",
             "label_semantics_approved": False}


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_csv(path):
    return pd.read_csv(path, sep=",", encoding="utf-8", encoding_errors="strict", dtype=str,
                       keep_default_na=False, on_bad_lines="error")


def ingest(source=None, cache=None, expected_sha=EXPECTED_SHA, allow_source_update=False, refresh=False):
    """Read an explicit file offline or fetch with bounded retries; cache by content hash.

    A supplied file never triggers HTTP. A default cached snapshot is accepted only
    after verification. An update requires explicit approval of changed source bytes.
    """
    cache = Path(cache)
    if source is not None:
        content = Path(source).read_bytes()
    elif not refresh and (cache / f"{expected_sha}.csv").exists():
        content = (cache / f"{expected_sha}.csv").read_bytes()
    else:
        for attempt in range(3):
            try:
                with urlopen(Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0 AsuResearch/1.0"}),
                             timeout=45) as response:
                    content = response.read(50 * 1024 * 1024 + 1)
                if len(content) > 50 * 1024 * 1024:
                    raise ValueError("Source exceeds 50 MiB bounded acquisition budget")
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    digest = hashlib.sha256(content).hexdigest()
    if digest != expected_sha and not allow_source_update:
        raise ValueError(f"Source SHA mismatch: expected {expected_sha}, received {digest}; use --allow-source-update explicitly")
    # Validate before any write. Schema/encoding errors never corrupt the cache.
    raw = read_csv(io.BytesIO(content))
    if list(raw.columns) != COLUMNS:
        raise ValueError(f"Source schema mismatch: expected {COLUMNS}, received {list(raw.columns)}")
    canonical_hash = hashlib.sha256(
        raw.sort_values(COLUMNS, kind="stable").to_csv(index=False).encode("utf-8")
    ).hexdigest()
    target = cache / f"{digest}.csv"
    existed = target.exists()
    if existed and sha256(target) != digest:
        raise ValueError("Immutable cache integrity violation")
    if not existed:
        cache.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(content)
    return {**SEMANTICS, "status": "no_op" if existed else "ingested", "path": str(target),
            "source_url": SOURCE_URL, "source_sha256": digest, "expected_sha256": expected_sha,
            "source_update_explicit": allow_source_update, "canonical_sha256": canonical_hash,
            "bytes": len(content), "rows": len(raw), "columns": COLUMNS,
            "retrieved_utc": datetime.now(timezone.utc).isoformat(), "license": "ODC-BY",
            "attribution": "SUNASS / Plataforma Nacional de Datos Abiertos del Perú",
            "dictionary_url": SOURCE_URL.replace("Dataset.csv", "DiccionarioDatos.xlsx"),
            "metadata_url": SOURCE_URL.replace("Dataset.csv", "Metadato.docx")}


def canonical_events(raw):
    if list(raw.columns) != COLUMNS:
        raise ValueError("Source schema mismatch: exact 16-column SUNASS schema required")
    raw = raw.fillna("").astype(str)
    exact_duplicates = int(raw.duplicated().sum())
    missing = {c: int(raw[c].str.strip().eq("").sum()) for c in COLUMNS}
    frame = raw.copy()
    normalizations = {}
    for col in COLUMNS:
        cleaned = frame[col].str.strip()
        changes = frame.loc[frame[col].ne(cleaned), col].unique().tolist()
        if changes:
            normalizations[col] = {v: v.strip() for v in changes}
        frame[col] = cleaned
    for label, date, clock in [("start", "FECHAINICIO", "HORAINICIO"), ("end", "FECHAFIN", "HORAFIN")]:
        valid = frame[date].str.fullmatch(r"\d{8}") & frame[clock].str.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d")
        frame[label] = pd.to_datetime((frame[date] + " " + frame[clock]).where(valid),
                                      format="%Y%m%d %H:%M", errors="coerce").dt.tz_localize("America/Lima")
    frame["duration"] = (frame.end - frame.start).dt.total_seconds() / 3600
    # Freeze event identity before filtering/splitting. Conflicting labels, categories
    # or services quarantine the entire ID, never select a convenient first row.
    invariant = ["EPS", "TIPOINTERRUPCION", "TIPOSERVICIO", "FECHAINICIO", "HORAINICIO", "FECHAFIN", "HORAFIN"]
    variation = frame.groupby("IDINTERRUPCION")[invariant].nunique(dropna=False)
    conflicts = sorted(variation.index[variation.gt(1).any(axis=1)].tolist())
    multi_department = frame.groupby("IDINTERRUPCION").DEPARTAMENTO.nunique()
    # Multiple districts are one event. Department is selected lexically, not by
    # duration or future split; ambiguous multi-department events are audited.
    frame = frame.sort_values(["IDINTERRUPCION", "DEPARTAMENTO", "PROVINCIA", "DISTRITO"], kind="stable")
    frame = frame.drop_duplicates("IDINTERRUPCION").copy()
    excluded, excluded_ids = {}, {}

    def exclude(reason, mask):
        nonlocal frame
        excluded[reason] = int(mask.sum())
        excluded_ids[reason] = frame.loc[mask, "IDINTERRUPCION"].tolist()
        frame = frame.loc[~mask].copy()

    exclude("conflicting_event", frame.IDINTERRUPCION.isin(conflicts))
    exclude("missing_identity_or_category", frame[["IDINTERRUPCION", "EPS", "DEPARTAMENTO"]].eq("").any(axis=1))
    exclude("invalid_time", frame.start.isna() | frame.end.isna())
    now = pd.Timestamp.now(tz="America/Lima")
    exclude("future_time", (frame.start > now) | (frame.end > now))
    exclude("not_unplanned_drinking_water", ~frame.TIPOINTERRUPCION.eq("IMPREVISTA") | ~frame.TIPOSERVICIO.eq("AGUA POTABLE"))
    exclude("nonpositive_duration", frame.duration.le(0) | ~np.isfinite(frame.duration))
    frame = frame.sort_values(["start", "IDINTERRUPCION"], kind="stable").reset_index(drop=True)
    frame["month"] = frame.start.dt.month
    frame["weekday"] = frame.start.dt.dayofweek
    frame["hour"] = frame.start.dt.hour + frame.start.dt.minute / 60
    audit = {**SEMANTICS, "raw_rows": len(raw), "raw_columns": COLUMNS,
             "unique_event_ids": int(raw.IDINTERRUPCION.nunique()), "exact_duplicate_rows": exact_duplicates,
             "missing_counts": missing, "missing_fraction": {c: n / len(raw) for c, n in missing.items()},
             "normalization_map": normalizations, "normalization_version": 1,
             "conflicting_event_ids": conflicts, "multidepartment_event_ids": sorted(multi_department.index[multi_department.gt(1)].tolist()),
             "department_resolution": "lexically first department per frozen event; no outcome-dependent choice",
             "exclusions": excluded, "excluded_event_ids": excluded_ids, "eligible_events": len(frame),
             "raw_start_bounds": [str(pd.to_datetime(raw.FECHAINICIO, format="%Y%m%d", errors="coerce").min()),
                                  str(pd.to_datetime(raw.FECHAINICIO, format="%Y%m%d", errors="coerce").max())],
             "duration_quantiles_hours": {str(q): float(frame.duration.quantile(q)) for q in [0, .1, .5, .9, .95, .99, 1]},
             "positive_tail_over_168h_retained": int(frame.duration.gt(168).sum()),
             "tail_policy": "All valid positive reported durations retained; extremes are questionable reported labels, not verified true durations",
             "label_audit": {"verified_actual_restoration_events": 0, "dictionary_mapping_verified": False},
             "raw_service_counts": raw.TIPOSERVICIO.str.strip().value_counts().to_dict(),
             "raw_interruption_type_counts": raw.TIPOINTERRUPCION.str.strip().value_counts().to_dict()}
    return frame, audit


def chronological_splits(frame):
    if not frame.IDINTERRUPCION.is_unique:
        raise ValueError("Freeze unique event groups before temporal splitting")
    boundaries = [("train", "2019-01-01", "2022-01-01"), ("validation", "2022-01-01", "2023-01-01"),
                  ("calibration", "2023-01-01", "2024-01-01"), ("test", "2024-01-01", "2025-01-01")]
    parts, descriptions, purged = {}, {}, []
    for name, lower, upper in boundaries:
        lo, hi = pd.Timestamp(lower, tz="America/Lima"), pd.Timestamp(upper, tz="America/Lima")
        starts = frame.start.ge(lo) & frame.start.lt(hi)
        crossing = starts & frame.end.ge(hi)
        purged.extend(frame.loc[crossing, "IDINTERRUPCION"].tolist())
        parts[name] = frame.loc[starts & ~crossing].copy()
        part = parts[name]
        descriptions[name] = {"count": len(part), "start_inclusive": lower, "start_exclusive": upper,
                              "observed_start_min": str(part.start.min()), "observed_start_max": str(part.start.max()),
                              "label_end_max": str(part.end.max()), "event_ids": part.IDINTERRUPCION.tolist()}
    return parts, {"partitions": descriptions, "group_isolation_verified": True,
                   "purged_cross_boundary_ids": sorted(purged), "purged_count": len(purged),
                   "unassigned_event_ids": frame.loc[~frame.IDINTERRUPCION.isin(
                       [v for p in parts.values() for v in p.IDINTERRUPCION] + purged), "IDINTERRUPCION"].tolist(),
                   "test_role": "historical_exploratory_reuse_not_independent_acceptance",
                   "final_fit": "train + validation only; calibration and test never refit"}
