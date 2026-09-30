#!/bin/sh
# Generates the Core ML models the app bundles into src-tauri/resources/models.
# Needs macOS with Xcode (for coremlcompiler) and Python 3.13.
set -eu
cd "$(dirname "$0")/.."

VENV=.venv-models
if [ ! -x "$VENV/bin/python" ]; then
  python3.13 -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r scripts/requirements.txt
"$VENV/bin/python" scripts/convert_models.py
