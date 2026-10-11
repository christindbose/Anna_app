#!/usr/bin/env bash
# Kokoro TTS server on port 8002 (shares GPU 0 with the LLM; the model is tiny).
set -euo pipefail
source /home/tgrogers-raid/a/chris241/accelsim_work/myminiconda/etc/profile.d/conda.sh
conda activate anna-model
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
exec python "$(dirname "$0")/tts_server.py" --port 8002 --host 127.0.0.1 "$@"
