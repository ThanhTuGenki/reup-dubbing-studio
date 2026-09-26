#!/usr/bin/env python3
"""Unpack selected paths of a public GHCR Worker image without a Docker daemon.

Rented GPU containers (e.g. EzyCloudX templates) cannot run `docker pull`. This pulls
the image by immutable digest over the OCI distribution API, verifies every layer's
sha256, and extracts only the requested path prefixes, applying OCI whiteouts.
Standard library only, so it runs on a bare Ubuntu 22.04 python3.

  python3 pull_image.py ghcr.io/thanhtugenki/gpu-worker-batch@sha256:<digest> \
      --dest / --include opt/ --include usr/local/cuda-12.8/ --rename opt/reup-worker/=opt/reup-worker-tts/
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

ACCEPT = ", ".join((
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def parse_reference(reference: str) -> tuple[str, str, str]:
    registry, _, rest = reference.partition("/")
    repository, sep, digest = rest.partition("@")
    if not sep or not digest.startswith("sha256:") or len(digest) != 71:
        raise SystemExit(f"reference must be <registry>/<repo>@sha256:<64 hex>, got {reference}")
    return registry, repository, digest


def token(registry: str, repository: str) -> str:
    query = urllib.parse.urlencode({"scope": f"repository:{repository}:pull", "service": registry})
    with urllib.request.urlopen(f"https://{registry}/token?{query}", timeout=30) as response:
        return json.load(response)["token"]


def get(url: str, bearer: str | None, accept: str | None = None) -> http.client.HTTPResponse:
    """GET following redirects manually: blob redirects go to a signed CDN URL that must not get the token."""
    for _ in range(5):
        headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
        if accept:
            headers["Accept"] = accept
        try:
            return OPENER.open(urllib.request.Request(url, headers=headers), timeout=60)
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise
            url, bearer = urllib.parse.urljoin(url, error.headers["Location"]), None
    raise RuntimeError(f"too many redirects for {url}")


def manifest(registry: str, repository: str, digest: str, bearer: str) -> dict:
    with get(f"https://{registry}/v2/{repository}/manifests/{digest}", bearer, ACCEPT) as response:
        body = response.read()
    if "sha256:" + hashlib.sha256(body).hexdigest() != digest:
        raise SystemExit(f"manifest digest mismatch for {digest}")
    document = json.loads(body)
    if "manifests" in document:  # index: pick linux/amd64, skip attestations
        chosen = [m for m in document["manifests"]
                  if m.get("platform", {}).get("os") == "linux" and m["platform"].get("architecture") == "amd64"]
        if not chosen:
            raise SystemExit("image index has no linux/amd64 manifest")
        return manifest(registry, repository, chosen[0]["digest"], bearer)
    return document


def download(registry: str, repository: str, layer: dict, bearer: str, directory: Path) -> Path:
    target = directory / layer["digest"].replace(":", "-")
    digest = hashlib.sha256()
    with get(f"https://{registry}/v2/{repository}/blobs/{layer['digest']}", bearer) as response, target.open("wb") as out:
        while chunk := response.read(8 << 20):
            digest.update(chunk)
            out.write(chunk)
    if "sha256:" + digest.hexdigest() != layer["digest"]:
        target.unlink()
        raise SystemExit(f"layer digest mismatch for {layer['digest']}")
    return target


def mapped(name: str, includes: list[str], renames: list[tuple[str, str]]) -> str | None:
    """Image path -> destination path, or None when outside every --include prefix."""
    name = name[2:] if name.startswith("./") else name
    name = name.lstrip("/")
    probe = name + "/"  # so the directory entry "opt/x" matches prefix "opt/x/"
    if not any(probe.startswith(prefix) for prefix in includes):
        return None
    for source, destination in renames:
        if probe.startswith(source):
            return (destination + probe[len(source):]).rstrip("/")
    return name


def remove(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def extract(layer_file: Path, media_type: str, dest: Path, includes: list[str], renames: list[tuple[str, str]]) -> int:
    if "zstd" in media_type:
        raise SystemExit("zstd layers are not supported; rebuild the image with gzip compression")
    count = 0
    with tarfile.open(layer_file, mode="r|gz" if "gzip" in media_type else "r|") as archive:
        for member in archive:
            name = mapped(member.name, includes, renames)
            if name is None:
                continue
            path = PurePosixPath(name)
            target = dest / path
            if path.name == ".wh..wh..opq":  # opaque dir: drop what lower layers put there
                for child in target.parent.iterdir() if target.parent.is_dir() else ():
                    remove(child)
                continue
            if path.name.startswith(".wh."):
                remove(target.parent / path.name[4:])
                continue
            if member.islnk():
                link_source = mapped(member.linkname, includes, renames)
                if link_source and (dest / link_source).exists():
                    remove(target)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.link(dest / link_source, target)
                continue
            if target.is_symlink() or (target.exists() and not member.isdir()):
                remove(target)
            member.name = name
            try:
                archive.extract(member, dest, set_attrs=True, numeric_owner=True, filter="fully_trusted")
            except TypeError:  # Python without the tarfile extraction-filter backport
                archive.extract(member, dest, set_attrs=True, numeric_owner=True)
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("reference")
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--include", action="append", required=True, help="path prefix inside the image, e.g. opt/")
    parser.add_argument("--rename", action="append", default=[], help="SRC_PREFIX=DEST_PREFIX applied after --include")
    parser.add_argument("--max-layer-mb", type=int, help="skip larger layers (local testing only)")
    arguments = parser.parse_args()

    registry, repository, digest = parse_reference(arguments.reference)
    renames = [tuple(item.split("=", 1)) for item in arguments.rename]
    bearer = token(registry, repository)
    layers = manifest(registry, repository, digest, bearer)["layers"]
    total = sum(layer["size"] for layer in layers)
    print(f"{repository}@{digest[:19]}: {len(layers)} layers, {total / 1e9:.2f} GB", flush=True)
    arguments.dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="reup-pull-", dir=os.environ.get("REUP_PULL_TMP")) as tmp:
        for index, layer in enumerate(layers):
            size_mb = layer["size"] / 1e6
            if arguments.max_layer_mb is not None and size_mb > arguments.max_layer_mb:
                print(f"  [{index + 1}/{len(layers)}] SKIPPED {size_mb:.0f} MB (--max-layer-mb)", flush=True)
                continue
            layer_file = download(registry, repository, layer, bearer, Path(tmp))
            count = extract(layer_file, layer["mediaType"], arguments.dest, arguments.include, renames)
            layer_file.unlink()
            print(f"  [{index + 1}/{len(layers)}] {size_mb:.0f} MB verified, {count} entries extracted", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
