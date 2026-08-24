from __future__ import annotations

import time
from pathlib import Path
from typing import Annotated

import typer

from .config import load_config
from .tts import TemplateTTS

app = typer.Typer(no_args_is_help=True)


@app.callback()
def main() -> None:
    """Reup dubbing studio CLI."""


@app.command("bench-tts")
def bench_tts(
    text: Annotated[str, typer.Option()],
    engines: Annotated[str, typer.Option()] = "vieneu,f5,omnivoice",
    out_dir: Annotated[Path, typer.Option()] = Path("bench"),
    config: Annotated[Path, typer.Option()] = Path("config.toml"),
) -> None:
    cfg = load_config(config)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in engines.split(","):
        tpl = cfg.get("tts", {}).get(name, {}).get("cmd", "")
        if not tpl:
            typer.echo(f"{name}: skipped (chưa cấu hình)")
            continue
        t0 = time.time()
        TemplateTTS(name, tpl).synth(text, out_dir / f"{name}.wav")
        typer.echo(f"{name}: {time.time() - t0:.1f}s -> {out_dir / (name + '.wav')}")


if __name__ == "__main__":
    app()
