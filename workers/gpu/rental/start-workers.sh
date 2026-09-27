#!/usr/bin/env bash
# Run the Batch and Interactive TTS Worker agents unpacked by bootstrap.sh.
#   reup-workers start <batch-token> <tts-token>   # tokens only needed before first enrollment
#   reup-workers stop | status | logs
set -euo pipefail

ROOT=${REUP_ROOT:-/opt/reup}
# shellcheck disable=SC1091
. "$ROOT/env"

run() { # name role token
  local name=$1 role=$2 token=${3:-} dir=$ROOT/state/$1
  if [ -f "$dir.pid" ] && kill -0 "$(cat "$dir.pid")" 2>/dev/null; then echo "$name already running"; return; fi
  mkdir -p "$dir/work" "$dir/models" && chmod 700 "$dir"
  if [ ! -s "$dir/credential" ] && [ -z "$token" ]; then echo "$name: enrollment token required" >&2; return 1; fi
  (
    # Only Control Plane traffic may use the tailnet proxy; R2 and model downloads go direct.
    if [ -n "${WORKER_PROXY:-}" ]; then export HTTPS_PROXY=$WORKER_PROXY https_proxy=$WORKER_PROXY HTTP_PROXY=$WORKER_PROXY http_proxy=$WORKER_PROXY; fi
    export NO_PROXY=localhost,127.0.0.1,.r2.cloudflarestorage.com,.huggingface.co,huggingface.co,.hf.co,dl.fbaipublicfiles.com,download.pytorch.org
    export no_proxy=$NO_PROXY
    export PYTHONUNBUFFERED=1 REUP_WORKER_CONTRACT_VERSION=2 \
      REUP_WORKER_CONTROL_PLANE_URL="$CONTROL_PLANE_URL" \
      REUP_WORKER_CREDENTIAL_FILE="$dir/credential" REUP_WORKER_WORKSPACE_ROOT="$dir/work" \
      HF_HOME="$ROOT/state/huggingface"
    [ -n "$token" ] && [ ! -s "$dir/credential" ] && export REUP_WORKER_ENROLLMENT_TOKEN=$token
    if [ "$role" = BATCH_MEDIA ]; then
      # Names must match the Control Plane (see docs/operations/control-plane-compose.md).
      # JSON, not comma-separated: pydantic-settings JSON-decodes tuple fields before the
      # comma-splitting validator runs, so the Dockerfile's comma form crashes the agent.
      export REUP_WORKER_ROLE=BATCH_MEDIA REUP_WORKER_EXECUTOR=batch \
        REUP_WORKER_IMAGE_DIGEST="${BATCH_IMAGE#*@}" \
        REUP_WORKER_CAPABILITIES='["transcript.asr.v1","audio.separate.demucs.v1","media.render.ffmpeg.v1"]' \
        REUP_WORKER_ASR_PYTHON=/opt/reup-worker/bin/python REUP_WORKER_DEMUCS_PYTHON=/opt/reup-demucs/bin/python \
        LD_LIBRARY_PATH="$ROOT/cuda-lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      python=/opt/reup-worker/bin/python
    else
      export REUP_WORKER_ROLE=INTERACTIVE_TTS REUP_WORKER_EXECUTOR=interactive-tts \
        REUP_WORKER_IMAGE_DIGEST="${TTS_IMAGE#*@}" REUP_WORKER_CAPABILITIES='["tts.omnivoice.v1"]' \
        REUP_WORKER_TTS_MODEL_CACHE_ROOT="$dir/models/assembled" REUP_WORKER_TTS_PROMPT_CACHE_ROOT="$dir/voice-prompts"
      python=/opt/reup-worker-tts/bin/python
    fi
    # Supervise: the agent exits on some transient Control Plane errors (e.g. a non-JSON 502
    # while the API restarts). The credential persists, so restarting re-opens the session.
    while true; do
      "$python" -m reup_worker.main && code=0 || code=$?
      unset REUP_WORKER_ENROLLMENT_TOKEN
      echo "[reup-workers] $name agent exited with $code at $(date -u +%FT%TZ); restarting in 5s"
      sleep 5
    done
  ) >>"$dir.log" 2>&1 &
  echo $! >"$dir.pid"
  echo "$name started (supervisor pid $!), log $dir.log"
}

stop_one() { # name: kill the supervisor loop and the agent it started
  local pidfile=$ROOT/state/$1.pid pid
  [ -f "$pidfile" ] || return 0
  pid=$(cat "$pidfile")
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null && echo "$1 stopped"
  rm -f "$pidfile"
}

case ${1:-status} in
  # Each agent starts independently, so one missing token does not block the other.
  start) status=0; run batch BATCH_MEDIA "${2:-}" || status=1; run tts INTERACTIVE_TTS "${3:-}" || status=1; exit $status ;;
  stop) stop_one batch; stop_one tts ;;
  status) for name in batch tts; do
            if [ -f "$ROOT/state/$name.pid" ] && kill -0 "$(cat "$ROOT/state/$name.pid")" 2>/dev/null; then echo "$name: running"; else echo "$name: stopped"; fi
          done; nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader || true ;;
  logs) tail -n 50 -f "$ROOT/state/batch.log" "$ROOT/state/tts.log" ;;
  *) echo "usage: reup-workers start <batch-token> <tts-token> | stop | status | logs" >&2; exit 2 ;;
esac
