#!/usr/bin/env bash
# Start the box's servers, each in its own tmux session (re-running restarts only what is down):
#   vllm     Qwen3.8-27B NVFP4 as "cybus" on :8000, sleep mode on (the arbiter swaps it to host RAM)
#   comfy    ComfyUI worker on :8189 (the art jobs; the arbiter frees it after every art turn)
#   arbiter  :8100, the only port clients use
# Usage: bash start_servers.sh [vllm|comfy|arbiter|all]   (LANDLORD_LEASE_ID etc. come from the lease env file)
set -uo pipefail
[ -f /root/lease.env ] && set -a && . /root/lease.env && set +a
BF=/root/blocksfield
LOG=/root/setup_logs
up() { tmux has-session -t "=$1" 2>/dev/null; }

start_vllm() {
  up vllm && { echo "vllm already running"; return; }
  # flashinfer JIT-builds the sm_120 FP4 GEMM: the image's CUDA 12.8 nvcc cannot target it, the venv's pip
  # CUDA 13 toolkit can.
  local cu=/root/venvs/vllm/lib/python3.12/site-packages/nvidia/cu13
  # vLLM sizes itself against free VRAM at startup: make ComfyUI drop any cached models first.
  curl -s -X POST 127.0.0.1:8189/free -H 'Content-Type: application/json' \
    -d '{"unload_models": true, "free_memory": true}' >/dev/null 2>&1 && sleep 3
  tmux new-session -d -s vllm "CUDA_HOME=$cu PATH=$cu/bin:\$PATH VLLM_SERVER_DEV_MODE=1 /root/venvs/vllm/bin/vllm serve /root/models/qwen38-nvfp4 \
    --served-model-name cybus --host 127.0.0.1 --port 8000 \
    --enable-sleep-mode --gpu-memory-utilization ${BF_VLLM_UTIL:-0.88} \
    --max-model-len ${BF_MAX_LEN:-65536} --max-num-seqs ${BF_MAX_SEQS:-6} \
    --limit-mm-per-prompt '{\"image\": 8}' \
    --enable-auto-tool-choice --tool-call-parser qwen3_xml --reasoning-parser qwen3 \
    --speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":2}' \
    --linear-backend ${BF_LINEAR_BACKEND:-cutlass} ${BF_VLLM_EXTRA:-} > $LOG/vllm_serve.log 2>&1"
  echo "vllm starting (first start compiles: several minutes); log $LOG/vllm_serve.log"
}

start_comfy() {
  up comfy && { echo "comfy already running"; return; }
  tmux new-session -d -s comfy "cd /root/ComfyUI && .venv/bin/python main.py --listen 127.0.0.1 --port 8189 \
    --disable-auto-launch --output-directory $BF/out/comfy ${BF_COMFY_EXTRA:-} > $LOG/comfy_serve.log 2>&1"
  echo "comfy starting; log $LOG/comfy_serve.log"
}

start_arbiter() {
  up arbiter && { echo "arbiter already running"; return; }
  tmux new-session -d -s arbiter "cd $BF && /root/ComfyUI/.venv/bin/python -m uvicorn blocksfield.arbiter:app \
    --host 127.0.0.1 --port 8100 > $LOG/arbiter.log 2>&1"
  echo "arbiter starting on :8100; log $LOG/arbiter.log"
}

case "${1:-all}" in
  vllm) start_vllm ;;
  comfy) start_comfy ;;
  arbiter) start_arbiter ;;
  all) start_comfy; start_vllm; start_arbiter ;;
esac
