#!/usr/bin/env bash
set -euo pipefail

echo "=== Seminar installer ==="
echo

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "Error: Python 3 is required but not found."
    echo "Install it from https://python.org or via your package manager."
    exit 1
fi

py_version=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
py_major=$(echo "$py_version" | cut -d. -f1)
py_minor=$(echo "$py_version" | cut -d. -f2)
if [ "$py_major" -lt 3 ] || { [ "$py_major" -eq 3 ] && [ "$py_minor" -lt 10 ]; }; then
    echo "Error: Python 3.10+ is required (found $py_version)."
    exit 1
fi
echo "Python $py_version ✓"

# Check/install uv
if ! command -v uv &>/dev/null; then
    echo "uv not found. Installing..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
echo "uv $(uv --version | awk '{print $2}') ✓"

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "Error: Node.js 18+ is required but not found."
    echo "Install it from https://nodejs.org or via your package manager."
    exit 1
fi

node_major=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$node_major" -lt 18 ]; then
    echo "Error: Node.js 18+ is required (found $(node -v))."
    exit 1
fi
echo "Node.js $(node -v) ✓"

# Check npm
if ! command -v npm &>/dev/null; then
    echo "Error: npm is required but not found."
    exit 1
fi
echo "npm $(npm -v) ✓"

echo
echo "=== Building frontend ==="
cd "$(dirname "$0")/src/seminar/server/frontend"
npm install --silent
npm run build
cd ../../../..

echo
echo "=== Installing seminar ==="
uv tool install -e .

echo
echo "=== Initialising ==="
seminar init

echo
echo "=== Done ==="
echo "Run 'seminar' to launch the server and open the dashboard."
