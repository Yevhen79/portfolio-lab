"""Per-run pipeline trace for the portfolio builder.

After every optimize request the engine fills a `BuildTrace` with the
sequence of filtering / optimisation steps and renders it to Markdown.
The file is saved to `data/traces/{uuid}.md` and the UUID is returned to
the frontend so the user can download a readable post-mortem of:

  • which assets were on the input
  • which dropped out at each filter, and WHY
  • which survived to the optimiser
  • what the optimiser did with them (initial + sparsify iterations)

The goal is transparency without exposing math — just lists of tickers
+ short reasons. Helps the user verify the result is sensible without
having to read the code.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

logger = logging.getLogger(__name__)


@dataclass
class StepEntry:
    """One stage in the pipeline (a single filter or optimisation pass)."""

    name: str
    """Human-friendly step title, e.g. "Минимальная история (≥ 6 лет)"."""

    kept: list[tuple[str, str]] = field(default_factory=list)
    """`(symbol, full_name)` for the assets that passed this step."""

    dropped: list[tuple[str, str, str]] = field(default_factory=list)
    """`(symbol, full_name, reason)` for the assets that fell out here."""

    note: str = ""
    """Free-form note shown under the step heading."""


@dataclass
class BuildTrace:
    """Mutable container the engine fills as it works."""

    request_summary: dict[str, Any] = field(default_factory=dict)
    """The user's request params for the run header."""

    steps: list[StepEntry] = field(default_factory=list)
    final_summary: dict[str, Any] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.now)

    def add_step(
        self,
        name: str,
        kept: Iterable[tuple[str, str]] = (),
        dropped: Iterable[tuple[str, str, str]] = (),
        note: str = "",
    ) -> None:
        self.steps.append(
            StepEntry(
                name=name,
                kept=[(s, n) for s, n in kept],
                dropped=[(s, n, r) for s, n, r in dropped],
                note=note,
            )
        )

    # ------------------------------------------------------------------
    # Markdown rendering
    # ------------------------------------------------------------------

    def render_markdown(self) -> str:
        """Render the full trace as a Markdown document.

        Layout:
            # Header — timestamp + request params
            ## N. Step title
            > Note (if any)
            **Прошли (K):** TICKER (Name), …
            **Отсеяны (M):** TICKER (Name) — reason, …
            ## Final summary
        """
        lines: list[str] = []
        lines.append(f"# Трассировка построения портфеля")
        lines.append("")
        lines.append(f"*Время запуска:* `{self.started_at.strftime('%Y-%m-%d %H:%M:%S')}`")
        lines.append("")
        if self.request_summary:
            lines.append("## Параметры запроса")
            lines.append("")
            for k, v in self.request_summary.items():
                lines.append(f"- **{k}**: `{v}`")
            lines.append("")

        for i, step in enumerate(self.steps, start=1):
            lines.append(f"## {i}. {step.name}")
            lines.append("")
            if step.note:
                lines.append(f"> {step.note}")
                lines.append("")
            n_kept = len(step.kept)
            n_dropped = len(step.dropped)
            lines.append(f"**Прошли дальше: {n_kept}** · **Отсеяны: {n_dropped}**")
            lines.append("")
            if step.dropped:
                lines.append(f"### Отсеяны ({n_dropped})")
                lines.append("")
                # Cap at 200 to keep file size sane on a 1500-asset run.
                for sym, name, reason in step.dropped[:200]:
                    lines.append(f"- `{sym}` ({name}) — {reason}")
                if len(step.dropped) > 200:
                    lines.append(f"- … и ещё {len(step.dropped) - 200}")
                lines.append("")
            if step.kept:
                lines.append(f"### Прошли дальше ({n_kept})")
                lines.append("")
                for sym, name in step.kept[:200]:
                    lines.append(f"- `{sym}` ({name})")
                if len(step.kept) > 200:
                    lines.append(f"- … и ещё {len(step.kept) - 200}")
                lines.append("")

        if self.final_summary:
            lines.append("## Итоговый портфель")
            lines.append("")
            for k, v in self.final_summary.items():
                lines.append(f"- **{k}**: {v}")
            lines.append("")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, traces_dir: Path) -> str:
        """Write the markdown to disk and return the trace id."""
        traces_dir.mkdir(parents=True, exist_ok=True)
        trace_id = uuid.uuid4().hex
        path = traces_dir / f"{trace_id}.md"
        try:
            path.write_text(self.render_markdown(), encoding="utf-8")
        except Exception as exc:
            logger.warning("Failed to save trace %s: %s", path, exc)
            return ""
        return trace_id
