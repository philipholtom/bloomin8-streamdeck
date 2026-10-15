#!/bin/bash
# Builds the plugin's two Swift helpers into bin/:
#   FrameWaker.app — Bluetooth wake (an app bundle, so macOS asks for
#                    Bluetooth permission for it rather than for Stream Deck)
#   frameimage     — image resizing and clipboard reading, via ImageIO
# Codesigning FrameWaker's bundle seals its Info.plist; without that macOS
# won't trust its Bluetooth usage description and silently denies Bluetooth.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="com.pholtom.bloomin8frame.sdPlugin/bin"
APP="$BIN/FrameWaker.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp helpers/Info.plist "$APP/Contents/Info.plist"
xcrun swiftc -O -target arm64-apple-macos13 -o "$APP/Contents/MacOS/FrameWaker" helpers/FrameWaker.swift
codesign --force --sign - --identifier com.pholtom.bloomin8frame.waker "$APP"
if codesign -dv "$APP" 2>&1 | grep -q "Info.plist=not bound"; then
    echo "ERROR: FrameWaker's Info.plist is unsealed; Bluetooth would be denied." >&2
    exit 1
fi
echo "Built $APP"

xcrun swiftc -O -target arm64-apple-macos13 -o "$BIN/frameimage" helpers/frameimage.swift
codesign --force --sign - --identifier com.pholtom.bloomin8frame.frameimage "$BIN/frameimage"
echo "Built $BIN/frameimage"
