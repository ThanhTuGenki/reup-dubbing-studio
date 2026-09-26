#!/usr/bin/env bash
# Prepare a rented GPU container that has no Docker daemon to run both Worker images.
# Unpacks the approved images by digest (no rebuild, no proot) and joins the tailnet
# in userspace mode. Run as root on an Ubuntu 22.04 template, e.g.
# nvidia/cuda:12.4.1-devel-ubuntu22.04:
#
#   curl -fsSL https://raw.githubusercontent.com/ThanhTuGenki/reup-dubbing-studio/<ref>/workers/gpu/rental/bootstrap.sh \
#     | CONTROL_PLANE_HOST=my-mac.tailXXXX.ts.net TS_AUTHKEY=tskey-auth-... REUP_REF=<ref> bash
#
# Or skip Tailscale when the Control Plane is already reachable, e.g. through an SSH
# reverse tunnel from the Control Plane host (ssh -R 18080:127.0.0.1:8080 root@gpu):
#   ... | CONTROL_PLANE_URL=http://127.0.0.1:18080/worker/v1 REUP_REF=<ref> bash
#
# Then: reup-workers start <batch-enrollment-token> <tts-enrollment-token>
set -euo pipefail

if [ -n "${CONTROL_PLANE_URL:-}" ]; then
  WORKER_PROXY=
else
  : "${CONTROL_PLANE_HOST:?set CONTROL_PLANE_HOST (tailnet) or CONTROL_PLANE_URL (direct)}"
  CONTROL_PLANE_URL=https://$CONTROL_PLANE_HOST/worker/v1
  WORKER_PROXY=http://127.0.0.1:1055
fi
REUP_REF=${REUP_REF:-feat/compose-control-plane}
BATCH_IMAGE=${BATCH_IMAGE:-ghcr.io/thanhtugenki/gpu-worker-batch@sha256:c383da610941d5ae895a576296e5922350a47b564c4c3e490b2f2501657a1a21}
TTS_IMAGE=${TTS_IMAGE:-ghcr.io/thanhtugenki/gpu-worker-interactive-tts@sha256:36349d8744627396c345316097d58e2568a35699d25903f3c26d671ff80c6325}
ROOT=/opt/reup
RAW=https://raw.githubusercontent.com/ThanhTuGenki/reup-dubbing-studio/$REUP_REF/workers/gpu/rental
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n==> %s\n' "$*"; }

step "System packages"
apt-get update -o Acquire::Retries=5
apt-get install --yes --no-install-recommends -o Acquire::Retries=5 \
  ca-certificates curl python3 ffmpeg libgl1 libglib2.0-0
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || echo "WARN: nvidia-smi failed" >&2

step "Rental tools from $REUP_REF"
mkdir -p "$ROOT/bin" "$ROOT/state"
curl -fsSL "$RAW/pull_image.py" -o "$ROOT/bin/pull_image.py"
curl -fsSL "$RAW/start-workers.sh" -o /usr/local/bin/reup-workers
chmod 755 /usr/local/bin/reup-workers
cat >"$ROOT/env" <<EOF
CONTROL_PLANE_URL=$CONTROL_PLANE_URL
WORKER_PROXY=$WORKER_PROXY
BATCH_IMAGE=$BATCH_IMAGE
TTS_IMAGE=$TTS_IMAGE
EOF

# Batch: Python + venvs under /opt as in the image, plus the image's CUDA/cuDNN user-space
# libraries (faster-whisper needs cuDNN 9) kept apart from the template's CUDA.
step "Unpack Batch image"
python3 "$ROOT/bin/pull_image.py" "$BATCH_IMAGE" --dest / \
  --include opt/uv-python/ --include opt/reup-worker/ --include opt/reup-demucs/ \
  --include usr/local/cuda-12.8/targets/x86_64-linux/lib/ --rename usr/local/cuda-12.8/targets/x86_64-linux/lib/=opt/reup/cuda-lib/ \
  --include usr/lib/x86_64-linux-gnu/libcudnn --rename usr/lib/x86_64-linux-gnu/=opt/reup/cuda-lib/

# TTS: its venv would collide with Batch's /opt/reup-worker, so it lives in /opt/reup-worker-tts.
step "Unpack Interactive TTS image"
python3 "$ROOT/bin/pull_image.py" "$TTS_IMAGE" --dest / \
  --include opt/uv-python/ --include opt/reup-worker/ --rename opt/reup-worker/=opt/reup-worker-tts/

# The images' own image_smoke refuses root and (in the 348a334c images) still expects the
# removed OCR venv, so check the three interpreters directly.
step "Import smoke"
LD_LIBRARY_PATH=$ROOT/cuda-lib /opt/reup-worker/bin/python -c \
  "import faster_whisper, ctranslate2, reup_worker.main; print('batch/asr ok, CUDA devices:', ctranslate2.get_cuda_device_count())"
/opt/reup-demucs/bin/python -c "import demucs.separate, torch; print('demucs ok, CUDA:', torch.cuda.is_available())"
/opt/reup-worker-tts/bin/python -c "import omnivoice, torch, reup_worker.main; print('tts ok, CUDA:', torch.cuda.is_available())"
command -v ffmpeg >/dev/null

if [ -n "$WORKER_PROXY" ]; then
  step "Tailscale (userspace networking, HTTP proxy on $WORKER_PROXY)"
  command -v tailscaled >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
  if ! tailscale status >/dev/null 2>&1; then
    mkdir -p "$ROOT/tailscale"
    nohup tailscaled --tun=userspace-networking --state="$ROOT/tailscale/tailscaled.state" \
      --socket="/run/tailscale/tailscaled.sock" --outbound-http-proxy-listen="${WORKER_PROXY#http://}" \
      >"$ROOT/state/tailscaled.log" 2>&1 &
    for _ in $(seq 20); do [ -S /run/tailscale/tailscaled.sock ] && break; sleep 1; done
    : "${TS_AUTHKEY:?set TS_AUTHKEY (ephemeral auth key) to join the tailnet}"
    tailscale up --auth-key="$TS_AUTHKEY" --hostname="reup-gpu-$(hostname | tr -cd 'a-z0-9-' | cut -c1-20)"
  fi
fi
step "Control Plane reachability"
curl -fsS ${WORKER_PROXY:+-x "$WORKER_PROXY"} "${CONTROL_PLANE_URL%/worker/v1}/v1/health/ready" >/dev/null \
  && echo "Control Plane reachable: $CONTROL_PLANE_URL" \
  || echo "WARN: ${CONTROL_PLANE_URL%/worker/v1}/v1/health/ready not reachable yet" >&2

step "Ready"
echo "Create one BATCH_MEDIA and one INTERACTIVE_TTS Worker in the UI, then run:"
echo "  reup-workers start <batch-token> <tts-token>"
