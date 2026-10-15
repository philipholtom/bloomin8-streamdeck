import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isAwake, sleep } from "./frame";

/** bin/FrameWaker.app, next to the bundled bin/plugin.js. */
const wakerApp = path.join(path.dirname(fileURLToPath(import.meta.url)), "FrameWaker.app");

/**
 * Sends the Bluetooth wake pulse via FrameWaker.app. It's launched with
 * `open` rather than run directly so macOS treats it as its own app for
 * Bluetooth permission. Throws with FrameWaker's reason if the pulse failed.
 */
export async function sendWakePulse(bleName: string): Promise<void> {
    if (!bleName.trim()) throw new Error("Set the frame's Bluetooth name in the plugin settings.");
    const dir = await mkdtemp(path.join(tmpdir(), "bloomin8-wake-"));
    const out = path.join(dir, "result.json");
    try {
        await new Promise<void>((resolve) => {
            // -W waits for it to quit, -n starts a fresh copy, -g keeps it in the background.
            execFile("open", ["-W", "-n", "-g", wakerApp, "--args", "--name", bleName.trim(), "--out", out], { timeout: 45000 }, () => resolve());
        });
        const result = JSON.parse(await readFile(out, "utf8").catch(() => '{"ok":false,"error":"FrameWaker didn\'t report back"}')) as {
            ok: boolean;
            error?: string;
        };
        if (!result.ok) throw new Error(result.error ?? "Wake failed");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * Makes sure the frame is answering: returns at once if it is, otherwise
 * sends a wake pulse and waits (up to ~40s) for its Wi-Fi to come back.
 */
export async function ensureAwake(ip: string, bleName: string): Promise<void> {
    if (await isAwake(ip)) return;
    await sendWakePulse(bleName);
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
        if (await isAwake(ip, 3000)) return;
        await sleep(2000);
    }
    throw new Error("Sent the wake pulse, but the frame's Wi-Fi didn't come back");
}
