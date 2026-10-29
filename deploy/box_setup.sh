#!/usr/bin/env bash
# One-shot setup of the rented 5090 box: ComfyUI venv, vLLM venv, every model.
# Run inside tmux: bash box_setup.sh <part>   part = comfy | vllm | models | all
set -uo pipefail
export HF_HUB_ENABLE_HF_TRANSFER=0 HF_XET_HIGH_PERFORMANCE=1
ROOT=/root
COMFY=$ROOT/ComfyUI
LOG=$ROOT/setup_logs
mkdir -p "$LOG" "$ROOT/models" "$ROOT/blocksfield/out"
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh)
export PATH="$HOME/.local/bin:$PATH"
# Clone first and synchronously: the model downloads write into $COMFY/models.
[ -d "$COMFY/.git" ] || git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "$COMFY"

setup_comfy() {
  cd "$COMFY"
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
  uv pip install --python .venv/bin/python -r requirements.txt
  uv pip install --python .venv/bin/python trimesh pygltflib requests websocket-client
  .venv/bin/python -c "import torch;print('comfy torch', torch.__version__, torch.cuda.is_available())"
}

setup_vllm() {
  uv venv --python 3.12 $ROOT/venvs/vllm
  uv pip install --python $ROOT/venvs/vllm/bin/python "vllm==0.32.0"
  $ROOT/venvs/vllm/bin/python -c "import vllm;print('vllm', vllm.__version__)"
}

dl() {  # dl <repo> <local_dir> <file...>
  local repo=$1 dir=$2; shift 2
  uvx --from "huggingface_hub[hf_xet]" hf download "$repo" "$@" --local-dir "$dir"
}

setup_models() {
  local M=$COMFY/models
  mkdir -p "$M"
  dl RedHatAI/Qwen3.8-27B-NVFP4 $ROOT/models/qwen38-nvfp4 &> $LOG/dl_llm.log &
  dl Comfy-Org/Qwen-Image-2.1 $M \
    diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors \
    diffusion_models/qwen_image_2.1_int8_convrot.safetensors \
    text_encoders/qwen3vl_8b_int8_convrot.safetensors \
    text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors \
    vae/qwen_image_2.1_vae_bf16.safetensors &> $LOG/dl_qwenimage.log &
  dl Comfy-Org/BiRefNet $M background_removal/birefnet.safetensors &> $LOG/dl_birefnet.log &
  dl Comfy-Org/TRELLIS.2 $M \
    clip_vision/dino_v3_vit_l.safetensors diffusion_models/trellis_2_bf16.safetensors \
    vae/trellis_2_shape_vae_bf16.safetensors vae/trellis_2_texture_vae_bf16.safetensors &> $LOG/dl_trellis.log &
  dl Lightricks/LTX-2.5 $M \
    diffusion_models/ltx-2.5-22b-distilled-transformer-nvfp4.safetensors \
    text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors \
    vae/ltx-2.5-video-vae-bf16.safetensors vae/ltx-2.5-audio-vae-bf16.safetensors \
    latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors &> $LOG/dl_ltx.log &
  dl Comfy-Org/ACE-Step-1.5 $M checkpoints/ace_step_1.5_turbo_aio.safetensors &> $LOG/dl_ace.log &
  dl Comfy-Org/stable-audio-3 $M \
    checkpoints/stable_audio_3_small_sfx.safetensors text_encoders/t5gemma_b_b_ul2.safetensors &> $LOG/dl_sfx.log &
  wait
  echo "models done"; du -sh $COMFY/models/* $ROOT/models/* 2>/dev/null
}

case "${1:-all}" in
  comfy) setup_comfy ;;
  vllm) setup_vllm ;;
  models) setup_models ;;
  all) setup_models & setup_comfy & setup_vllm & wait ;;
esac
echo "DONE $1"
