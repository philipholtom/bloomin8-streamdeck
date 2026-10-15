import streamDeck from "@elgato/streamdeck";

/** Plugin-wide settings, shared by every key (set from any key's settings panel). */
export type GlobalSettings = {
    frameIP?: string;
    bleName?: string;
    orientation?: "portrait" | "landscape";
    /** Battery percentage to warn at, or "off". Default 20. */
    lowBattery?: string;
    /** "off" to skip the macOS notification when the battery gets low. */
    batteryNotify?: string;
};

/** The low-battery threshold, or undefined when the warning is off. */
export function lowBatteryThreshold(): number | undefined {
    const setting = current.lowBattery ?? "20";
    if (setting === "off") return undefined;
    const value = Number(setting);
    return Number.isFinite(value) && value > 0 ? value : 20;
}

let current: GlobalSettings = {};
const listeners = new Set<() => void>();

/** Calls `listener` whenever the global settings change (from any key's panel). */
export function onGlobalSettingsChanged(listener: () => void): void {
    listeners.add(listener);
}

export function globalSettings(): GlobalSettings {
    return current;
}

export async function loadGlobalSettings(): Promise<void> {
    current = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
    streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
        current = ev.settings;
        listeners.forEach((listener) => listener());
    });
}
