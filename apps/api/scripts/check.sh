#!/usr/bin/env bash
# Runs format, build and unit tests; writes a failure report to test-output/result.md.
# Exits non-zero when any step fails. Every step runs even if a previous one failed.
set -uo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="test-output"
REPORT="$OUT_DIR/result.md"
VITEST_JSON="$OUT_DIR/vitest.json"
mkdir -p "$OUT_DIR"
rm -f "$VITEST_JSON"

failed=0
summary=""
details=""

run_step() {
  local name="$1"
  shift
  local log="$OUT_DIR/$name.log"
  echo "▶ $name"
  if "$@" >"$log" 2>&1; then
    summary+="| $name | ✅ pass |"$'\n'
  else
    failed=1
    summary+="| $name | ❌ fail |"$'\n'
    details+="## $name"$'\n\n'"$("format_$name" "$log")"$'\n\n'
  fi
}

# Prettier prints "[error] <file>: <message>" for files it cannot format.
format_format() {
  echo '```'
  rg '^\[error\]' "$1" || tail -n 40 "$1"
  echo '```'
}

# tsc/nest prints "<file>:<line>:<col> - error TSxxxx: <message>".
format_build() {
  echo '```'
  rg 'error TS|ERROR' "$1" || tail -n 40 "$1"
  echo '```'
}

# Read the vitest JSON report: one line per failing test, plus suites that failed to load.
format_test() {
  if [[ ! -s "$VITEST_JSON" ]]; then
    echo '```'
    tail -n 40 "$1"
    echo '```'
    return
  fi
  jq -r --arg root "$PWD/" '
    .testResults[] | select(.status == "failed") |
    (.name | sub("^" + $root; "")) as $file |
    ( [ .assertionResults[] | select(.status == "failed") ] ) as $tests |
    if ($tests | length) == 0 then
      "- **\($file)** (suite failed to run)\n  ```\n  \(.message | split("\n")[0:8] | join("\n  "))\n  ```"
    else
      $tests[] |
      "- **\($file)** › \(.fullName)\n  ```\n  \((.failureMessages[0] // "") | split("\n")[0:8] | join("\n  "))\n  ```"
    end
  ' "$VITEST_JSON"
}

run_step format bunx prettier --write . --log-level warn
run_step build bun run build
run_step test bunx vitest run --project unit \
  --reporter=default --reporter=json --outputFile.json="$VITEST_JSON"

{
  echo "# BE check — $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "Branch: \`$(git rev-parse --abbrev-ref HEAD 2>/dev/null)\` @ \`$(git rev-parse --short HEAD 2>/dev/null)\`"
  echo
  echo "| Step | Result |"
  echo "| --- | --- |"
  printf '%s' "$summary"
  echo
  if [[ $failed -eq 0 ]]; then
    echo "All steps passed."
  else
    printf '%s' "$details"
    echo "Full logs: \`$OUT_DIR/<step>.log\`"
  fi
} >"$REPORT"

echo "Report: $REPORT"
exit $failed
