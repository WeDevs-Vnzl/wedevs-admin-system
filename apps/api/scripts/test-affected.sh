#!/usr/bin/env bash
# Runs the specs of one Vitest project (int or e2e) affected by the diff against TEST_BASE (default main):
# the import graph of the changed files, or every spec when a forceRerunTriggers path changed (DT-117).
# Usage: scripts/test-affected.sh <int|e2e> [extra vitest args]
set -euo pipefail

cd "$(dirname "$0")/.."

project="${1:?usage: test-affected.sh <int|e2e>}"
shift
base="${TEST_BASE:-main}"

# vitest --changed exits 0 without running anything when the ref does not exist.
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "test-affected: unknown base ref '$base' (set TEST_BASE)" >&2
  exit 1
fi

exec node_modules/.bin/vitest run --project "$project" --changed "$base" --pass-with-no-tests "$@"
