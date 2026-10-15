import { fetchImage } from "./frame";
import { keyThumbnail } from "./images";

/**
 * Key-sized thumbnails of photos on the frame, by frame path. Downloading a
 * photo from the frame takes a second or more, so they're kept (the most
 * recent couple of hundred, ~10 KB each).
 */
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const limit = 200;

export function cachedThumbnail(imagePath: string): string | undefined {
    return cache.get(imagePath);
}

export function thumbnail(ip: string, imagePath: string): Promise<string> {
    const hit = cache.get(imagePath);
    if (hit) return Promise.resolve(hit);
    let job = pending.get(imagePath);
    if (!job) {
        job = (async () => {
            const url = await keyThumbnail(await fetchImage(ip, imagePath));
            cache.set(imagePath, url);
            if (cache.size > limit) cache.delete(cache.keys().next().value!);
            return url;
        })().finally(() => pending.delete(imagePath));
        pending.set(imagePath, job);
    }
    return job;
}

export function forgetThumbnail(imagePath: string): void {
    cache.delete(imagePath);
}
