from pathlib import Path

import pytest

from reup.desub import desub, render_cmd


def test_render_cmd():
    t = (
        "python tools/vsr/backend/main.py --input {input} --output {output} "
        "--area {ymin},{ymax},{xmin},{xmax}"
    )
    cmd = render_cmd(t, Path("in.mp4"), Path("out.mp4"), (600, 700, 0, 1280))
    assert cmd == [
        "python",
        "tools/vsr/backend/main.py",
        "--input",
        "in.mp4",
        "--output",
        "out.mp4",
        "--area",
        "600,700,0,1280",
    ]


def test_render_cmd_path_with_space_stays_one_argv_element():
    # A --data-root containing a space (e.g. "~/Desktop/My Videos/data") must
    # not be shattered into two argv tokens by shlex.split. That requires
    # splitting the template FIRST (placeholders intact) and substituting
    # per already-split token -- substituting into the raw template string
    # before splitting breaks on any whitespace inside a path.
    t = "python tools/vsr/backend/main.py --input {input} --output {output}"
    inp = Path("/Users/x/My Videos/data/in.mp4")
    out = Path("/Users/x/My Videos/data/out.mp4")
    cmd = render_cmd(t, inp, out, (600, 700, 0, 1280))
    assert cmd == [
        "python",
        "tools/vsr/backend/main.py",
        "--input",
        str(inp),
        "--output",
        str(out),
    ]


def test_desub_raises_on_empty_template(tmp_path):
    with pytest.raises(RuntimeError, match="desub"):
        desub(Path("in.mp4"), tmp_path / "out.mp4", (0, 1, 0, 1), "")


def test_desub_raises_when_output_missing(tmp_path):
    # The template runs successfully (exit 0) but never creates `output`.
    t = 'python3 -c "print(1)" {input} {output}'
    with pytest.raises(RuntimeError, match="không tạo ra"):
        desub(Path("in.mp4"), tmp_path / "out.mp4", (0, 1, 0, 1), t)
