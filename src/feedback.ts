import streamDeck, { type DialAction, type KeyAction } from "@elgato/streamdeck";

import { messageFace } from "./keyface";

/**
 * Runs a key or dial's job with on-device feedback: a progress message while
 * it works, then a confirmation, or a short error left up for a few seconds
 * (the plain ⚠ alone doesn't say what went wrong). Ignores presses while busy.
 *
 * Keys show messages as their image. Dials show them in the layout's
 * `status` item. Afterwards `restore` redraws the usual face (keys without
 * one go back to their manifest image).
 */
const busy = new Set<string>();

export function isBusy(id: string): boolean {
    return busy.has(id);
}

export async function runWithFeedback(
    action: KeyAction | DialAction,
    work: (progress: (message: string) => Promise<void>) => Promise<void>,
    restore?: () => Promise<void>,
): Promise<void> {
    if (busy.has(action.id)) return;
    busy.add(action.id);
    const dial = action.isDial() ? action : undefined;
    const progress = (message: string) => (dial ? dial.setFeedback({ status: message }) : action.setImage(messageFace(message)));
    // Keys go back to their manifest image unless they draw their own face.
    const reset = async () => {
        if (restore) await restore();
        else if (!dial) await action.setImage();
    };
    try {
        await work(progress);
        if (dial) {
            await dial.setFeedback({ status: "Done ✓" });
            setTimeout(() => void reset(), 3000);
        } else {
            await reset();
            if (action.isKey()) await action.showOk();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        streamDeck.logger.error(`${action.manifestId}: ${message}`);
        const reason = shortReason(message);
        if (dial) await dial.setFeedback({ status: reason });
        else await action.setImage(messageFace(reason, "error"));
        await action.showAlert();
        setTimeout(() => void reset(), 6000);
    } finally {
        busy.delete(action.id);
    }
}

/** Boils an error down to something that fits on a key or a dial's strip. */
export function shortReason(message: string): string {
    if (/IP address|Set frame IP/i.test(message)) return "Set frame IP";
    if (/Bluetooth name/i.test(message)) return "Set Bluetooth name";
    if (/permission denied/i.test(message)) return "Allow Bluetooth";
    if (/Bluetooth is off/i.test(message)) return "Bluetooth is off";
    if (/Couldn't find '/i.test(message)) return "Frame not found";
    if (/didn't come back/i.test(message)) return "Frame didn't wake";
    if (/busy/i.test(message)) return "Frame busy";
    if (/video/i.test(message)) return "Today is a video";
    if (/No history/i.test(message)) return "No history yet";
    if (/No image|nothing to send/i.test(message)) return "No image to send";
    if (/control Finder/i.test(message)) return "Allow Finder access";
    if (/read that picture/i.test(message)) return "Can't read image";
    if (/timeout|aborted|fetch failed|ECONN|EHOST|not answering/i.test(message)) return "Frame not answering";
    return "Failed";
}
