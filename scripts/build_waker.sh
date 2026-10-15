#!/bin/bash
# Builds FrameWaker.app (the Bluetooth wake helper) into the plugin's bin/.
# Codesigning the finished bundle seals its Info.plist; without that macOS
# won't trust its Bluetooth usage description and silently denies Bluetooth.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="com.pholtom.bloomin8frame.sdPlugin/bin/FrameWaker.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp waker/Info.plist "$APP/Contents/Info.plist"
xcrun swiftc -O -target arm64-apple-macos13 -o "$APP/Contents/MacOS/FrameWaker" waker/FrameWaker.swift
codesign --force --sign - --identifier com.pholtom.bloomin8frame.waker "$APP"
if codesign -dv "$APP" 2>&1 | grep -q "Info.plist=not bound"; then
    echo "ERROR: FrameWaker's Info.plist is unsealed; Bluetooth would be denied." >&2
    exit 1
fi
echo "Built $APP"
