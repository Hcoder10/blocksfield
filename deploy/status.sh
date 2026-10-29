#!/usr/bin/env bash
# Cheap box status: what is installed, what has landed, what is still downloading.
cd /root
echo "load $(cut -d' ' -f1-3 /proc/loadavg)   disk $(df -h / | awk 'NR==2{print $3"/"$2}')"
[ -x /root/venvs/vllm/bin/vllm ] && echo "vllm: installed" || echo "vllm: installing"
[ -f /root/ComfyUI/.venv/lib/python3.12/site-packages/torch/version.py ] && \
  echo "comfy torch: $(grep -m1 '__version__' /root/ComfyUI/.venv/lib/python3.12/site-packages/torch/version.py)" || echo "comfy torch: installing"
echo "landed:"
find /root/ComfyUI/models /root/models -name '*.safetensors' -size +1M -printf '  %s %p\n' 2>/dev/null | \
  awk '{printf "  %6.1f GB  %s\n", $1/1e9, $2}' | sed 's#/root/ComfyUI/models/##; s#/root/models/##'
echo "staging (in flight): $(find /root/ComfyUI/models/.cache /root/models -path '*download*' -name '*.incomplete' 2>/dev/null | wc -l) files"
for f in /root/setup_logs/dl_*.log; do
  last=$(tail -c 300 "$f" | tr '\r' '\n' | grep -v '^$' | tail -1 | cut -c1-80)
  echo "  $(basename "$f" .log): $last"
done
