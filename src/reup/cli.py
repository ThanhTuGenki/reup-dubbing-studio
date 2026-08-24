from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

import typer

from . import audio as au
from . import desub as ds
from . import ingest as ing
from . import render as rd
from . import stt_asr, stt_ocr
from . import translate as tr
from . import tts as tts_m
from .assets import AssetStore
from .config import load_config
from .logutil import run_logged
from .segments import load_segments, save_segments, to_srt, voiced
from .tts import TemplateTTS

log = logging.getLogger("reup.cli")

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
    for raw_name in engines.split(","):
        name = raw_name.strip()
        tpl = cfg.get("tts", {}).get(name, {}).get("cmd", "")
        if not tpl:
            typer.echo(f"{name}: skipped (chưa cấu hình)")
            continue
        t0 = time.time()
        TemplateTTS(name, tpl).synth(text, out_dir / f"{name}.wav")
        typer.echo(f"{name}: {time.time() - t0:.1f}s -> {out_dir / (name + '.wav')}")


@dataclass
class Ctx:
    store: AssetStore
    vid: str
    url: str
    mask: tuple[int, int, int, int]
    cookies: Path | None
    engine: str
    stt_main: str
    cfg: dict
    timings: dict = field(default_factory=dict)


def _timed(ctx: Ctx, name: str, fn: Callable[[], None]) -> None:
    log.info("stage %s: start", name)
    t0 = time.time()
    fn()
    elapsed = round(time.time() - t0, 1)
    ctx.timings[name] = elapsed
    ctx.store.write_json(ctx.vid, "timings.json", ctx.timings)
    log.info("stage %s: done (%.1fs)", name, elapsed)


def stage_ingest(ctx: Ctx) -> None:
    out = ctx.store.p(ctx.vid, "raw.mp4")
    if not out.exists():
        log = ctx.store.p(ctx.vid, "logs/ingest.log")
        _timed(ctx, "ingest", lambda: ing.download(ctx.url, out, ctx.cookies, log))


def stage_desub(ctx: Ctx) -> None:
    out = ctx.store.p(ctx.vid, "desubbed.mp4")
    if not out.exists():
        log = ctx.store.p(ctx.vid, "logs/desub.log")
        _timed(
            ctx,
            "desub",
            lambda: ds.desub(
                ctx.store.p(ctx.vid, "raw.mp4"), out, ctx.mask, ctx.cfg["desub"]["cmd"], log
            ),
        )


def stage_stt(ctx: Ctx) -> None:
    raw = ctx.store.p(ctx.vid, "raw.mp4")
    p_ocr, p_asr = (
        ctx.store.p(ctx.vid, "segments_ocr.json"),
        ctx.store.p(ctx.vid, "segments_asr.json"),
    )
    if not p_ocr.exists():
        log = ctx.store.p(ctx.vid, "logs/stt_ocr.log")
        _timed(
            ctx,
            "stt_ocr",
            lambda: save_segments(
                stt_ocr.transcribe(raw, ctx.mask, ctx.store.dir(ctx.vid), log_path=log), p_ocr
            ),
        )
    if not p_asr.exists():
        _timed(ctx, "stt_asr", lambda: save_segments(stt_asr.transcribe(raw), p_asr))


def stage_translate(ctx: Ctx) -> None:
    out = ctx.store.p(ctx.vid, "script.json")
    if out.exists():
        return
    segs = load_segments(ctx.store.p(ctx.vid, f"segments_{ctx.stt_main}.json"))

    def go() -> None:
        import anthropic

        client = anthropic.Anthropic()
        for i in range(0, len(segs), 50):
            tr.translate(segs[i : i + 50], client=client, model=ctx.cfg["llm"]["model"])
            # Persist after EACH batch: translation is the only stage that
            # costs money per attempt, so a truncated/rate-limited/overloaded
            # response mid-video must not discard every batch paid for
            # before it. Segments past the failure point simply keep their
            # blank text_vi, which TTS and the mixer already skip.
            save_segments(segs, out)

    _timed(ctx, "translate", go)


def stage_tts(ctx: Ctx) -> None:
    dub = ctx.store.dir(ctx.vid) / "dub"
    segs = load_segments(ctx.store.p(ctx.vid, "script.json"))
    expected = {f"{s.index:04d}.wav" for s in voiced(segs)}
    have = {p.name for p in dub.glob("*.wav")} if dub.exists() else set()
    if expected <= have:
        return
    adapter = tts_m.get_adapter(ctx.engine, ctx.cfg)
    log_path = ctx.store.p(ctx.vid, "logs/tts.log")
    _timed(ctx, "tts", lambda: tts_m.synth_segments(segs, adapter, dub, log_path))


def stage_mix(ctx: Ctx) -> None:
    out = ctx.store.p(ctx.vid, "mix.wav")
    if out.exists():
        return
    sep = ctx.store.dir(ctx.vid) / "sep"
    mix_log = ctx.store.p(ctx.vid, "logs/mix.log")

    def go() -> None:
        bg = next(sep.rglob("no_vocals.wav"), None)
        if bg is None:
            # Demucs is the longest-running stage -- don't pay for it twice
            # while debugging the mix filter if its output already exists.
            run_logged(
                au.demucs_cmd(ctx.store.p(ctx.vid, "desubbed.mp4"), sep),
                ctx.store.p(ctx.vid, "logs/demucs.log"),
            )
            bg = next(sep.rglob("no_vocals.wav"))
        segs = load_segments(ctx.store.p(ctx.vid, "script.json"))
        au.mix(bg, segs, ctx.store.dir(ctx.vid) / "dub", out, mix_log)

    _timed(ctx, "mix", go)


def stage_render(ctx: Ctx) -> None:
    out = ctx.store.p(ctx.vid, "out_16x9.mp4")
    if out.exists():
        return
    segs = load_segments(ctx.store.p(ctx.vid, "script.json"))
    srt = ctx.store.p(ctx.vid, "sub.srt")
    srt.write_text(to_srt(segs), encoding="utf-8")
    log = ctx.store.p(ctx.vid, "logs/render.log")
    _timed(
        ctx,
        "render",
        lambda: rd.render(
            ctx.store.p(ctx.vid, "desubbed.mp4"), ctx.store.p(ctx.vid, "mix.wav"), srt, out, log
        ),
    )


def _parse_mask(mask: str) -> tuple[int, int, int, int]:
    parts = mask.split(",")
    err = typer.BadParameter(
        f"mask phải có đúng 4 số nguyên dạng ymin,ymax,xmin,xmax, nhận: {mask!r}"
    )
    if len(parts) != 4:
        raise err
    try:
        ymin, ymax, xmin, xmax = (int(p.strip()) for p in parts)
    except ValueError:
        raise err from None
    if not (0 <= ymin < ymax and 0 <= xmin < xmax):
        raise typer.BadParameter(
            "mask phải thỏa 0 <= ymin < ymax và 0 <= xmin < xmax "
            f"(một mask âm hoặc đảo ngược sẽ tạo crop= âm kích thước), nhận: {mask!r}"
        )
    return ymin, ymax, xmin, xmax


def _validate_run_args(stt: str, engine: str, cfg: dict) -> None:
    if stt not in ("ocr", "asr"):
        raise typer.BadParameter(f"--stt phải là 'ocr' hoặc 'asr', nhận: {stt!r}")
    available_engines = sorted(cfg.get("tts", {}).keys())
    if engine not in available_engines:
        raise typer.BadParameter(
            f"--engine {engine!r} không có trong config.toml [tts.*]; "
            f"các engine hợp lệ: {', '.join(available_engines) or '(chưa cấu hình engine nào)'}"
        )
    for section in ("desub", "llm"):
        if section not in cfg:
            raise typer.BadParameter(f"config.toml thiếu mục bắt buộc [{section}]")


@app.command()
def run(
    url: str,
    mask: Annotated[str, typer.Option(help="ymin,ymax,xmin,xmax")],
    cookies: Annotated[Path | None, typer.Option()] = None,
    engine: Annotated[str, typer.Option()] = "vieneu",
    stt: Annotated[str, typer.Option(help="ocr|asr — bản dùng để dịch")] = "ocr",
    data_root: Annotated[Path, typer.Option()] = Path("data"),
    config: Annotated[Path, typer.Option()] = Path("config.toml"),
) -> None:
    m = _parse_mask(mask)
    cfg = load_config(config)
    _validate_run_args(stt, engine, cfg)
    ctx = Ctx(AssetStore(data_root), ing.video_id(url), url, m, cookies, engine, stt, cfg)
    try:
        ctx.timings = ctx.store.read_json(ctx.vid, "timings.json")
    except FileNotFoundError:
        pass
    from .logutil import setup_logging

    setup_logging(ctx.store.p(ctx.vid, "logs/pipeline.log"))
    try:
        for stage in [
            stage_ingest,
            stage_desub,
            stage_stt,
            stage_translate,
            stage_tts,
            stage_mix,
            stage_render,
        ]:
            stage(ctx)
    except RuntimeError as e:
        typer.echo(str(e))
        raise typer.Exit(1) from e
    typer.echo(f"Done: {ctx.store.p(ctx.vid, 'out_16x9.mp4')}")


def _load_segments_or_none(st: AssetStore, vid: str, name: str) -> list | None:
    try:
        return load_segments(st.p(vid, name))
    except FileNotFoundError:
        return None


@app.command()
def report(vid: str, data_root: Annotated[Path, typer.Option()] = Path("data")) -> None:
    st = AssetStore(data_root)
    ocr = _load_segments_or_none(st, vid, "segments_ocr.json")
    asr = _load_segments_or_none(st, vid, "segments_asr.json")

    if ocr is None and asr is None:
        typer.echo("Chưa có segments_ocr.json hoặc segments_asr.json — chạy `reup run` trước.")
        return
    if ocr is None:
        typer.echo("Thiếu segments_ocr.json.")
    if asr is None:
        typer.echo("Thiếu segments_asr.json.")

    if ocr is not None:
        typer.echo("| t | OCR | ASR |\n|---|-----|-----|")
        for o in ocr[:200]:
            near = min(asr, key=lambda a: abs(a.start - o.start), default=None) if asr else None
            typer.echo(f"| {o.start:.1f} | {o.text_src} | {near.text_src if near else ''} |")
    else:
        typer.echo("| t | ASR |\n|---|-----|")
        for a in asr[:200]:
            typer.echo(f"| {a.start:.1f} | {a.text_src} |")

    try:
        timings = st.read_json(vid, "timings.json")
    except FileNotFoundError:
        timings = {}
    typer.echo(f"\nTimings: {timings}")


if __name__ == "__main__":
    app()
