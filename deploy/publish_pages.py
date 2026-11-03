"""Publish the website (web/) to the gh-pages branch, served at https://hcoder10.github.io/blocksfield/.

    python deploy/publish_pages.py                    # dry run: build the site into out/pages and check it
    python deploy/publish_pages.py --out <dir>        # dry run into another dir
    python deploy/publish_pages.py --commit           # also commit the build to the local gh-pages branch
    python deploy/publish_pages.py --push             # commit, then push gh-pages to origin

What ships: web/index.html, web/site (no .py), web/kit (no docs), web/vendor, and every finished game in web/games:
not a "_" dir, has about.json, not a dry run. games/index.json is rebuilt for exactly those games.

The commit is made with git plumbing (a temporary index, write-tree, commit-tree, update-ref), so main, HEAD,
the real index and the working tree are never touched. The new commit's parent is origin/gh-pages (fetched first)
or the local gh-pages, so the push is a fast-forward; it never force-pushes.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MARK = ".blocksfield-pages"
BRANCH = "gh-pages"
sys.path.insert(0, str(WEB / "tools"))
import build_index  # noqa: E402

SKIP_SITE = shutil.ignore_patterns("*.py", "__pycache__", "*.pyc", ".DS_Store")
SKIP_KIT = shutil.ignore_patterns("docs", "*.md", "__pycache__", "*.pyc", ".DS_Store")
SKIP_GAME = shutil.ignore_patterns("*.webm", "__pycache__", "*.pyc", ".DS_Store")


def shippable_games() -> list[Path]:
    out = []
    for d in sorted(p for p in (WEB / "games").iterdir() if p.is_dir() and not p.name.startswith("_")):
        e = build_index.game_entry(d)
        if e and not e["dry_run"] and (d / e["play"]).exists():
            out.append(d)
    return out


def slim_video(mp4: Path, over_mb: float = 4.0) -> None:
    """The landing reel and cards stream these; ship a 960-wide copy of big ones (the source file is untouched)."""
    if not mp4.exists() or mp4.stat().st_size < over_mb * 1e6 or not shutil.which("ffmpeg"):
        return
    tmp = mp4.with_name("gameplay.slim.mp4")
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4), "-vf", "scale=960:-2", "-c:v", "libx264",
                        "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
                        "-movflags", "+faststart", str(tmp)])
    if r.returncode == 0 and tmp.exists() and tmp.stat().st_size < mp4.stat().st_size:
        tmp.replace(mp4)
    else:
        tmp.unlink(missing_ok=True)


def build(out: Path) -> dict:
    if out.exists():
        if not (out / MARK).exists():
            sys.exit(f"refusing to replace {out}: it is not a previous pages build (no {MARK})")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copyfile(WEB / "index.html", out / "index.html")
    shutil.copytree(WEB / "site", out / "site", ignore=SKIP_SITE)
    shutil.copytree(WEB / "kit", out / "kit", ignore=SKIP_KIT)
    shutil.copytree(WEB / "vendor", out / "vendor", ignore=SKIP_SITE)
    (out / "games").mkdir()
    games = shippable_games()
    for d in games:
        shutil.copytree(d, out / "games" / d.name, ignore=SKIP_GAME)
        slim_video(out / "games" / d.name / "gameplay.mp4")
    idx = build_index.build(out / "games", dev=False)
    idx.pop("generated", None)  # deterministic: an unchanged site makes an unchanged tree, so no empty publish
    (out / "games" / "index.json").write_text(json.dumps(idx, indent=1), encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    (out / MARK).write_text(time.strftime("%Y-%m-%dT%H:%M:%S%z"), encoding="utf-8")
    return {"games": [d.name for d in games]}


def check(out: Path) -> list[str]:
    """Every relative src/href in the site's HTML must exist in the build; no file over GitHub's 100 MB limit."""
    problems = []
    for html in [out / "index.html", out / "site" / "game.html"]:
        text = html.read_text(encoding="utf-8")
        for ref in re.findall(r'(?:src|href)="([^"#?:]+)"', text):
            if ref.startswith(("/", "data")):
                problems.append(f"{html.relative_to(out)}: absolute or odd URL {ref!r} (breaks under /blocksfield/)")
            elif not (html.parent / ref).exists():
                problems.append(f"{html.relative_to(out)}: missing {ref}")
    idx = json.loads((out / "games" / "index.json").read_text(encoding="utf-8"))
    for g in idx["games"]:
        if g.get("dev"):
            problems.append(f"index.json: dev card {g['id']} would ship")
        for k in ("play", "thumbnail", "video"):
            if g.get(k) and not (out / "games" / g["id"] / g[k]).exists():
                problems.append(f"index.json: {g['id']} {k} missing: {g[k]}")
    for p in out.rglob("*"):
        if p.is_file() and p.stat().st_size > 95e6:
            problems.append(f"{p.relative_to(out)} is {p.stat().st_size / 1e6:.0f} MB (GitHub limit 100 MB)")
        if p.is_dir() and p.parent == out / "games" and p.name.startswith("_"):
            problems.append(f"dev dir would ship: {p.relative_to(out)}")
    return problems


REPO = ROOT  # --repo overrides it, to test the commit/push path on a scratch clone


def git(*args: str, env: dict | None = None, check: bool = True) -> str:
    r = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, env=env)
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed:\n{r.stderr}")
    return r.stdout.strip()


def commit(out: Path, fetch: bool) -> str:
    if fetch:
        git("fetch", "origin", f"+refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}", check=False)
    parent = (git("rev-parse", "--verify", "-q", f"refs/remotes/origin/{BRANCH}", check=False)
              or git("rev-parse", "--verify", "-q", f"refs/heads/{BRANCH}", check=False))
    with tempfile.TemporaryDirectory() as td:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(td) / "index")}
        git("--work-tree", str(out), "add", "-A", "-f", ".", env=env)
        git("--work-tree", str(out), "rm", "-q", "--cached", "--ignore-unmatch", MARK, env=env)
        tree = git("write-tree", env=env)
    if parent and git("rev-parse", f"{parent}^{{tree}}") == tree:
        print(f"gh-pages already has this exact tree ({parent[:10]}); nothing to commit")
        return parent
    msg = f"Publish site {time.strftime('%Y-%m-%d %H:%M')}\n\nBuilt by deploy/publish_pages.py from {git('rev-parse', '--short', 'HEAD')}."
    args = ["commit-tree", tree, "-m", msg] + (["-p", parent] if parent else [])
    sha = git(*args)
    local = git("rev-parse", "--verify", "-q", f"refs/heads/{BRANCH}", check=False)
    git("update-ref", f"refs/heads/{BRANCH}", sha, local)  # fails if gh-pages moved meanwhile
    print(f"committed {sha[:10]} to local {BRANCH} (parent {parent[:10] if parent else 'none: first publish'})")
    return sha


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "out" / "pages"))
    ap.add_argument("--commit", action="store_true", help="commit the build to the local gh-pages branch")
    ap.add_argument("--push", action="store_true", help="commit and push gh-pages to origin")
    ap.add_argument("--repo", default=str(ROOT), help=argparse.SUPPRESS)
    a = ap.parse_args()
    global REPO
    REPO = Path(a.repo)
    out = Path(a.out).resolve()
    info = build(out)
    problems = check(out)
    files = [p for p in out.rglob("*") if p.is_file()]
    print(f"built {out}: {len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB, "
          f"{len(info['games'])} games: {', '.join(info['games']) or '(none yet)'}")
    for p in problems:
        print("PROBLEM:", p)
    if problems:
        sys.exit(1)
    if not info["games"]:
        print("warning: no finished games yet; the gallery will show its 'being generated' message")
    if a.commit or a.push:
        sha = commit(out, fetch=a.push)
        if a.push:
            r = subprocess.run(["git", "-C", str(REPO), "push", "origin", f"{sha}:refs/heads/{BRANCH}"])
            if r.returncode:
                sys.exit("push failed (not forced). Fetch and rerun.")
            print("pushed. Enable Pages once: repo Settings > Pages > Deploy from branch > gh-pages / (root).")
            print("site: https://hcoder10.github.io/blocksfield/")
    else:
        print("dry run: nothing committed. Serve it with: python -m http.server -d", out)


if __name__ == "__main__":
    main()
