#!/usr/bin/env python3
"""Regenerate multi-size thumbnails for all existing image assets.

Reads originals from disk and generates small (100px), medium (600px),
and large (1200px) thumbnails. Safe to re-run — overwrites existing
sized thumbnails.

Usage:
    python scripts/regenerate-thumbnails.py          # Run
    DRY_RUN=1 python scripts/regenerate-thumbnails.py  # Preview only
"""

import os
import sys
from pathlib import Path

# Add src to path so we can import the package
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from image_server.config import THUMBNAIL_SIZES, get_config
from image_server.thumbnails import generate_all_thumbnails_from_path

DRY_RUN = os.environ.get("DRY_RUN") == "1"


def main() -> None:
    cfg = get_config()
    originals_dir = Path(cfg.media_path) / "originals"

    if not originals_dir.exists():
        print(f"Originals directory not found: {originals_dir}")
        sys.exit(1)

    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".heic", ".heif"}
    originals = [
        f for f in originals_dir.iterdir()
        if f.is_file() and f.suffix.lower() in image_extensions
    ]

    print(f"Found {len(originals)} original images")
    print(f"Generating sizes: {', '.join(f'{k} ({v}px)' for k, v in THUMBNAIL_SIZES.items())}")
    print(f"Mode: {'DRY RUN' if DRY_RUN else 'LIVE'}")
    print()

    generated = 0
    errors = 0

    for original in sorted(originals):
        file_uuid = original.stem
        if DRY_RUN:
            print(f"  [DRY RUN] Would generate thumbnails for {original.name}")
            generated += 1
            continue

        try:
            generate_all_thumbnails_from_path(original, file_uuid)
            generated += 1
            print(f"  ✓ {original.name}")
        except Exception as exc:
            errors += 1
            print(f"  ✗ {original.name}: {exc}")

    print(f"\nDone: {generated} processed, {errors} errors")


if __name__ == "__main__":
    main()
