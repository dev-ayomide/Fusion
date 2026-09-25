#!/usr/bin/env bash
# Build the reference-vs-replica comparison video.
#   bench/compare-video.sh <reference.mp4> <frames_root> <out.mp4>
# frames_root/q1..q4 hold one loop each (f0000.png…) at 960×540, 30 fps. Each loop is repeated to
# cover the reference, the four are tiled 2×2 (same layout as the reference), then placed side by
# side with the original: left = original, right = Fusion Motion.
set -euo pipefail
REF=$1; ROOT=$2; OUT=$3
FF=${FFMPEG:-ffmpeg}
DUR=$( ($FF -i "$REF" 2>&1 || true) | sed -n 's/.*Duration: \([0-9:.]*\).*/\1/p' | awk -F: '{print $1*3600+$2*60+$3}')
in=()
for q in q1 q2 q3 q4; do in+=(-stream_loop -1 -framerate 30 -i "$ROOT/$q/f%04d.png"); done
$FF -loglevel error -y -i "$REF" "${in[@]}" -t "$DUR" -filter_complex "
  [1]scale=960:540,setsar=1[a];[2]scale=960:540,setsar=1[b];[3]scale=960:540,setsar=1[c];[4]scale=960:540,setsar=1[d];
  [a][b][c][d]xstack=inputs=4:layout=0_0|960_0|0_540|960_540[rep];
  [0:v]scale=1920:1080,setsar=1[ref];
  [ref][rep]hstack,scale=1920:-2[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart "$OUT"
echo "$OUT"
