"""Portable v1 trees; float32 comparisons and float64 accumulation."""

from datetime import date, datetime
import math
import re

import numpy as np
import pandas as pd

from .data import SEMANTICS

FEATURE_ORDER = ["month", "weekday", "hour", "eps", "department"]


class FeatureEncoder:
    """Vocabulary is fit only on the supplied training partition."""

    def fit(self, frame):
        self.categories = {key: sorted(frame[col].unique().tolist())
                           for key, col in [("eps", "EPS"), ("department", "DEPARTAMENTO")]}
        self.combinations = sorted(set(zip(frame.EPS, frame.DEPARTAMENTO)))
        return self

    def transform(self, frame):
        columns = [frame[c].to_numpy(dtype=float) for c in ["month", "weekday", "hour"]]
        for key, col in [("eps", "EPS"), ("department", "DEPARTAMENTO")]:
            codes = {v: i for i, v in enumerate(self.categories[key])}
            columns.append(frame[col].map(codes).fillna(-1).to_numpy(dtype=float))
        return np.column_stack(columns).astype(np.float32)

    def supported(self, frame):
        pairs = set(self.combinations)
        return np.array([(eps, dep) in pairs for eps, dep in zip(frame.EPS, frame.DEPARTAMENTO)])


def postprocess(raw, offset=0.):
    values = np.asarray(raw, dtype=float)
    if values.ndim != 2 or values.shape[1] != 3 or not np.isfinite(values).all():
        raise ValueError("Expected finite n-by-3 quantiles")
    if not math.isfinite(offset) or offset < 0:
        raise ValueError("CQR offset must be finite and nonnegative")
    output = np.sort(np.maximum(values, 0), axis=1)
    output[:, 0] = np.maximum(0, output[:, 0] - offset)
    output[:, 2] += offset
    return output


def calibrate(raw_calibration, y_calibration, nominal=.8):
    """Finite-sample nonnegative CQR, no interpolation or access to test labels."""
    quantiles = postprocess(raw_calibration)
    y = np.asarray(y_calibration, dtype=float)
    if y.shape != (len(quantiles),) or not np.isfinite(y).all() or not 0 < nominal < 1:
        raise ValueError("Invalid independent calibration data")
    rank = math.ceil((len(y) + 1) * nominal)
    if rank > len(y) or not len(y):
        raise ValueError("Insufficient calibration sample for finite CQR rank")
    scores = np.maximum(quantiles[:, 0] - y, y - quantiles[:, 2])
    return max(0., float(np.partition(scores, rank - 1)[rank - 1]))


def export_model(models, encoder, offset, source_sha, cutoff):
    exported = {}
    for name, model in zip(["p10", "p50", "p90"], models):
        if model.loss != "quantile" or not hasattr(model.init_, "constant_"):
            raise ValueError("Only constant-initialized quantile GBR export is supported")
        trees = []
        for estimator in model.estimators_.ravel():
            tree = estimator.tree_
            trees.append({"children_left": tree.children_left.tolist(), "children_right": tree.children_right.tolist(),
                          "feature": tree.feature.tolist(), "threshold": tree.threshold.tolist(),
                          "value": tree.value[:, 0, 0].tolist()})
        exported[name] = {"init": float(model.init_.constant_[0, 0]), "learning_rate": float(model.learning_rate), "trees": trees}
    artifact = {"schema_version": 1, "model_version": "asu-reported-v1", **SEMANTICS,
                "feature_order": FEATURE_ORDER, "preprocessing": {"categories": encoder.categories, "unknown_value": -1},
                "models": exported, "calibration": {"offset_hours": float(offset), "nominal_coverage": .8,
                "method": "nonnegative_CQR_finite_sample_order_statistic", "partition": "2023"},
                "support": {"eps_codes": encoder.categories["eps"], "departments": encoder.categories["department"],
                            "combinations": [{"eps": eps, "department": dep} for eps, dep in encoder.combinations]},
                "data_cutoff": cutoff, "source_sha256": source_sha}
    validate_artifact(artifact)
    return artifact


def validate_artifact(artifact):
    required = {"schema_version", "model_version", "status", "target_semantics", "label_semantics_approved",
                "feature_order", "preprocessing", "models", "calibration", "support", "data_cutoff", "source_sha256"}

    def require_fields(value, keys, label):
        if not isinstance(value, dict) or not set(keys).issubset(value):
            raise ValueError(f"Missing or invalid {label} fields")

    def finite_number(value):
        # JSON booleans are not numbers in the browser schema, even though bool
        # is a subclass of int in Python.
        if type(value) not in (int, float):
            return False
        try:
            return math.isfinite(value)
        except OverflowError:
            return False

    def vocabulary(value):
        return (isinstance(value, list) and bool(value)
                and all(isinstance(v, str) and bool(v.strip()) for v in value)
                and len(set(value)) == len(value))

    require_fields(artifact, required, "model schema")
    if type(artifact["schema_version"]) is not int or artifact["schema_version"] != 1:
        raise ValueError("Unsupported schema_version")
    if not isinstance(artifact["model_version"], str) or not artifact["model_version"].strip():
        raise ValueError("Invalid model_version")
    if not isinstance(artifact["source_sha256"], str) or re.fullmatch(r"[0-9a-fA-F]{64}", artifact["source_sha256"]) is None:
        raise ValueError("Invalid source_sha256: expected 64 hexadecimal characters")
    cutoff = artifact["data_cutoff"]
    if not isinstance(cutoff, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", cutoff) is None:
        raise ValueError("Invalid data_cutoff: expected an ISO calendar date")
    try:
        date.fromisoformat(cutoff)
    except ValueError as error:
        raise ValueError("Invalid data_cutoff: expected a real ISO calendar date") from error
    if artifact.get("feature_order") != FEATURE_ORDER:
        raise ValueError("Invalid feature_order")
    if artifact.get("target_semantics") != SEMANTICS["target_semantics"]:
        raise ValueError("Unsupported target_semantics")
    if artifact.get("status") != "experimental" or artifact.get("label_semantics_approved") is not False:
        raise ValueError("Reported-duration artifacts must remain experimental and unapproved")
    require_fields(artifact["preprocessing"], ["categories", "unknown_value"], "preprocessing")
    categories = artifact["preprocessing"]["categories"]
    require_fields(categories, ["eps", "department"], "category")
    for name in ["eps", "department"]:
        values = categories[name]
        if not vocabulary(values):
            raise ValueError("Invalid category vocabulary")
    if not finite_number(artifact["preprocessing"]["unknown_value"]) or artifact["preprocessing"]["unknown_value"] != -1:
        raise ValueError("Unsupported unknown_value")
    require_fields(artifact["calibration"], ["offset_hours", "nominal_coverage"], "calibration")
    offset = artifact["calibration"]["offset_hours"]
    nominal = artifact["calibration"]["nominal_coverage"]
    if not finite_number(offset) or offset < 0 or not finite_number(nominal) or nominal != .8:
        raise ValueError("Invalid calibration")
    for name in ["method", "partition"]:
        if name in artifact["calibration"] and not isinstance(artifact["calibration"][name], str):
            raise ValueError("Invalid calibration metadata")
    require_fields(artifact["models"], ["p10", "p50", "p90"], "ensemble")
    for name in ["p10", "p50", "p90"]:
        model = artifact["models"][name]
        require_fields(model, ["init", "learning_rate", "trees"], "quantile model")
        if not finite_number(model["init"]) or not finite_number(model["learning_rate"]) or model["learning_rate"] <= 0:
            raise ValueError("Invalid scalar model initialization or rate")
        if not isinstance(model["trees"], list) or not 1 <= len(model["trees"]) <= 1000:
            raise ValueError("Empty tree ensemble")
        for tree in model["trees"]:
            tree_keys = ["children_left", "children_right", "feature", "threshold", "value"]
            require_fields(tree, tree_keys, "tree")
            if set(tree) != set(tree_keys):
                raise ValueError("Invalid tree fields")
            arrays = [tree[k] for k in tree_keys]
            if any(not isinstance(a, list) for a in arrays):
                raise ValueError("Invalid parallel tree arrays")
            n = len(arrays[0])
            if (not 1 <= n <= 8191 or any(len(a) != n for a in arrays)
                    or any(type(v) is not int for a in arrays[:3] for v in a)
                    or any(not finite_number(v) for a in arrays[3:] for v in a)):
                raise ValueError("Invalid parallel tree arrays")
            visited, stack = set(), [(0, 0)]
            while stack:
                i, depth = stack.pop()
                if i < 0 or i >= n or i in visited or depth > 64:
                    raise ValueError("Invalid or cyclic tree children")
                visited.add(i)
                left, right = tree["children_left"][i], tree["children_right"][i]
                if left == right == -1:
                    continue
                feature = tree["feature"][i]
                if not isinstance(feature, int) or not 0 <= feature < 5:
                    raise ValueError("Invalid tree feature")
                stack.extend([(left, depth + 1), (right, depth + 1)])
            if len(visited) != n:
                raise ValueError("Unreachable tree nodes")
    support = artifact["support"]
    require_fields(support, ["eps_codes", "departments", "combinations"], "support")
    if not vocabulary(support["eps_codes"]) or not vocabulary(support["departments"]):
        raise ValueError("Invalid support vocabulary")
    if support["eps_codes"] != categories["eps"] or support["departments"] != categories["department"]:
        raise ValueError("Support vocabulary mismatch")
    if not isinstance(support["combinations"], list) or not 1 <= len(support["combinations"]) <= 10000:
        raise ValueError("Explicit supported EPS/department combinations required")
    seen = set()
    for pair in support["combinations"]:
        require_fields(pair, ["eps", "department"], "supported combination")
        if (not isinstance(pair["eps"], str) or not isinstance(pair["department"], str)
                or pair["eps"] not in categories["eps"] or pair["department"] not in categories["department"]
                or (pair["eps"], pair["department"]) in seen):
            raise ValueError("Unsupported combination in artifact")
        seen.add((pair["eps"], pair["department"]))
    return True


def validate_inputs(artifact, inputs):
    x = np.asarray(inputs, dtype=np.float32)
    if x.ndim != 2 or x.shape[1] != 5 or not np.isfinite(x).all():
        raise ValueError("Expected finite n-by-5 input vectors")
    if np.any((x[:, 0] < 1) | (x[:, 0] > 12) | (x[:, 0] % 1 != 0)):
        raise ValueError("Invalid month")
    if np.any((x[:, 1] < 0) | (x[:, 1] > 6) | (x[:, 1] % 1 != 0) | (x[:, 2] < 0) | (x[:, 2] >= 24)):
        raise ValueError("Invalid weekday/hour")
    cats = artifact["preprocessing"]["categories"]
    for i, key in [(3, "eps"), (4, "department")]:
        if np.any((x[:, i] < 0) | (x[:, i] >= len(cats[key])) | (x[:, i] % 1 != 0)):
            raise ValueError("Unsupported category")
    pairs = {(p["eps"], p["department"]) for p in artifact["support"].get("combinations", [])}
    if pairs and any((cats["eps"][int(row[3])], cats["department"][int(row[4])]) not in pairs for row in x):
        raise ValueError("Unsupported EPS/department combination")
    return x


def predict_artifact(artifact, inputs, validate=True):
    if validate:
        validate_artifact(artifact)
    x = validate_inputs(artifact, inputs)
    outputs = []
    for name in ["p10", "p50", "p90"]:
        model = artifact["models"][name]
        prediction = np.full(len(x), model["init"], dtype=np.float64)
        for tree in model["trees"]:
            left, right = np.asarray(tree["children_left"]), np.asarray(tree["children_right"])
            features, thresholds = np.asarray(tree["feature"]), np.asarray(tree["threshold"])
            nodes = np.zeros(len(x), dtype=int)
            for _ in range(len(left)):
                active = left[nodes] != -1
                if not active.any():
                    break
                idx = np.flatnonzero(active)
                current = nodes[idx]
                # Convert selected float32 values to float64 to avoid NumPy
                # coercing thresholds to float32 in a scalar comparison.
                go_left = x[idx, features[current]].astype(np.float64) <= thresholds[current]
                nodes[idx] = np.where(go_left, left[current], right[current])
            prediction += model["learning_rate"] * np.asarray(tree["value"])[nodes]
        outputs.append(prediction)
    return postprocess(np.column_stack(outputs), artifact["calibration"]["offset_hours"])


def encode_request(artifact, started_at, eps, department):
    try:
        # Date-only strings do not contain the required event clock.
        if not isinstance(started_at, str) or "T" not in started_at:
            raise ValueError("Missing start time")
        stamp = pd.Timestamp(datetime.fromisoformat(started_at.replace("Z", "+00:00")))
        stamp = stamp.tz_localize("America/Lima") if stamp.tzinfo is None else stamp.tz_convert("America/Lima")
        cats = artifact["preprocessing"]["categories"]
        vector = [stamp.month, stamp.dayofweek, stamp.hour + stamp.minute / 60 + stamp.second / 3600,
                  cats["eps"].index(eps), cats["department"].index(department)]
        validate_inputs(artifact, [vector])
        return vector
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise ValueError("Invalid start time or unsupported EPS/department combination") from error
