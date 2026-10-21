"""Evidence figures from actual inputs and measured predictions only."""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
import pandas as pd


def create_figures(output, raw, events, quality, splits, experiments, holdout, metrics, font_dir=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if font_dir and Path(font_dir).is_dir():
        for path in sorted(Path(font_dir).glob("*Montserrat*.*tf")):
            font_manager.fontManager.addfont(str(path))
        if any("Montserrat" in f.name for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = "Montserrat"
    plt.rcParams.update({"pdf.fonttype": 3, "font.size": 10, "axes.spines.top": False,
                         "axes.spines.right": False, "axes.titleweight": "semibold",
                         "axes.prop_cycle": plt.cycler(color=["#007D77", "#D18126", "#446A9B", "#B3545B"])})
    source = f"Fuente: SUNASS · inicio hasta {events.start.max().date()} · eventos, no hogares · experimental"

    def save(name, fig):
        fig.text(.01, .01, source, fontsize=7, color="#444444")
        fig.tight_layout(rect=(0, .04, 1, 1))
        fig.savefig(output / f"{name}.png", dpi=160)
        fig.savefig(output / f"{name}.pdf")
        plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].hist(events.duration, bins=70)
    axes[0].set(xlabel="Duración reportada (h), cola completa", ylabel="Eventos", title="Distribución lineal")
    axes[1].hist(events.duration, bins=np.geomspace(events.duration.min(), events.duration.max(), 65))
    axes[1].set(xscale="log", yscale="log", xlabel="Duración reportada (h)", ylabel="Eventos (log)", title="Cola positiva retenida")
    save("duration_hist_log", fig)

    fig, ax = plt.subplots(figsize=(9, 5))
    missing = pd.Series(quality["missing_fraction"]).sort_values()
    ax.barh(missing.index, missing * 100)
    ax.set(xlabel="Filas con valor ausente (%)", title=f"Faltantes en las {len(raw):,} filas originales")
    save("missingness", fig)

    fig, ax = plt.subplots(figsize=(10, 4))
    events.groupby(events.start.dt.strftime("%Y-%m")).size().plot(ax=ax)
    ax.set(xlabel="Mes de inicio (America/Lima)", ylabel="Eventos elegibles", title="Cobertura temporal, sin recortar duraciones largas")
    ax.tick_params(axis="x", rotation=45)
    save("samples_over_time", fig)

    fig, ax = plt.subplots(figsize=(8, 4))
    ax.bar(list(splits), [len(v) for v in splits.values()])
    ax.set(ylabel="Eventos después de purgar etiquetas", title="2019–2021 / 2022 / 2023 / 2024 reutilizado")
    save("split_counts", fig)

    fig, ax = plt.subplots(figsize=(10, 5))
    rows = [r for r in experiments if r["phase"] == "historical_test"]
    rows = sorted(rows, key=lambda r: r["mae"])
    ax.barh([r["algorithm"] for r in rows], [r["mae"] for r in rows])
    ax.set(xlabel="MAE (h)", title="Comparación histórica exploratoria de 2024; no selección")
    save("comparison_mae", fig)

    fig, ax = plt.subplots(figsize=(6, 5))
    ax.scatter(holdout.actual, holdout.p50, alpha=.3, s=9)
    upper = max(holdout.actual.max(), holdout.p50.max())
    ax.plot([0, upper], [0, upper], linestyle="--", color="#D18126")
    ax.set(xlabel="Duración reportada (h)", ylabel="Mediana estimada (h)", title="Predicción frente a etiqueta reportada · 2024")
    save("predicted_vs_reported", fig)

    fig, ax = plt.subplots(figsize=(10, 4))
    ax.scatter(pd.to_datetime(holdout.start), holdout.actual - holdout.p50, s=9, alpha=.4)
    ax.axhline(0, color="#D18126", linestyle="--")
    ax.set(xlabel="Inicio del evento", ylabel="Reportado − estimado (h)", title="Residuos cronológicos · 2024 reutilizado")
    save("residuals", fig)

    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    before, after = metrics["test"]["raw"], metrics["test"]["calibrated"]
    axes[0].bar(["Original", "CQR 2023"], [before["coverage"], after["coverage"]])
    axes[0].axhline(.8, color="#D18126", linestyle="--")
    axes[0].set(ylim=(0, 1), ylabel="Cobertura empírica", title="Sin garantía bajo deriva temporal")
    axes[1].bar(["Original", "CQR 2023"], [before["mean_width_hours"], after["mean_width_hours"]])
    axes[1].set(ylabel="Amplitud media (h)", title="Intervalo central nominal del 80 %")
    save("coverage_width", fig)

    fig, ax = plt.subplots(figsize=(10, 5))
    errors = holdout.assign(error=np.abs(holdout.actual - holdout.p50)).groupby("EPS").error.agg(["mean", "size"]).sort_values("size", ascending=False).head(15)
    ax.barh([f"{eps} (n={int(row['size'])})" for eps, row in errors.iterrows()], errors["mean"])
    ax.set(xlabel="MAE (h)", title="Errores por EPS · 15 grupos con mayor soporte en 2024")
    save("per_eps", fig)

    fig, ax = plt.subplots(figsize=(8, 4))
    values = np.sort(events.duration)
    ax.plot(values, np.arange(1, len(values) + 1) / len(values))
    ax.set(xscale="log", xlabel="Duración reportada (h)", ylabel="Proporción acumulada", title="ECDF de todos los eventos positivos elegibles")
    save("duration_ecdf", fig)

    fig, ax = plt.subplots(figsize=(9, 4))
    counts = {"Filas originales": len(raw), "IDs únicos": quality["unique_event_ids"], "Eventos elegibles": len(events),
              "Particiones purgadas": sum(len(p) for p in splits.values())}
    ax.barh(list(counts), list(counts.values()))
    ax.set(xlabel="Filas o eventos (unidad indicada)", title="Embudo de calidad y disponibilidad de etiquetas")
    save("quality_funnel", fig)
