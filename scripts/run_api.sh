#!/usr/bin/env bash
# Run the FastAPI backend. Set ANNA_LLM_PROVIDER=mock to develop without the model server.
set -euo pipefail
cd "$(dirname "$0")/../backend"
source /home/tgrogers-raid/a/chris241/accelsim_work/myminiconda/etc/profile.d/conda.sh
conda activate anna
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
