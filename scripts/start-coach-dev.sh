#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../holdem-coach"
PORT="${PORT:-3001}" npm start
