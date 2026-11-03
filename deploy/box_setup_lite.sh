#!/usr/bin/env bash
# Faster setup for a fresh 5090 box: the models the game pipeline uses (no TRELLIS.2 / LTX-2.5), Idol + its node.
# Run inside tmux after push.sh:  HF_TOKEN=... bash deploy/box_setup_lite.sh
set -uo pipefail
ROOT=/root
LOG=$ROOT/setup_logs
mkdir -p "$LOG"
BF=$ROOT/blocksfield
source $BF/deploy/box_setup.sh none      # its env, uv, the ComfyUI clone and the setup_comfy / setup_vllm / dl functions

models_lite() {
  local M=$COMFY/models
  dl RedHatAI/Qwen3.8-27B-NVFP4 $ROOT/models/qwen38-nvfp4 &> $LOG/dl_llm.log &
  dl Comfy-Org/Qwen-Image-2.1 $M \
    diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors \
    diffusion_models/qwen_image_2.1_int8_convrot.safetensors \
    text_encoders/qwen3vl_8b_int8_convrot.safetensors \
    text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors \
    vae/qwen_image_2.1_vae_bf16.safetensors &> $LOG/dl_qwenimage.log &
  dl Comfy-Org/BiRefNet $M background_removal/birefnet.safetensors &> $LOG/dl_birefnet.log &
  dl Comfy-Org/ACE-Step-1.5 $M checkpoints/ace_step_1.5_turbo_aio.safetensors &> $LOG/dl_ace.log &
  dl Comfy-Org/stable-audio-3 $M \
    checkpoints/stable_audio_3_small_sfx.safetensors text_encoders/t5gemma_b_b_ul2.safetensors &> $LOG/dl_sfx.log &
  wait
  echo "models done"; du -sh $M/* $ROOT/models/* 2>/dev/null
}

idol() {
  # after setup_comfy: the SDK into ComfyUI's venv (torch pinned), the node linked in, weights pre-fetched
  for _ in $(seq 120); do [ -x $COMFY/.venv/bin/python ] && $COMFY/.venv/bin/python -c "import torch" 2>/dev/null && break; sleep 10; done
  cd $ROOT && { [ -d idol-sdk/.git ] || GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://github.com/speridlabs/idol-sdk.git; }
  local sdk=$ROOT/idol-sdk
  local tv; tv=$($COMFY/.venv/bin/python -c "import torch;print(torch.__version__.split('+')[0])")
  uv pip install --python $COMFY/.venv/bin/python -e "$sdk" "torch==$tv"
  ln -sfn $BF/comfy_nodes/idol $COMFY/custom_nodes/idol
  $COMFY/.venv/bin/python -c "
from huggingface_hub import snapshot_download as s
for r in ['speridlabs/idol', 'facebook/dinov3-vith16plus-pretrain-lvd1689m']:
    print(r, s(r))
s('black-forest-labs/FLUX.2-dev', allow_patterns=['vae/*', '*.json'])
print('idol weights ok')"
}

models_lite & setup_comfy &> $LOG/setup_comfy.log & setup_vllm &> $LOG/setup_vllm.log &
wait
idol &> $LOG/idol.log
echo "DONE lite"
