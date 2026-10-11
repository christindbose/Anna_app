#!/usr/bin/env bash
# Checks whether the HF token in .env can download MedGemma. Run after accepting the
# model terms at https://huggingface.co/google/medgemma-1.5-4b-it
set -euo pipefail
cd "$(dirname "$0")/.."
source /home/tgrogers-raid/a/chris241/accelsim_work/myminiconda/etc/profile.d/conda.sh
conda activate anna-model
[ -f .env ] && set -a && source .env && set +a
MODEL="${ANNA_LLM_MODEL:-google/medgemma-1.5-4b-it}"
python - "$MODEL" <<'PY'
import sys
from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from huggingface_hub.utils import GatedRepoError
repo = sys.argv[1]
w = HfApi().whoami()
print(f"token OK for user {w['name']} (type: {w.get('auth',{}).get('accessToken',{}).get('role')})")
try:
    hf_hub_download(repo, "config.json")
except GatedRepoError:
    print(f"\nNOT YET: {repo} is gated and this account/token is not authorized.")
    print(f"  1. Log in as {w['name']} and accept the terms at https://huggingface.co/{repo}")
    print("  2. If the token is fine-grained, edit it at https://huggingface.co/settings/tokens and")
    print("     enable 'Read access to contents of all public gated repos you can access'.")
    sys.exit(1)
print("access granted; downloading weights (skips files already cached)...")
print("cached at", snapshot_download(repo))
print("\nReady. Restart the model server:  scripts/stop_all.sh && scripts/start_all.sh")
PY
