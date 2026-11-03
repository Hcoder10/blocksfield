#!/bin/bash
# Records the v3 promo's game clips (1080p30, frame-stepped). Usage: bash web/tools/record_clips.sh id [id ...]
cd "$(dirname "$0")/.."
PY=${PY:-/c/Users/sarta/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe}
OUT=../video/v3/clips
for id in "$@"; do
  if [ "$id" = "_splat" ]; then
    $PY tools/record.py "games/_demo_look/splat_test.html?look=toon_bright&cam=orbit" --out $OUT/_splat.mp4 --seconds 6 --warmup 0.5 | tail -c 300
    continue
  fi
  $PY tools/record.py games/$id/index.html --out $OUT/${id}_play.mp4 --seconds 11 --warmup 2.5 \
      --eval "__kit.start && __kit.start()" --eval "__kit.autopilot(true)" | tail -c 400
  $PY tools/record.py games/$id/index.html --out $OUT/${id}_orbit.mp4 --orbit 5 --warmup 0.5 \
      --eval "__kit.start && __kit.start()" | tail -c 200
done
