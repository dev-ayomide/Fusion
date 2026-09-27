#!/usr/bin/env bash
# Render an FMD doc to an H.264 MP4 (+ AAC soundtrack when doc.audio is set): frames through the harness, then ffmpeg.
#   bench/render-mp4.sh /fixtures/showcase/s01-type-a-sentence.fmd.json out/s01.mp4 [width=1920]
# Needs the frozen render server: npx vite --config render.vite.config.ts   (port 5181)
# ffmpeg: $FFMPEG, else ffmpeg on PATH, else the one bundled with Remotion in the repo root.
set -euo pipefail
DOC=$1; OUT=$2; W=${3:-1920}
HERE=$(cd "$(dirname "$0")/.." && pwd)
FF=${FFMPEG:-$(command -v ffmpeg || true)}
if [ -z "$FF" ]; then
  RC="$HERE/../node_modules/@remotion/compositor-darwin-arm64"
  [ -x "$RC/ffmpeg" ] || { echo "no ffmpeg found (set FFMPEG)"; exit 1; }
  export DYLD_LIBRARY_PATH="$RC"; FF="$RC/ffmpeg"
fi
FPS=$(node -e "fetch('http://localhost:${PORT:-5181}$DOC').then(r=>r.json()).then(d=>console.log(d.comp.fps))")
FRAMES="$HERE/out/frames/$(basename "$DOC" .fmd.json)-$W"
node "$HERE/bench/render-frames.mjs" "$DOC" "$FRAMES" "$W"
mkdir -p "$(dirname "$OUT")"
# soundtrack (doc.audio): mixed by bench/mix-audio.mjs, muxed as AAC; silent docs render exactly as before
WAV="$FRAMES/soundtrack.wav"
MIX=$(node "$HERE/bench/mix-audio.mjs" "http://localhost:${PORT:-5181}$DOC" "$WAV")
if [ "$MIX" = "none" ]; then
  "$FF" -loglevel error -y -framerate "$FPS" -i "$FRAMES/f%04d.png" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart "$OUT"
else
  "$FF" -loglevel error -y -framerate "$FPS" -i "$FRAMES/f%04d.png" -i "$WAV" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT"
fi
echo "$OUT"
