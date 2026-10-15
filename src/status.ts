import streamDeck from "@elgato/streamdeck";

import { deviceInfo, fetchImage } from "./frame";
import { keyThumbnail } from "./images";
import { globalSettings } from "./settings";

/**
 * What the frame is showing, shared by every Frame Status key (and nudged by
 * the other actions after they change the picture). One poll serves all keys.
 */
export type FrameStatus = {
    asleep: boolean;
    image?: string;
    gallery?: string;
    battery?: number;
    thumbnail?: string;
    checkedAt?: number;
};

let status: FrameStatus = { asleep: true };
const listeners = new Set<(status: FrameStatus) => void>();
let timer: NodeJS.Timeout | undefined;
let inFlight: Promise<void> | undefined;

const pollInterval = 60_000;

export function currentStatus(): FrameStatus {
    return status;
}

/** Re-reads the frame now. Concurrent calls share one request. */
export function refreshStatus(): Promise<void> {
    inFlight ??= poll().finally(() => (inFlight = undefined));
    return inFlight;
}

async function poll(): Promise<void> {
    const ip = globalSettings().frameIP ?? "";
    if (!ip.trim()) return;
    try {
        const info = await deviceInfo(ip);
        const next: FrameStatus = { ...status, asleep: false, image: info.image, gallery: info.gallery, battery: info.battery, checkedAt: Date.now() };
        if (info.image && info.image !== status.image) {
            try {
                next.thumbnail = await keyThumbnail(await fetchImage(ip, info.image));
            } catch (error) {
                streamDeck.logger.warn(`Couldn't make a thumbnail of ${info.image}: ${error}`);
                next.thumbnail = undefined;
            }
        }
        status = next;
    } catch {
        // Asleep (or unreachable): keep showing the last known picture.
        status = { ...status, asleep: true, checkedAt: Date.now() };
    }
    listeners.forEach((listener) => listener(status));
}

/** Subscribes a visible status key; polling runs only while one is visible. */
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
