#!/bin/bash
# Listando Agent - stündlicher Durchlauf
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
node agent.js >> logs/agent.log 2>&1
