/**
 * Image work, done by the bundled `frameimage` helper (ImageIO), so the plugin
 * needs no native Node modules. It applies photos' rotation flags, reads HEIC,
 * and always writes the plain baseline sRGB JPEG the frame can decode.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** bin/frameimage, next to the bundled bin/plugin.js. */
const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), "frameimage");

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), "bloomin8-img-"));
    try {
        return await work(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export type Fit = "fill" | "fit";

/**
 * Renders any picture to exactly `width`x`height` JPEG: "fill" scales to
 * cover and crops the middle, "fit" scales to fit and pads with black.
 */
export async function renderForFrame(image: Buffer, width: number, height: number, fit: Fit): Promise<Buffer> {
    return withTempDir(async (dir) => {
        const input = path.join(dir, "in");
        await writeFile(input, image);
        return renderFileForFrame(input, width, height, fit, dir);
    });
}

/** As `renderForFrame`, for a picture already on disk (e.g. picked in Finder). */
export async function renderFileForFrame(file: string, width: number, height: number, fit: Fit, workDir?: string): Promise<Buffer> {
    const go = async (dir: string) => {
        const output = path.join(dir, "out.jpg");
        try {
            await run(helper, ["render", "--in", file, "--out", output, "--width", String(width), "--height", String(height), "--fit", fit], { timeout: 60000 });
        } catch {
            throw new Error("Couldn't read that picture");
        }
        return readFile(output);
    };
    return workDir ? go(workDir) : withTempDir(go);
}

/** A square key-sized JPEG (center-cropped), as a data URL for setImage. */
export async function keyThumbnail(image: Buffer, size = 144): Promise<string> {
    const jpeg = await renderForFrame(image, size, size, "fill");
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** The clipboard's image (or an image file copied in Finder), or undefined if there isn't one. */
export async function clipboardImage(): Promise<Buffer | undefined> {
    return withTempDir(async (dir) => {
        const output = path.join(dir, "clip");
        try {
            await run(helper, ["clipboard", "--out", output], { timeout: 15000 });
        } catch (error) {
            if ((error as { code?: number }).code === 2) return undefined;
            throw new Error("Couldn't read the clipboard");
        }
        return readFile(output);
    });
}

const imageExtensions = /\.(jpe?g|png|heic|heif|tiff?|gif|webp|bmp)$/i;

/**
 * The first image selected in Finder, or undefined. The first use asks you to
 * let Stream Deck control Finder (System Settings › Privacy › Automation).
 */
export async function finderSelectedImage(): Promise<string | undefined> {
    const script = [
        'set out to ""',
        'tell application "Finder" to set picked to selection as alias list',
        "repeat with f in picked",
        "set out to out & POSIX path of f & linefeed",
        "end repeat",
        "return out",
    ];
    try {
        const { stdout } = await run("/usr/bin/osascript", script.flatMap((line) => ["-e", line]), { timeout: 15000 });
        return stdout.split("\n").find((line) => imageExtensions.test(line.trim()))?.trim();
    } catch (error) {
        if (/-1743|Not authori[sz]ed/i.test(String(error))) throw new Error("Allow Stream Deck to control Finder");
        throw new Error("Couldn't read the Finder selection");
    }
}
