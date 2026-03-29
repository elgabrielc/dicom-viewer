#!/usr/bin/env python3
"""Render a self-contained HTML dashboard for a memory-capture session."""

from __future__ import annotations

import argparse
import html
import json
import math
import pathlib
import statistics
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build an HTML dashboard from a desktop-memory session JSON file.")
    parser.add_argument("session", help="Path to the session JSON file produced by desktop-memory-capture.py")
    parser.add_argument(
        "--output",
        required=True,
        help="Path to the output HTML dashboard",
    )
    parser.add_argument(
        "--target-plateau-mb",
        type=float,
        default=None,
        help="Optional settled RSS target shown in the dashboard. Defaults to the value stored in the session file.",
    )
    parser.add_argument(
        "--baseline-window-seconds",
        type=float,
        default=15.0,
        help="Window used to estimate baseline RSS. Default: 15s",
    )
    parser.add_argument(
        "--settled-window-seconds",
        type=float,
        default=15.0,
        help="Window used to estimate settled RSS. Default: 15s",
    )
    parser.add_argument(
        "--tail-window-seconds",
        type=float,
        default=30.0,
        help="Window used to estimate the end-of-run slope. Default: 30s",
    )
    return parser.parse_args()


def read_session(path: pathlib.Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_output(path: pathlib.Path) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def rss_mb(sample: dict[str, Any]) -> float:
    return float(sample["rss_kb"]) / 1024.0


def fmt_mb(value: float) -> str:
    return f"{value:.1f} MB"


def fmt_delta_mb(value: float) -> str:
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.1f} MB"


def fmt_seconds(value: float) -> str:
    total_seconds = int(round(value))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}h {minutes:02d}m {seconds:02d}s"
    if minutes:
        return f"{minutes:d}m {seconds:02d}s"
    return f"{seconds:d}s"


def fmt_timecode(value: float) -> str:
    total_seconds = int(round(value))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:d}:{seconds:02d}"


def median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def subset_by_time(samples: list[dict[str, Any]], start: float, end: float) -> list[dict[str, Any]]:
    return [sample for sample in samples if start <= float(sample["time_seconds"]) <= end]


def first_window(samples: list[dict[str, Any]], seconds: float) -> list[dict[str, Any]]:
    if not samples:
        return []
    end = min(float(samples[-1]["time_seconds"]), seconds)
    return subset_by_time(samples, 0.0, end)


def last_window(samples: list[dict[str, Any]], seconds: float) -> list[dict[str, Any]]:
    if not samples:
        return []
    start = max(0.0, float(samples[-1]["time_seconds"]) - seconds)
    return subset_by_time(samples, start, float(samples[-1]["time_seconds"]))


def slope_mb_per_minute(samples: list[dict[str, Any]]) -> float:
    if len(samples) < 2:
        return 0.0

    xs = [float(sample["time_seconds"]) for sample in samples]
    ys = [rss_mb(sample) for sample in samples]
    x_mean = statistics.fmean(xs)
    y_mean = statistics.fmean(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    return (numerator / denominator) * 60.0


def classify_session(
    baseline_mb: float,
    settled_mb: float,
    tail_slope_mb_per_minute_value: float,
    target_plateau_mb: float | None,
) -> tuple[str, str]:
    settled_delta = settled_mb - baseline_mb
    over_target = target_plateau_mb is not None and settled_mb > target_plateau_mb

    if settled_delta <= 25 and tail_slope_mb_per_minute_value <= 5 and not over_target:
        return "Looks stable", "good"
    if settled_delta <= 75 and tail_slope_mb_per_minute_value <= 10:
        return "Borderline", "warning"
    return "Growth risk", "danger"


def build_phase_rows(samples: list[dict[str, Any]], markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not samples:
        return []

    duration = float(samples[-1]["time_seconds"])
    ordered_markers = sorted(markers, key=lambda marker: float(marker["time_seconds"]))
    if not ordered_markers or float(ordered_markers[0]["time_seconds"]) > 0:
        ordered_markers.insert(
            0,
            {
                "time_seconds": 0.0,
                "label": "Capture start",
                "source": "synthetic",
            },
        )

    phases: list[dict[str, Any]] = []
    for index, marker in enumerate(ordered_markers):
        start = float(marker["time_seconds"])
        end = float(ordered_markers[index + 1]["time_seconds"]) if index + 1 < len(ordered_markers) else duration
        if index + 1 == len(ordered_markers):
            phase_samples = subset_by_time(samples, start, duration)
            next_label = "Session end"
        else:
            phase_samples = [sample for sample in samples if start <= float(sample["time_seconds"]) < end]
            next_label = ordered_markers[index + 1]["label"]

        if not phase_samples:
            continue

        start_samples = phase_samples[: min(5, len(phase_samples))]
        end_samples = phase_samples[-min(5, len(phase_samples)) :]
        start_mb = median([rss_mb(sample) for sample in start_samples])
        end_mb = median([rss_mb(sample) for sample in end_samples])
        peak_sample = max(phase_samples, key=rss_mb)
        phases.append(
            {
                "name": marker["label"],
                "until": next_label,
                "duration_seconds": max(0.0, end - start),
                "start_mb": start_mb,
                "peak_mb": rss_mb(peak_sample),
                "peak_time_seconds": float(peak_sample["time_seconds"]),
                "end_mb": end_mb,
                "delta_mb": end_mb - start_mb,
            }
        )

    return phases


def marker_rows(samples: list[dict[str, Any]], markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not samples:
        return rows

    for index, marker in enumerate(sorted(markers, key=lambda item: float(item["time_seconds"])), start=1):
        time_seconds = float(marker["time_seconds"])
        nearest = min(samples, key=lambda sample: abs(float(sample["time_seconds"]) - time_seconds))
        rows.append(
            {
                "index": index,
                "time_seconds": time_seconds,
                "label": marker["label"],
                "source": marker.get("source", ""),
                "rss_mb": rss_mb(nearest),
            }
        )
    return rows


def svg_chart(
    samples: list[dict[str, Any]],
    markers: list[dict[str, Any]],
    baseline_mb: float,
    settled_mb: float,
    target_plateau_mb: float | None,
) -> str:
    width = 1180
    height = 420
    left = 80
    right = 24
    top = 24
    bottom = 56
    chart_width = width - left - right
    chart_height = height - top - bottom

    xs = [float(sample["time_seconds"]) for sample in samples]
    ys = [rss_mb(sample) for sample in samples]
    max_time = max(xs[-1], 1.0)
    min_y = min(ys + [baseline_mb, settled_mb] + ([target_plateau_mb] if target_plateau_mb is not None else []))
    max_y = max(ys + [baseline_mb, settled_mb] + ([target_plateau_mb] if target_plateau_mb is not None else []))
    min_y = max(0.0, math.floor(max(min_y - 10.0, 0.0) / 10.0) * 10.0)
    max_y = math.ceil((max_y + 10.0) / 10.0) * 10.0
    if math.isclose(max_y, min_y):
        max_y += 10.0

    def x_pos(time_seconds: float) -> float:
        return left + (time_seconds / max_time) * chart_width

    def y_pos(value_mb: float) -> float:
        ratio = (value_mb - min_y) / (max_y - min_y)
        return top + chart_height - (ratio * chart_height)

    points = " ".join(f"{x_pos(x):.2f},{y_pos(y):.2f}" for x, y in zip(xs, ys))

    horizontal_lines = []
    for index in range(6):
        y_value = min_y + ((max_y - min_y) * index / 5.0)
        y = y_pos(y_value)
        horizontal_lines.append(
            f'<line x1="{left}" y1="{y:.2f}" x2="{width - right}" y2="{y:.2f}" class="grid" />'
            f'<text x="{left - 12}" y="{y + 4:.2f}" class="axis-label axis-label-left">{fmt_mb(y_value)}</text>'
        )

    vertical_lines = []
    for index in range(6):
        x_value = (max_time * index) / 5.0
        x = x_pos(x_value)
        vertical_lines.append(
            f'<line x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{height - bottom}" class="grid grid-vertical" />'
            f'<text x="{x:.2f}" y="{height - bottom + 24}" class="axis-label axis-label-bottom">{fmt_timecode(x_value)}</text>'
        )

    marker_lines = []
    for index, marker in enumerate(sorted(markers, key=lambda item: float(item["time_seconds"])), start=1):
        x = x_pos(float(marker["time_seconds"]))
        marker_lines.append(
            f'<line x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{height - bottom}" class="marker-line" />'
            f'<circle cx="{x:.2f}" cy="{top + 8:.2f}" r="10" class="marker-dot" />'
            f'<text x="{x:.2f}" y="{top + 12:.2f}" class="marker-text">{index}</text>'
        )

    target_line = ""
    if target_plateau_mb is not None:
        y = y_pos(target_plateau_mb)
        target_line = (
            f'<line x1="{left}" y1="{y:.2f}" x2="{width - right}" y2="{y:.2f}" class="target-line" />'
            f'<text x="{width - right}" y="{y - 8:.2f}" class="target-label">Target plateau {fmt_mb(target_plateau_mb)}</text>'
        )

    baseline_y = y_pos(baseline_mb)
    settled_y = y_pos(settled_mb)
    return f"""
<svg viewBox="0 0 {width} {height}" class="chart-svg" role="img" aria-label="RSS over time">
  <rect x="0" y="0" width="{width}" height="{height}" rx="24" class="chart-bg" />
  {''.join(horizontal_lines)}
  {''.join(vertical_lines)}
  {target_line}
  <line x1="{left}" y1="{baseline_y:.2f}" x2="{width - right}" y2="{baseline_y:.2f}" class="baseline-line" />
  <line x1="{left}" y1="{settled_y:.2f}" x2="{width - right}" y2="{settled_y:.2f}" class="settled-line" />
  <polyline points="{points}" class="rss-line" />
  {''.join(marker_lines)}
</svg>
"""


def dashboard_html(
    session: dict[str, Any],
    target_plateau_mb: float | None,
    baseline_window_seconds: float,
    settled_window_seconds: float,
    tail_window_seconds: float,
) -> str:
    samples = session.get("samples", [])
    markers = session.get("markers", [])
    if not samples:
        raise SystemExit("The session file has no samples.")

    duration_seconds = float(samples[-1]["time_seconds"])
    baseline_samples = first_window(samples, baseline_window_seconds)
    settled_samples = last_window(samples, settled_window_seconds)
    tail_samples = last_window(samples, tail_window_seconds)

    baseline_mb = median([rss_mb(sample) for sample in baseline_samples])
    settled_mb = median([rss_mb(sample) for sample in settled_samples])
    final_mb = rss_mb(samples[-1])
    peak_sample = max(samples, key=rss_mb)
    peak_mb = rss_mb(peak_sample)
    peak_time_seconds = float(peak_sample["time_seconds"])
    tail_slope = slope_mb_per_minute(tail_samples)
    verdict_text, verdict_tone = classify_session(baseline_mb, settled_mb, tail_slope, target_plateau_mb)
    phases = build_phase_rows(samples, markers)
    marker_table = marker_rows(samples, markers)

    chart = svg_chart(samples, markers, baseline_mb, settled_mb, target_plateau_mb)
    baseline_delta = settled_mb - baseline_mb
    peak_delta = peak_mb - baseline_mb
    final_delta = final_mb - baseline_mb
    plateau_text = fmt_mb(target_plateau_mb) if target_plateau_mb is not None else "None"

    phase_rows_html = "".join(
        """
        <tr>
          <td>{name}</td>
          <td>{until}</td>
          <td>{duration}</td>
          <td>{start_mb}</td>
          <td>{peak_mb}</td>
          <td>{end_mb}</td>
          <td>{delta_mb}</td>
        </tr>
        """.format(
            name=html.escape(phase["name"]),
            until=html.escape(phase["until"]),
            duration=fmt_seconds(phase["duration_seconds"]),
            start_mb=fmt_mb(phase["start_mb"]),
            peak_mb=f"{fmt_mb(phase['peak_mb'])} @ {fmt_timecode(phase['peak_time_seconds'])}",
            end_mb=fmt_mb(phase["end_mb"]),
            delta_mb=fmt_delta_mb(phase["delta_mb"]),
        )
        for phase in phases
    )

    marker_rows_html = "".join(
        """
        <tr>
          <td>{index}</td>
          <td>{label}</td>
          <td>{timecode}</td>
          <td>{source}</td>
          <td>{rss_mb}</td>
        </tr>
        """.format(
            index=row["index"],
            label=html.escape(row["label"]),
            timecode=fmt_timecode(row["time_seconds"]),
            source=html.escape(row["source"]),
            rss_mb=fmt_mb(row["rss_mb"]),
        )
        for row in marker_table
    )

    notes_html = ""
    if session.get("notes"):
        notes_html = f"""
        <section class="panel">
          <h2>Notes</h2>
          <p>{html.escape(session["notes"])}</p>
        </section>
        """

    title = "Desktop Memory Validation"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      --bg: #f3efe3;
      --panel: rgba(255, 252, 244, 0.84);
      --panel-strong: rgba(255, 255, 255, 0.96);
      --ink: #1a2820;
      --muted: #5d6e64;
      --line: rgba(38, 61, 49, 0.12);
      --good: #1d6b4f;
      --warning: #ab6b11;
      --danger: #a33d34;
      --accent: #0f766e;
      --accent-soft: rgba(15, 118, 110, 0.12);
      --shadow: 0 24px 80px rgba(21, 34, 28, 0.12);
    }}

    * {{
      box-sizing: border-box;
    }}

    body {{
      margin: 0;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.14), transparent 32%),
        radial-gradient(circle at top right, rgba(29, 107, 79, 0.14), transparent 30%),
        linear-gradient(180deg, #f6f2e8, var(--bg));
    }}

    .shell {{
      width: min(1180px, calc(100vw - 32px));
      margin: 32px auto 48px;
      display: grid;
      gap: 18px;
    }}

    .hero {{
      display: grid;
      gap: 12px;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(244, 250, 247, 0.86));
      box-shadow: var(--shadow);
    }}

    .eyebrow {{
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
    }}

    h1, h2 {{
      margin: 0;
      font-weight: 700;
    }}

    h1 {{
      font-size: clamp(32px, 5vw, 52px);
      line-height: 1.02;
    }}

    h2 {{
      font-size: 20px;
    }}

    p {{
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }}

    .hero-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }}

    .chip {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.84);
      font-size: 14px;
      color: var(--ink);
    }}

    .chip-good {{
      color: var(--good);
      background: rgba(29, 107, 79, 0.08);
      border-color: rgba(29, 107, 79, 0.2);
    }}

    .chip-warning {{
      color: var(--warning);
      background: rgba(171, 107, 17, 0.08);
      border-color: rgba(171, 107, 17, 0.2);
    }}

    .chip-danger {{
      color: var(--danger);
      background: rgba(163, 61, 52, 0.08);
      border-color: rgba(163, 61, 52, 0.2);
    }}

    .card-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 14px;
    }}

    .metric-card, .panel {{
      padding: 20px;
      border-radius: 24px;
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }}

    .metric-label {{
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 10px;
    }}

    .metric-value {{
      font-size: 30px;
      font-weight: 700;
      line-height: 1.1;
    }}

    .metric-note {{
      margin-top: 8px;
      font-size: 14px;
      color: var(--muted);
    }}

    .chart-panel {{
      padding: 18px;
    }}

    .chart-header {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }}

    .chart-legend {{
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 13px;
      color: var(--muted);
    }}

    .legend-item::before {{
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 8px;
      border-radius: 999px;
    }}

    .legend-rss::before {{ background: var(--accent); }}
    .legend-baseline::before {{ background: #64748b; }}
    .legend-settled::before {{ background: var(--good); }}
    .legend-target::before {{ background: var(--warning); }}
    .legend-marker::before {{ background: var(--danger); }}

    .chart-svg {{
      width: 100%;
      height: auto;
      display: block;
    }}

    .chart-bg {{
      fill: rgba(255, 255, 255, 0.94);
      stroke: rgba(38, 61, 49, 0.08);
    }}

    .grid {{
      stroke: rgba(38, 61, 49, 0.08);
      stroke-width: 1;
    }}

    .axis-label {{
      fill: #6a7a71;
      font-size: 12px;
    }}

    .axis-label-left {{
      text-anchor: end;
    }}

    .axis-label-bottom {{
      text-anchor: middle;
    }}

    .rss-line {{
      fill: none;
      stroke: var(--accent);
      stroke-width: 4;
      stroke-linejoin: round;
      stroke-linecap: round;
    }}

    .target-line {{
      stroke: rgba(171, 107, 17, 0.88);
      stroke-width: 2;
      stroke-dasharray: 8 8;
    }}

    .target-label {{
      fill: rgba(171, 107, 17, 0.88);
      text-anchor: end;
      font-size: 12px;
      font-weight: 600;
    }}

    .baseline-line {{
      stroke: rgba(100, 116, 139, 0.7);
      stroke-width: 2;
      stroke-dasharray: 6 6;
    }}

    .settled-line {{
      stroke: rgba(29, 107, 79, 0.72);
      stroke-width: 2;
      stroke-dasharray: 10 5;
    }}

    .marker-line {{
      stroke: rgba(163, 61, 52, 0.3);
      stroke-width: 2;
      stroke-dasharray: 4 7;
    }}

    .marker-dot {{
      fill: rgba(163, 61, 52, 0.94);
      stroke: rgba(255, 255, 255, 0.98);
      stroke-width: 2;
    }}

    .marker-text {{
      fill: white;
      text-anchor: middle;
      font-size: 11px;
      font-weight: 700;
    }}

    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      margin-top: 14px;
    }}

    th, td {{
      padding: 12px 10px;
      text-align: left;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }}

    th {{
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }}

    .two-up {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }}

    code {{
      font-family: "SFMono-Regular", Menlo, monospace;
      font-size: 13px;
      padding: 0.15em 0.4em;
      border-radius: 8px;
      background: var(--accent-soft);
      color: var(--ink);
    }}

    .footer-note {{
      font-size: 14px;
    }}

    @media (max-width: 720px) {{
      .shell {{
        width: min(100vw - 20px, 1180px);
        margin: 16px auto 28px;
      }}

      .hero,
      .metric-card,
      .panel {{
        border-radius: 20px;
      }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="eyebrow">Desktop Memory Validation</div>
      <h1>RSS stayed {html.escape(verdict_text.lower())}</h1>
      <p>
        Session duration was {fmt_seconds(duration_seconds)} on host <code>{html.escape(str(session.get("host", "")))}</code>.
        Baseline settled at {fmt_mb(baseline_mb)}, peak reached {fmt_mb(peak_mb)}, and the end-of-run plateau was {fmt_mb(settled_mb)}.
      </p>
      <div class="hero-meta">
        <span class="chip chip-{verdict_tone}">{html.escape(verdict_text)}</span>
        <span class="chip">PID {session.get("pid")}</span>
        <span class="chip">{html.escape(str(session.get("resolved_command", "")))}</span>
        <span class="chip">Target {plateau_text}</span>
        <span class="chip">Stop reason: {html.escape(str(session.get("stop_reason", "")))}</span>
      </div>
    </section>

    <section class="card-grid">
      <article class="metric-card">
        <div class="metric-label">Baseline</div>
        <div class="metric-value">{fmt_mb(baseline_mb)}</div>
        <div class="metric-note">Median of the first {fmt_seconds(baseline_window_seconds)}</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Peak</div>
        <div class="metric-value">{fmt_mb(peak_mb)}</div>
        <div class="metric-note">At {fmt_timecode(peak_time_seconds)} ({fmt_delta_mb(peak_delta)} vs baseline)</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Settled</div>
        <div class="metric-value">{fmt_mb(settled_mb)}</div>
        <div class="metric-note">Median of the last {fmt_seconds(settled_window_seconds)}</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Final sample</div>
        <div class="metric-value">{fmt_mb(final_mb)}</div>
        <div class="metric-note">{fmt_delta_mb(final_delta)} vs baseline</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Plateau delta</div>
        <div class="metric-value">{fmt_delta_mb(baseline_delta)}</div>
        <div class="metric-note">Settled minus baseline</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Tail slope</div>
        <div class="metric-value">{tail_slope:+.1f} MB/min</div>
        <div class="metric-note">Linear trend over the last {fmt_seconds(tail_window_seconds)}</div>
      </article>
    </section>

    <section class="panel chart-panel">
      <div class="chart-header">
        <div>
          <h2>RSS Timeline</h2>
          <p class="footer-note">Use the numbered markers to map the chart to the manual test steps below.</p>
        </div>
        <div class="chart-legend">
          <span class="legend-item legend-rss">RSS</span>
          <span class="legend-item legend-baseline">Baseline</span>
          <span class="legend-item legend-settled">Settled</span>
          <span class="legend-item legend-target">Target plateau</span>
          <span class="legend-item legend-marker">Marker</span>
        </div>
      </div>
      {chart}
    </section>

    <section class="two-up">
      <section class="panel">
        <h2>Phase Breakdown</h2>
        <p>Each row starts at a marker and ends at the next marker, so you can see whether each phase created a new baseline or just a temporary spike.</p>
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>Until</th>
              <th>Duration</th>
              <th>Start</th>
              <th>Peak</th>
              <th>End</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {phase_rows_html}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Markers</h2>
        <p>Recommended labels: <code>baseline done</code>, <code>rapid scrub start</code>, <code>rapid scrub stop</code>, <code>close viewer</code>, <code>reopen second study</code>.</p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>Time</th>
              <th>Source</th>
              <th>RSS nearby</th>
            </tr>
          </thead>
          <tbody>
            {marker_rows_html}
          </tbody>
        </table>
      </section>
    </section>

    {notes_html}

    <section class="panel">
      <h2>Session Metadata</h2>
      <p>
        Branch <code>{html.escape(str(session.get("git_branch", "")))}</code> at
        <code>{html.escape(str(session.get("git_commit", "")))}</code>,
        sampled every <code>{session.get("interval_seconds")}</code>s from
        <code>{html.escape(str(session.get("cwd", "")))}</code>.
      </p>
    </section>
  </main>
</body>
</html>
"""


def main() -> None:
    args = parse_args()
    session_path = pathlib.Path(args.session)
    output_path = ensure_output(pathlib.Path(args.output))
    session = read_session(session_path)
    target_plateau_mb = args.target_plateau_mb
    if target_plateau_mb is None:
        raw_target = session.get("target_plateau_mb")
        target_plateau_mb = float(raw_target) if raw_target is not None else None

    html_text = dashboard_html(
        session,
        target_plateau_mb,
        args.baseline_window_seconds,
        args.settled_window_seconds,
        args.tail_window_seconds,
    )
    output_path.write_text(html_text, encoding="utf-8")
    print(f"Wrote dashboard to {output_path}")


if __name__ == "__main__":
    main()
