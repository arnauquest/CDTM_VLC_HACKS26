#!/bin/zsh
# Restores the staged demo state (see DEMO.md) and restarts the local server.
# Staged state = clean import of the 4 official families + simulated tuition news
# evaluated for all 4 + Samantha's client request prepared and awaiting advisor
# approval under MANUAL policy. Snapshot lives in var/ (git-ignored).
set -eu
repo="${0:A:h:h}"
cd "$repo"
source ../../activar-herramientas.zsh 2>/dev/null || true
test -f var/demo-staged.sqlite3 || { print 'Missing var/demo-staged.sqlite3 (see DEMO.md to rebuild it)'; exit 1; }
pkill -f 'backend/server.mjs' 2>/dev/null || true
sleep 1
rm -f var/demo.sqlite3 var/demo.sqlite3-wal var/demo.sqlite3-shm
cp var/demo-staged.sqlite3 var/demo.sqlite3
SQLITE_PATH=./var/demo.sqlite3 nohup npm start > var/demo-server.log 2>&1 &
sleep 3
curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null && print 'Demo restored: http://127.0.0.1:3000/app/?role=consultor#/alertas'
