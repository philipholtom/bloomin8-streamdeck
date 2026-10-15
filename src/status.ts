import streamDeck from "@elgato/streamdeck";
import { execFile } from "node:child_process";

import { deviceInfo } from "./frame";
import { noteShowing } from "./history";
import { globalSettings, lowBatteryThreshold } from "./settings";
import { thumbnail } from "./thumbnails";

/**
 * What the frame is showing, shared by every key and dial that displays it
 * (and nudged by the other actions after they change the picture). One poll
 * serves them all, and also feeds the Previous history.
 */
export type FrameStatus = {
    asleep: boolean;
    image?: string;
    gallery?: string;
    battery?: number;
    /** True when the battery is at or under the warning threshold. */
    lowBattery?: boolean;
    thumbnail?: string;
    checkedAt?: number;
};

let status: FrameStatus = { asleep: true };
const listeners = new Set<(status: FrameStatus) => void>();
let timer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;
/** Whether we've already warned about this drop below the threshold. */
let warnedLow = false;

const pollInterval = 60_000;

export function currentStatus(): FrameStatus {
    return status;
}

/** Re-reads the frame now. Concurrent calls share one request. */
export function refreshStatus(): Promise<void> {
    inFlight ??= poll().finally(() => (inFlight = undefined));
    return inFlight;
}

/** Redraws every listener (e.g. after the warning threshold changed). */
export function redrawStatus(): void {
    status = { ...status, lowBattery: isLow(status.battery) };
    listeners.forEach((listener) => listener(status));
}

function isLow(battery: number | undefined): boolean {
    const threshold = lowBatteryThreshold();
    return battery !== undefined && threshold !== undefined && battery <= threshold;
}

async function poll(): Promise<void> {
    const ip = globalSettings().frameIP ?? "";
    if (!ip.trim()) return;
    try {
        const info = await deviceInfo(ip);
        const next: FrameStatus = {
            ...status,
            asleep: false,
            image: info.image,
            gallery: info.gallery,
            battery: info.battery,
            lowBattery: isLow(info.battery),
            checkedAt: Date.now(),
        };
        if (info.image && info.image !== status.image) {
            try {
                next.thumbnail = await thumbnail(ip, info.image);
            } catch (error) {
                streamDeck.logger.warn(`Couldn't make a thumbnail of ${info.image}: ${error}`);
                next.thumbnail = undefined;
            }
        }
        status = next;
        await noteShowing(info.image);
        warnAboutBattery(info.battery);
    } catch {
        // Asleep (or unreachable): keep showing the last known picture.
        status = { ...status, asleep: true, checkedAt: Date.now() };
    }
    listeners.forEach((listener) => listener(status));
}

/**
 * Posts one macOS notification each time the battery drops to the threshold;
 * re-arms once it's charged a bit above it.
 */
function warnAboutBattery(battery: number | undefined): void {
    const threshold = lowBatteryThreshold();
    if (battery === undefined || threshold === undefined) return;
    if (battery > threshold + 5) warnedLow = false;
    if (battery > threshold || warnedLow) return;
    warnedLow = true;
    if (globalSettings().batteryNotify === "off") return;
    const name = "BLOOMIN8 Frame";
    execFile("/usr/bin/osascript", ["-e", `display notification "The frame's battery is at ${battery}%. Time to charge it." with title "${name}"`], () => undefined);
}

/** Subscribes a visible key or dial; polling runs only while one is visible. */
export function watchStatus(listener: (status: FrameStatus) => void): () => void {
    listeners.add(listener);
    listener(status);
    if (!timer) {
        timer = setInterval(() => void refreshStatus(), pollInterval);
        void refreshStatus();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
            clearInterval(timer);
            timer = undefined;
        }
    };
}
