#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
APP="$ROOT/Sigil Pulse.app"
BIN="$APP/Contents/MacOS/SigilPulse"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -o "$BIN" "$ROOT/main.swift" -framework AppKit -framework WebKit
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :PulseRootPath string $REPO" "$APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :PulseRootPath $REPO" "$APP/Contents/Info.plist"
PY="$(command -v python3 || true)"
if [[ -n "${PY}" ]]; then
  /usr/libexec/PlistBuddy -c "Add :PulsePythonPath string $PY" "$APP/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :PulsePythonPath $PY" "$APP/Contents/Info.plist"
fi

ICON_SRC="$REPO/assets/sticker-sigil.png"
if [[ -f "$ICON_SRC" ]]; then
  ICONSET="$ROOT/SigilPulse.iconset"
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"
  sips -z 16 16     "$ICON_SRC" --out "$ICONSET/icon_16x16.png" >/dev/null
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET/icon_32x32.png" >/dev/null
  sips -z 64 64     "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
  sips -z 128 128   "$ICON_SRC" --out "$ICONSET/icon_128x128.png" >/dev/null
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET/icon_256x256.png" >/dev/null
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/SigilPulse.icns"
  rm -rf "$ICONSET"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string SigilPulse' "$APP/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile SigilPulse' "$APP/Contents/Info.plist"
fi

xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" >/dev/null

echo "Built $APP"
