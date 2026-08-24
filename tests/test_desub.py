from pathlib import Path

from reup.desub import render_cmd


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
