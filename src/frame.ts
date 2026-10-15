/**
 * A minimal client for the BLOOMIN8 frame's local HTTP API (no auth, LAN only).
 *
 * The frame's embedded server is slow and only answers while its Wi-Fi radio
 * is awake, so every call has a timeout and callers treat "no answer" as
 * "asleep" rather than as a hard error.
 */

export type DeviceInfo = {
    name?: string;
    image?: string;
    gallery?: string;
    battery?: number;
    width?: number;
    height?: number;
};

export class FrameError extends Error {}

function base(ip: string): string {
    const trimmed = ip.trim();
    if (!trimmed) throw new FrameError("Set the frame's IP address in the plugin settings.");
    return `http://${trimmed}`;
}

/** Encodes each segment of a frame path (gallery names can contain spaces). */
function encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}

async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const { timeoutMs = 8000, ...rest } = init;
    const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new FrameError(`Frame returned HTTP ${response.status}`);
    return response;
}

export async function deviceInfo(ip: string, timeoutMs = 6000): Promise<DeviceInfo> {
    return (await request(`${base(ip)}/deviceInfo`, { timeoutMs })).json() as Promise<DeviceInfo>;
}

/** True if the frame answers at all within `timeoutMs`. */
export async function isAwake(ip: string, timeoutMs = 4000): Promise<boolean> {
    try {
        await deviceInfo(ip, timeoutMs);
        return true;
    } catch {
        return false;
    }
}

export async function galleries(ip: string): Promise<string[]> {
    const entries = (await (await request(`${base(ip)}/gallery/list`, { timeoutMs: 15000 })).json()) as { name: string }[];
    return entries.map((entry) => entry.name);
}

/**
 * Every image name in a gallery. The frame pages its listing 51 at a time; the
 * `cursor_next` from one page goes back in as `cursor` for the next. Later
 * pages are slower (several seconds each on a big gallery), hence the long
 * per-page timeout.
 */
export async function galleryImages(ip: string, gallery: string): Promise<string[]> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
        const query = new URLSearchParams({ gallery_name: gallery, offset: "0", limit: "51", full: "1" });
        if (cursor) query.set("cursor", cursor);
        const listing = (await (await request(`${base(ip)}/gallery?${query}`, { timeoutMs: 45000 })).json()) as {
            data: { name: string }[];
            cursor_next?: string;
            more?: boolean;
        };
        const fresh = listing.data.map((image) => image.name).filter((name) => !seen.has(name));
        if (fresh.length === 0) break;
        fresh.forEach((name) => seen.add(name));
        if (!listing.more || !listing.cursor_next || listing.cursor_next === cursor) break;
        cursor = listing.cursor_next;
    }
    return [...seen];
}

/**
 * Shows an image already on the frame (`/gallerys/<gallery>/<file>`). While
 * it's still drawing the previous picture the frame refuses, either with HTTP
 * 500 or with `{"status":"fail","msg":"DRAWING"}`, so this retries a few times.
 */
export async function show(ip: string, imagePath: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await sleep(4000);
        try {
            const response = await fetch(`${base(ip)}/show`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ play_type: 0, image: imagePath }),
                signal: AbortSignal.timeout(10000),
            });
            const body = (await response.json().catch(() => ({}))) as { status?: string; msg?: string };
            if (body.status === "fail") throw new FrameError(`Frame is busy (${body.msg ?? "unknown"})`);
            if (!response.ok) throw new FrameError(`Frame returned HTTP ${response.status}`);
            return;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

export async function fetchImage(ip: string, imagePath: string): Promise<Buffer> {
    const response = await request(`${base(ip)}${encodePath(imagePath)}`, { timeoutMs: 45000 });
    return Buffer.from(await response.arrayBuffer());
}

/** Creates a gallery if it isn't there already; failure (it exists) is fine. */
export async function ensureGallery(ip: string, name: string): Promise<void> {
    try {
        await fetch(`${base(ip)}/gallery?${new URLSearchParams({ name })}`, { method: "PUT", signal: AbortSignal.timeout(8000) });
    } catch {
        // Best effort.
    }
}

/**
 * Uploads a JPEG into a gallery and shows it straight away. The firmware
 * needs the filename to end `_P.jpg` (portrait) or `_L.jpg` (landscape, which
 * it rotates when drawing). Uploads of ~1 MB take tens of seconds.
 */
export async function upload(ip: string, gallery: string, filename: string, jpeg: Buffer): Promise<string> {
    const query = new URLSearchParams({ filename, gallery, show_now: "1" });
    const boundary = `Boundary-${crypto.randomUUID()}`;
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        jpeg,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await request(`${base(ip)}/upload?${query}`, {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body,
        timeoutMs: 120000,
    });
    const result = (await response.json().catch(() => ({}))) as { path?: string };
    return result.path ?? `/gallerys/${gallery}/${filename}`;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
