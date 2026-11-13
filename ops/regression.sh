#!/bin/bash
# Regression run for the CoreBuild deck builder. Run after any change or image update:
#   ops/regression.sh
# Uses real documents kept (not in git) in ../regression/: a technical proposal deck and a BOQ.
# Expected values live in ../regression/expected.json, e.g.
#   {"deck": "ahmed_source.pptx", "source_slides": 37, "timeline_activities": 11,
#    "boq": "boq.xlsx", "net": 7005785.5, "vat": 1050867.83, "gross": 8056653.33}
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
REG="$HERE/regression"
C=${CONTAINER:-deck-builder}
[ -f "$REG/expected.json" ] || { echo "missing $REG/expected.json"; exit 2; }
docker exec "$C" rm -rf /tmp/reg && docker cp "$REG" "$C":/tmp/reg >/dev/null || exit 2

echo "== smoke tests"
docker exec -w /app -e MAKE_PDF=false -e API_KEY= -e OUTPUT_DIR=/tmp/reg-smoke "$C" node test/smoke.js 2>&1 | grep -v javaldx | tail -3
smoke=${PIPESTATUS[0]}

echo "== real documents"
docker exec -w /app "$C" node -e '
const fs = require("fs"), E = require("/tmp/reg/expected.json");
const H = process.env.API_KEY ? { Authorization: "Bearer " + process.env.API_KEY } : {};
const bad = [];
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad.push(m); };
(async () => {
  let fd = new FormData(); fd.append("file", new Blob([fs.readFileSync("/tmp/reg/" + E.deck)]), E.deck);
  let r = await fetch("http://localhost:8000/import", { method: "POST", body: fd, headers: H }); let j = await r.json();
  ok(r.ok, "import " + E.deck + (j.error ? ": " + j.error : ""));
  if (r.ok) {
    ok(j.source_slides === E.source_slides, `source slides ${j.source_slides} = ${E.source_slides}`);
    ok(!j.check.missing_numbers.length, "no missing numbers " + JSON.stringify(j.check.missing_numbers));
    ok(!j.check.new_numbers.length, "no invented numbers " + JSON.stringify(j.check.new_numbers));
    ok(!j.check.slides.some((s) => s.missing.length), "no missing lines");
    ok(!j.check.timeline.length, "schedule unchanged");
    ok(!(j.warnings || []).length, "no fit warnings " + JSON.stringify(j.warnings || []).slice(0, 300));
    ok(!(j.kept_as_picture || []).length, "every slide converted (none kept as picture)");
  }
  fd = new FormData(); fd.append("file", new Blob([fs.readFileSync("/tmp/reg/" + E.boq)]), E.boq); fd.append("options", JSON.stringify({ project: "regression" }));
  r = await fetch("http://localhost:8000/financial", { method: "POST", body: fd, headers: H }); j = await r.json();
  ok(r.ok, "financial " + E.boq + (j.error ? ": " + j.error : ""));
  if (r.ok) for (const k of ["net", "vat", "gross"]) ok(j.summary[k] === E[k], `${k} ${j.summary[k]} = ${E[k]}`);
  process.exit(bad.length ? 1 : 0);
})();'
docs=$?
[ $smoke -eq 0 ] && [ $docs -eq 0 ] && { echo "ALL PASSED"; exit 0; }
echo "REGRESSION FAILED"; exit 1
