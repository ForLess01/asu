"""Bounded family comparison and validation-only quantile GBR selection."""

import time

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import (mean_absolute_error, mean_pinball_loss, mean_squared_error,
                             median_absolute_error, r2_score)
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVR
from sklearn.tree import DecisionTreeRegressor

from .portable import FeatureEncoder, postprocess

SEED = 42
GBR_SEARCH = [
    {"n_estimators": 60, "max_depth": 2, "learning_rate": .06, "min_samples_leaf": 30},
    {"n_estimators": 100, "max_depth": 2, "learning_rate": .06, "min_samples_leaf": 30},
    {"n_estimators": 60, "max_depth": 3, "learning_rate": .06, "min_samples_leaf": 30},
    {"n_estimators": 100, "max_depth": 3, "learning_rate": .06, "min_samples_leaf": 30},
]


def point_metrics(y, prediction):
    y, prediction = np.asarray(y), np.maximum(0, prediction)
    return {"n": len(y), "mae": float(mean_absolute_error(y, prediction)),
            "medae": float(median_absolute_error(y, prediction)),
            "rmse": float(np.sqrt(mean_squared_error(y, prediction))),
            "r2": float(r2_score(y, prediction)) if len(y) > 1 else None}


def quantile_metrics(y, predictions):
    y = np.asarray(y)
    lower, median, upper = predictions.T
    width = upper - lower
    score = width + 10 * np.maximum(lower - y, 0) + 10 * np.maximum(y - upper, 0)
    return {**point_metrics(y, median), "coverage": float(np.mean((lower <= y) & (y <= upper))),
            "mean_width_hours": float(np.mean(width)), "median_width_hours": float(np.median(width)),
            "interval_score_80": float(np.mean(score)),
            "pinball": {name: float(mean_pinball_loss(y, predictions[:, i], alpha=q))
                        for i, (name, q) in enumerate([("p10", .1), ("p50", .5), ("p90", .9)])}}


def make_gbr(params, quantile=.5):
    return GradientBoostingRegressor(loss="quantile", alpha=quantile, random_state=SEED, **params)


def family_estimators():
    def scaled(estimator):
        return make_pipeline(ColumnTransformer([
            ("numeric", StandardScaler(), [0, 1, 2]),
            ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), [3, 4])]), estimator)
    return {
        "OLS": scaled(LinearRegression()),
        "Ridge": scaled(Ridge(alpha=10.)),
        "KNN": scaled(KNeighborsRegressor(n_neighbors=35, weights="distance", n_jobs=1)),
        "SVR": scaled(SVR(C=10., epsilon=.2)),
        "DecisionTree": DecisionTreeRegressor(max_depth=5, min_samples_leaf=30, random_state=SEED),
        "ExtraTrees": ExtraTreesRegressor(n_estimators=60, max_depth=10, min_samples_leaf=20,
                                           random_state=SEED, n_jobs=1),
        "HGB_median": HistGradientBoostingRegressor(loss="quantile", quantile=.5, max_iter=100,
                                                    max_leaf_nodes=15, min_samples_leaf=30,
                                                    learning_rate=.06, l2_regularization=2.,
                                                    categorical_features=[False, False, False, True, True],
                                                    early_stopping=False, random_state=SEED),
    }


def baseline_predictions(fit, evaluation):
    y = fit.duration
    quantiles = y.quantile([.1, .5, .9]).to_numpy()
    global_q = np.tile(quantiles, (len(evaluation), 1))
    eps_q = fit.groupby("EPS").duration.quantile([.1, .5, .9]).unstack()
    counts = fit.groupby("EPS").size()
    eps_q = eps_q.loc[counts.ge(20)]
    result = eps_q.reindex(evaluation.EPS).to_numpy()
    result = np.where(np.isfinite(result), result, global_q)
    return {"GlobalMedian": global_q, "EPSMedian": postprocess(result)}


def compare_and_select(parts, svr_cap=4000):
    train, validation = parts["train"], parts["validation"]
    encoder = FeatureEncoder().fit(train)
    x, xv = encoder.transform(train), encoder.transform(validation)
    y, yv = train.duration.to_numpy(), validation.duration.to_numpy()
    experiments, models = [], {}
    for name, quantiles in baseline_predictions(train, validation).items():
        experiments.append({"algorithm": name, "phase": "validation", "fit_count": len(train),
                            "evaluation_count": len(validation), "fit_seconds": 0., "predict_seconds": 0.,
                            "params": {"eps_min_support": 20} if name == "EPSMedian" else {},
                            **quantile_metrics(yv, quantiles)})
    for name, estimator in family_estimators().items():
        idx = np.arange(len(train))
        if name == "SVR" and len(idx) > svr_cap:
            idx = np.sort(np.random.default_rng(SEED).choice(idx, svr_cap, replace=False))
        start = time.perf_counter()
        estimator.fit(x[idx], y[idx])
        fit_seconds = time.perf_counter() - start
        start = time.perf_counter()
        prediction = estimator.predict(xv)
        predict_seconds = time.perf_counter() - start
        params = estimator.get_params(deep=True)
        params = {k: v for k, v in params.items() if isinstance(v, (int, float, str, bool)) or v is None}
        experiments.append({"algorithm": name, "phase": "validation", "fit_count": len(idx),
                            "evaluation_count": len(validation), "fit_seconds": fit_seconds,
                            "predict_seconds": predict_seconds, "params": params,
                            "subsample_policy": "seed42 training-only uniform without replacement" if name == "SVR" else "none",
                            **point_metrics(yv, prediction)})
        models[name] = estimator
    trials = []
    for trial, params in enumerate(GBR_SEARCH):
        start = time.perf_counter()
        model = make_gbr(params).fit(x, y)
        fit_seconds = time.perf_counter() - start
        start = time.perf_counter()
        prediction = model.predict(xv)
        row = {"algorithm": "QuantileGBR", "phase": "validation", "trial": trial,
               "fit_count": len(train), "evaluation_count": len(validation), "params": params,
               "fit_seconds": fit_seconds, "predict_seconds": time.perf_counter() - start,
               **point_metrics(yv, prediction)}
        experiments.append(row)
        trials.append(row)
    chosen = min(trials, key=lambda row: (row["mae"], row["trial"]))
    return chosen["params"], experiments, {"selection_metric": "validation MAE of nonnegative median",
                                             "selection_partition": "2022", "seed": SEED,
                                             "svr_training_cap": svr_cap, "trials": trials,
                                             "selected_params": chosen["params"],
                                             "training_categories": encoder.categories,
                                             "validation_unsupported_count": int((~encoder.supported(validation)).sum()),
                                             "offline_comparison_policy": "unknown validation codes -1; deployment abstains"}


def fit_final(parts, params, svr_cap=4000):
    import pandas as pd
    fit = pd.concat([parts["train"], parts["validation"]], ignore_index=True)
    encoder = FeatureEncoder().fit(fit)
    x = encoder.transform(fit)
    y = fit.duration.to_numpy()
    start = time.perf_counter()
    models = [make_gbr(params, q).fit(x, y) for q in [.1, .5, .9]]
    duration = time.perf_counter() - start
    test_mask = encoder.supported(parts["test"])
    test = parts["test"].loc[test_mask].copy()
    xt, yt = encoder.transform(test), test.duration.to_numpy()
    baselines = baseline_predictions(fit, test)
    rows = [{"algorithm": name, "phase": "historical_test", "fit_count": len(fit),
             "evaluation_count": len(test), "fit_seconds": 0., "predict_seconds": 0., "params": {},
             **quantile_metrics(yt, values)} for name, values in baselines.items()]
    for name, estimator in family_estimators().items():
        idx = np.arange(len(fit))
        if name == "SVR" and len(idx) > svr_cap:
            idx = np.sort(np.random.default_rng(SEED).choice(idx, svr_cap, replace=False))
        start = time.perf_counter()
        estimator.fit(x[idx], y[idx])
        fit_seconds = time.perf_counter() - start
        start = time.perf_counter()
        predictions = estimator.predict(xt)
        rows.append({"algorithm": name, "phase": "historical_test", "fit_count": len(idx),
                     "evaluation_count": len(test), "params": "same fixed family parameters as validation",
                     "fit_seconds": fit_seconds, "predict_seconds": time.perf_counter() - start,
                     **point_metrics(yt, predictions)})
    return fit, encoder, models, test, baselines, rows, duration


def expanding_diagnostics(train, params):
    """Three train-only expanding windows, strictly purged label availability."""
    import pandas as pd
    windows = [("2020-01-01", "2020-07-01"), ("2020-07-01", "2021-01-01"), ("2021-01-01", "2022-01-01")]
    rows = []
    for lower, upper in windows:
        lo, hi = pd.Timestamp(lower, tz="America/Lima"), pd.Timestamp(upper, tz="America/Lima")
        fit = train.loc[train.start.lt(lo) & train.end.lt(lo)]
        check = train.loc[train.start.ge(lo) & train.start.lt(hi) & train.end.lt(hi)]
        if len(fit) < 100 or len(check) < 2:
            rows.append({"validation_start": lower, "status": "insufficient_train_window_support"})
            continue
        encoder = FeatureEncoder().fit(fit)
        model = make_gbr(params).fit(encoder.transform(fit), fit.duration)
        rows.append({"validation_start": lower, "validation_end": upper, "fit_count": len(fit),
                     "status": "diagnostic_not_additional_selection", **point_metrics(check.duration, model.predict(encoder.transform(check)))})
    return rows
