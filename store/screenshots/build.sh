#!/bin/bash
# Regenerates the Chrome Web Store screenshots and promo tiles into store/images.
# Needs Node.js and Google Chrome; installs pdf-lib and puppeteer-core locally.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
WORK="$(mktemp -d)"
[ -d node_modules ] || npm install --no-save --silent pdf-lib puppeteer-core
mkdir -p "$WORK/www"
ln -s "$ROOT/extension" "$WORK/www/ext"
cp slide.html shim.js "$WORK/www/"
node sample.mjs "$WORK/www/sample-a4.pdf"
# printer list: real data from the installed helper, renamed for the screenshots
HELPER="$HOME/Library/Application Support/IntelligentLabelPrinting/ilp-host"
[ -x "$HELPER" ] || HELPER="/Library/Application Support/IntelligentLabelPrinting/ilp-host"
"$HELPER" printers > "$WORK/printers-real.json"
python3 - "$WORK/printers-real.json" "$WORK/www/printers.js" <<'PY'
import json, sys
keep = {'Brother_QL_1110NWB': 'Brother_QL_1110NWB', 'Brother_DCP_9015CDW': 'Brother_DCP_9015CDW', 'Printer_ITPP130': 'Zebra_ZD421'}
out = []
for p in json.load(open(sys.argv[1])):
    if p['name'] not in keep: continue
    p['name'] = keep[p['name']]
    for m in p['media']:
        if m.get('custom'): m['name'] = 'Courier labels' if m['h'] > m['w'] else 'Courier labels large'
    out.append(p)
open(sys.argv[2], 'w').write('window.PRINTERS = ' + json.dumps(out) + ';')
PY
for f in popup options print; do
  sed -e 's#<head>#<head><base href="/ext/"><script src="/printers.js"></script><script src="/shim.js"></script>#' "$ROOT/extension/$f.html" > "$WORK/www/$f.html"
done
node shoot.mjs "$WORK/www" "$ROOT/store/images"
rm -rf "$WORK"
