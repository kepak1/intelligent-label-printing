#!/bin/bash
# Builds the helper installers and the Chrome Web Store package into ../dist.
#   dist/LabelPrintingHelper-macOS.pkg          macOS installer (Intel + Apple Silicon)
#   dist/LabelPrintingHelper-Windows-x64.exe    Windows helper – double-click installs it
#   dist/LabelPrintingHelper-Windows-arm64.exe
#   dist/LabelPrintingHelper-Linux-x64          Linux helper – run "install"
#   dist/ilp-host-macos                         plain macOS binary (developer install)
#   dist/extension-webstore.zip                 extension for the Chrome Web Store
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIST="$ROOT/dist"
VERSION=$(grep -E '^\s*Version\s*=' main.go | sed -E 's/.*"(.*)".*/\1/')
export CGO_ENABLED=0
LDFLAGS="-s -w"
mkdir -p "$DIST"
echo "Building helper $VERSION"

# macOS universal binary
GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "$LDFLAGS" -o "$DIST/.ilp-arm64" .
GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS" -o "$DIST/.ilp-amd64" .
lipo -create -output "$DIST/ilp-host-macos" "$DIST/.ilp-arm64" "$DIST/.ilp-amd64"
rm "$DIST/.ilp-arm64" "$DIST/.ilp-amd64"
codesign --force --sign - "$DIST/ilp-host-macos" 2>/dev/null || true # ad-hoc signature

# macOS installer package
PKGROOT=$(mktemp -d)
mkdir -p "$PKGROOT.component"
mkdir -p "$PKGROOT/Library/Application Support/IntelligentLabelPrinting"
cp "$DIST/ilp-host-macos" "$PKGROOT/Library/Application Support/IntelligentLabelPrinting/ilp-host"
pkgbuild --quiet --root "$PKGROOT" --scripts packaging/macos/scripts \
  --identifier com.intelligentlabelprinting.helper --version "$VERSION" \
  --install-location / "$PKGROOT.component/LabelPrintingHelper.pkg"
productbuild --quiet --package "$PKGROOT.component/LabelPrintingHelper.pkg" "$DIST/LabelPrintingHelper-macOS.pkg"
rm -rf "$PKGROOT" "$PKGROOT.component"

# Windows and Linux
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS" -o "$DIST/LabelPrintingHelper-Windows-x64.exe" .
GOOS=windows GOARCH=arm64 go build -trimpath -ldflags "$LDFLAGS" -o "$DIST/LabelPrintingHelper-Windows-arm64.exe" .
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS" -o "$DIST/LabelPrintingHelper-Linux-x64" .

# Chrome Web Store package: the store does not accept the "key" field; to keep the
# extension ID on the FIRST upload, the private key is included as key.pem.
STAGE=$(mktemp -d)
cp -R "$ROOT/extension/." "$STAGE/"
python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p)); m.pop("key", None)
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
PY
rm -f "$DIST/extension-webstore.zip"
(cd "$STAGE" && zip -qr -X "$DIST/extension-webstore.zip" . -x '.*')
if [ -f "$ROOT/keys/extension-key.pem" ]; then
  cp "$ROOT/keys/extension-key.pem" "$STAGE/key.pem"
  rm -f "$DIST/extension-webstore-first-upload.zip"
  (cd "$STAGE" && zip -qr -X "$DIST/extension-webstore-first-upload.zip" . -x '.*')
fi
rm -rf "$STAGE"

ls -lh "$DIST"
