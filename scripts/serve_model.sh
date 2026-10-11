#!/usr/bin/env bash
# Serve the model on one V100 with plain transformers (fp16: Volta has no bf16).
# vLLM is not used: current vLLM/PyTorch CUDA 13 wheels dropped Volta (sm_70) kernels.
# Needs HF_TOKEN with MedGemma terms accepted: https://huggingface.co/google/medgemma-1.5-4b-it
set -euo pipefail
source /home/tgrogers-raid/a/chris241/accelsim_work/myminiconda/etc/profile.d/conda.sh
conda activate anna-model
# Pick up HF_TOKEN / ANNA_LLM_MODEL from the repo .env when run standalone.
ENV_FILE="$(dirname "$0")/../.env"
[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a
MODEL="${ANNA_LLM_MODEL:-google/medgemma-1.5-4b-it}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
exec python "$(dirname "$0")/model_server.py" --model "$MODEL" --port 8001 --host 127.0.0.1 "$@"
