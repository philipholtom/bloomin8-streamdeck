import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The photos the frame showed before the current one, newest first, for the
 * Previous action. Fed by every status check (so it also notices pictures
 * changed by other apps, at the poll's one-minute resolution) and saved to
 * disk so it survives restarts.
 */
const file = path.join(homedir(), "Library", "Application Support", "com.pholtom.bloomin8frame", "history.json");
const maxEntries = 30;

let stack: string[] = [];
let current: string | undefined;
/** Set while going back, so the photo being left isn't pushed again. */
let goingBackTo: string | undefined;
let loaded = false;

async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
        const saved = JSON.parse(await readFile(file, "utf8")) as { stack?: string[]; current?: string };
        stack = saved.stack ?? [];
        current = saved.current;
    } catch {
        // No history yet.
    }
}

async function save(): Promise<void> {
    try {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ stack, current }));
    } catch {
        // History is a convenience; never fail an action over it.
    }
}

/** Records what the frame is showing now. */
export async function noteShowing(imagePath: string | undefined): Promise<void> {
    await load();
    if (!imagePath || imagePath === current) return;
    if (current && goingBackTo !== imagePath) {
        stack = [current, ...stack.filter((p) => p !== current && p !== imagePath)].slice(0, maxEntries);
    } else {
        stack = stack.filter((p) => p !== imagePath);
    }
    goingBackTo = undefined;
    current = imagePath;
    await save();
}

/** The photos before the current one, newest first. */
export async function previousPhotos(): Promise<string[]> {
    await load();
    return stack.filter((p) => p !== current);
}

/**
 * Call before showing `stack[index]`: drops it and everything newer, and stops
 * the photo being left from being added, so repeated presses keep going back.
 */
export async function goBackTo(imagePath: string): Promise<void> {
    await load();
    const index = stack.indexOf(imagePath);
    if (index >= 0) stack = stack.slice(index + 1);
    goingBackTo = imagePath;
    await save();
}

/** Removes a photo that no longer exists (deleted, or failed to show). */
export async function forget(imagePath: string): Promise<void> {
    await load();
    stack = stack.filter((p) => p !== imagePath);
    if (current === imagePath) current = undefined;
    await save();
}
