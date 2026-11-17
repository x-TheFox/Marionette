#!/usr/bin/env python3
"""Re-fetch Marionette's UI sound set from Kenney's CC0 packs.

The sounds under assets/sounds/ are unmodified Kenney pack files renamed to
Marionette event names (see assets/sounds/LICENSES.md for the mapping and
license). This script reproduces that directory from the public pack zips so
the step is not a black box.

Usage:  python3 scripts/fetch-sounds.py [--out assets/sounds]

Requires network access to kenney.nl (the download links are signed and
short-lived; a fresh one is fetched per pack, same as a browser does).
"""
import argparse
import io
import json
import os
import sys
import urllib.request
import zipfile

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Marionette-sound-fetch/1.0"}

PACKS = {
    "interface-sounds": "assets/interface-sounds",
    "digital-audio": "assets/digital-audio",
}

# event -> (pack, internal path); mirrors assets/sounds/LICENSES.md
MAPPING = {
    "move": ("interface-sounds", "Audio/pluck_001.ogg"),
    "capture": ("interface-sounds", "Audio/drop_001.ogg"),
    "check": ("interface-sounds", "Audio/glass_002.ogg"),
    "promotion": ("digital-audio", "Audio/powerUp4.ogg"),
    "milestone": ("interface-sounds", "Audio/confirmation_001.ogg"),
    "victory": ("digital-audio", "Audio/threeTone1.ogg"),
    "defeat": ("digital-audio", "Audio/lowDown.ogg"),
    "illegal": ("interface-sounds", "Audio/error_001.ogg"),
}


def download_pack(slug: str) -> zipfile.ZipFile:
    """Fetch a Kenney pack zip via the signed-link endpoint (like the site JS)."""
    hex_id = slug.encode().hex()  # e.g. 'assets/interface-sounds' -> download-id
    req = urllib.request.Request(
        f"https://kenney.nl/download-link/{hex_id}", headers=UA
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        url = json.load(resp)["url"]
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return zipfile.ZipFile(io.BytesIO(resp.read()))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="assets/sounds")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    zips = {}
    for slug in PACKS.values():
        short = slug.split("/")[-1]
        print(f"[fetch-sounds] downloading pack {short} ...")
        zips[short] = download_pack(slug)

    for event, (pack, path) in MAPPING.items():
        data = zips[pack].read(path)
        dest = os.path.join(args.out, f"{event}.ogg")
        with open(dest, "wb") as f:
            f.write(data)
        print(f"[fetch-sounds] {event}.ogg <- {pack}:{path} ({len(data)} bytes)")

    lic = zips["interface-sounds"].read("License.txt").decode()
    with open(os.path.join(args.out, "KENNEY-LICENSE.txt"), "w") as f:
        f.write(lic)
    print("[fetch-sounds] KENNEY-LICENSE.txt written")
    print("[fetch-sounds] done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
