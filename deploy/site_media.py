"""Build the website's media (web/site/media/) from the run artefacts, which are not in git (runs/, video/).

    python deploy/site_media.py            # skips files that already exist
    python deploy/site_media.py --force

Outputs web-sized copies: Roblox footage clips (720p H.264, muted, faststart) with posters, the Roblox thumbnail and
concept board as JPEG, the GPU dashboard timelapse as a short video, and the site fonts as woff2 (Latin subset).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "web" / "site" / "media"
FONTS = ROOT / "web" / "site" / "fonts"
RUN = ROOT / "runs" / "starbloom_final"
FOOTAGE = ROOT / "video" / "game_footage"

CLIPS = {"roblox_orbit": "clip_01_orbit.mp4", "roblox_dolly": "clip_02_dolly.mp4", "roblox_hero": "clip_03_hero.mp4"}
STILLS = {"roblox_thumb.jpg": ROOT / "examples" / "starbloom_peaks_thumbnail.png",
          "roblox_hud.jpg": FOOTAGE / "clip_04_hud.jpg", "roblox_course.jpg": FOOTAGE / "clip_05_course.jpg",
          "roblox_concept_hub.jpg": RUN / "refs" / "hub_afternoon.png",
          "roblox_concept_payoff.jpg": RUN / "refs" / "grand_bloom_payoff.png"}
FONT_SRC = ROOT / "web" / "kit" / "ui" / "fonts"
FONT_FILES = {"LilitaOne": "LilitaOne.ttf", "Rubik": "Rubik.ttf"}


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def need(p: Path, force: bool) -> bool:
    return force or not p.exists()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    MEDIA.mkdir(parents=True, exist_ok=True)
    FONTS.mkdir(parents=True, exist_ok=True)
    from PIL import Image

    for name, src in CLIPS.items():
        out = MEDIA / f"{name}.mp4"
        if need(out, a.force) and (FOOTAGE / src).exists():
            ff("-i", str(FOOTAGE / src), "-an", "-vf", "scale=1280:-2,fps=30", "-c:v", "libx264", "-preset", "slow",
               "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out))
            ff("-i", str(out), "-frames:v", "1", "-q:v", "4", str(MEDIA / f"{name}.jpg"))
    for name, src in STILLS.items():
        out = MEDIA / name
        if need(out, a.force) and src.exists():
            with Image.open(src) as im:
                im = im.convert("RGB")
                im.thumbnail((1280, 1280))
                im.save(out, "JPEG", quality=84, optimize=True, progressive=True)

    # GPU dashboard timelapse: one capture every 30 s during the Starbloom build; the busy first 300 frames.
    out = MEDIA / "gpu_timelapse.mp4"
    frames = sorted((RUN / "dashboard").glob("dash_*.png"))[:300]
    if need(out, a.force) and frames:
        with tempfile.TemporaryDirectory() as td:
            for i, f in enumerate(frames):
                shutil.copyfile(f, Path(td) / f"f{i:05d}.png")
            ff("-framerate", "20", "-i", str(Path(td) / "f%05d.png"), "-vf", "crop=1920:770:0:0,scale=1280:-2",
               "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
               str(out))
        ff("-sseof", "-0.1", "-i", str(out), "-frames:v", "1", "-q:v", "4", str(MEDIA / "gpu_timelapse.jpg"))

    from fontTools import subset
    for fam, src in FONT_FILES.items():
        out = FONTS / f"{fam}.woff2"
        if need(out, a.force) and (FONT_SRC / src).exists():
            subset.main([str(FONT_SRC / src), f"--output-file={out}", "--flavor=woff2", "--layout-features=*",
                         "--unicodes=U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,"
                         "U+2074,U+20AC,U+2122,U+2190-2199,U+2212,U+2215"])
            lic = FONT_SRC / f"OFL-{fam.lower()}.txt"
            if lic.exists():
                shutil.copyfile(lic, FONTS / lic.name)
    for p in sorted(list(MEDIA.iterdir()) + list(FONTS.iterdir())):
        print(f"{p.stat().st_size / 1e6:7.2f} MB  {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
