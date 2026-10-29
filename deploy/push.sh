#!/usr/bin/env bash
# Laptop -> box: copy the working tree (not .git, not outputs) to /root/blocksfield.
# BOX="-p <port> root@<host>" overrides the default rental.
set -euo pipefail
BOX=${BOX:-"-p 16278 root@ssh9.vast.ai"}
cd "$(dirname "$0")/.."
tar --exclude=.git --exclude=out --exclude=runs --exclude=__pycache__ -cf - . | \
  ssh -o StrictHostKeyChecking=no $BOX 'mkdir -p /root/blocksfield && tar -xf - -C /root/blocksfield && echo pushed' \
  2>&1 | grep -v "^Welcome\|Have fun"
