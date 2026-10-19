import { galleries, galleryImages } from "./frame";

/**
 * The frame's gallery names and each gallery's photo list, kept for a while:
 * the frame takes several seconds to list a big gallery.
 */
let known: string[] = [];
const listings = new Map<string, { names: string[]; at: number }>();
const listingTTL = 15 * 60_000;

export function knownGalleries(): string[] {
    return known;
}

export async function listGalleries(ip: string): Promise<string[]> {
    known = (await galleries(ip)).sort((a, b) => a.localeCompare(b));
    return known;
}

export async function imagesIn(ip: string, gallery: string): Promise<string[]> {
    const cached = listings.get(gallery);
    if (cached && Date.now() - cached.at < listingTTL) return cached.names;
    const names = await galleryImages(ip, gallery);
    listings.set(gallery, { names, at: Date.now() });
    return names;
}

/** Drops a gallery's cached listing (after a delete, or a show that failed). */
export function forgetListing(gallery: string): void {
    listings.delete(gallery);
}

/** The cached listing for a gallery, if there is a fresh one (no frame request). */
export function cachedListing(gallery: string): string[] | undefined {
    const cached = listings.get(gallery);
    return cached && Date.now() - cached.at < listingTTL ? cached.names : undefined;
}

/** Notes a photo just uploaded into a gallery, so its cached listing stays right. */
export function addToListing(gallery: string, filename: string): void {
    const cached = listings.get(gallery);
    if (cached && !cached.names.includes(filename)) cached.names.push(filename);
    if (!known.includes(gallery)) known = [...known, gallery].sort((a, b) => a.localeCompare(b));
}
