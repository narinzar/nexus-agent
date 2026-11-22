#!/bin/bash
# FAQ page acceptance: page exists and exports a default component, copy exists in all three dictionaries,
# the header navigation links to it, and the TypeScript project still type-checks.
set -e
page='frontend/src/app/[locale]/[variant]/faq/page.tsx'
test -f "$page" || { echo "FAIL: $page missing"; exit 1; }
grep -q "export default" "$page" || { echo "FAIL: no default export"; exit 1; }
for l in en ar ckb; do grep -qi "faq" "frontend/src/lib/i18n/$l.ts" || { echo "FAIL: no faq copy in $l.ts"; exit 1; }; done
grep -rqs '"/faq"' frontend/src/components/layout frontend/src/lib/config || { echo "FAIL: header navigation does not link /faq"; exit 1; }
cd frontend && npm run typecheck >/dev/null 2>&1 || { echo "FAIL: typecheck"; exit 1; }
echo "accept ok"
