/**
 * Image resizing with macOS's built-in `sips`, so the plugin needs no native
 * Node modules.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function sips(args: string[]): Promise<string> {
    return (await run("/usr/bin/sips", args, { timeout: 60000 })).stdout;
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), "bloomin8-img-"));
    try {
        return await work(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

async function dimensions(file: string): Promise<{ width: number; height: number }> {
    const out = await sips(["-g", "pixelWidth", "-g", "pixelHeight", file]);
    const width = Number(/pixelWidth: (\d+)/.exec(out)?.[1]);
    const height = Number(/pixelHeight: (\d+)/.exec(out)?.[1]);
    if (!width || !height) throw new Error("Couldn't read that picture");
    return { width, height };
}

export type Fit = "fill" | "fit";

/**
 * Renders any picture to exactly `width`x`height` JPEG: "fill" scales to
 * cover and crops the middle, "fit" scales to fit and pads with black.
 */
export async function renderForFrame(image: Buffer, width: number, height: number, fit: Fit): Promise<Buffer> {
    return withTempDir(async (dir) => {
        const input = path.join(dir, "in");
        const sized = path.join(dir, "sized.png");
        const output = path.join(dir, "out.jpg");
        await writeFile(input, image);
        const source = await dimensions(input);
        const scale = fit === "fill" ? Math.max(width / source.width, height / source.height) : Math.min(width / source.width, height / source.height);
        const scaledW = Math.max(1, Math.round(source.width * scale));
        const scaledH = Math.max(1, Math.round(source.height * scale));
        const sizing =
            fit === "fill"
                ? ["--cropToHeightWidth", String(height), String(width)]
                : ["--padToHeightWidth", String(height), String(width), "--padColor", "000000"];
        // Size it into a PNG first, converted to sRGB. Going straight
        // JPEG-to-JPEG, sips keeps the source's encoding: a progressive (or
        // greyscale/CMYK) web image stays that way, and the frame's decoder
        // can't read it ("Image parsing failed"). From the PNG, sips always
        // writes a plain baseline RGB JPEG with no carried-over metadata.
        await sips([
            "-s", "format", "png",
            "--matchTo", "/System/Library/ColorSync/Profiles/sRGB Profile.icc",
            "--resampleHeightWidth", String(scaledH), String(scaledW),
            ...sizing,
            input, "--out", sized,
        ]);
        await sips(["-s", "format", "jpeg", "-s", "formatOptions", "88", sized, "--out", output]);
        return readFile(output);
    });
}

/** A square key-sized JPEG (center-cropped), as a data URL for setImage. */
export async function keyThumbnail(image: Buffer, size = 144): Promise<string> {
    const jpeg = await renderForFrame(image, size, size, "fill");
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
