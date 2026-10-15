import streamDeck from "@elgato/streamdeck";

/** Plugin-wide settings, shared by every key (set from any key's settings panel). */
export type GlobalSettings = {
    frameIP?: string;
    bleName?: string;
    orientation?: "portrait" | "landscape";
};

let current: GlobalSettings = {};

export function globalSettings(): GlobalSettings {
    return current;
}

export async function loadGlobalSettings(): Promise<void> {
    current = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
    streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
        current = ev.settings;
    });
}
