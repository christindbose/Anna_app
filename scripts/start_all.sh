#!/usr/bin/env bash
# Start model server, backend, and frontend in the background. Logs go to ./logs/.
# Stop with: scripts/stop_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
[ -f .env ] && set -a && source .env && set +a
nohup scripts/serve_model.sh > logs/model.log 2>&1 &
nohup scripts/serve_tts.sh > logs/tts.log 2>&1 &
nohup scripts/run_api.sh > logs/api.log 2>&1 &
( export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; cd frontend; nohup npm run start -- -p 3000 > ../logs/web.log 2>&1 & )
echo "model: logs/model.log (wait for 'model ready')"
echo "tts:   logs/tts.log (wait for 'kokoro ready')"
echo "api:   http://127.0.0.1:8000/api/health"
echo "web:   http://$(hostname -I | awk '{print $1}'):3000"
