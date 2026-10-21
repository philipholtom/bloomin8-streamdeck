/**
 * Places to fetch a fresh picture from the web for the frame. Each returns the
 * original image bytes; resizing for the frame happens afterwards.
 */

import { globalSettings } from "./settings";

export type Picture = { image: Buffer; title: string };

export type Source = {
    id: string;
    name: string;
    /** A short name that fits a dial's touch strip. */
    short: string;
    /** The frame gallery uploads go into unless the key's settings say otherwise. */
    defaultGallery: string;
    /** How to fit the picture when the key's Fit setting is "Automatic". Default "fill". */
    preferredFit?: "fill" | "fit";
    fetch: () => Promise<Picture>;
};

const userAgent = "BLOOMIN8-StreamDeck-Plugin/1.0 (personal use)";

async function getJSON<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
}

async function getImage(url: string): Promise<Buffer> {
    const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Couldn't download the picture (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
}

function randomInt(below: number): number {
    return Math.floor(Math.random() * below);
}

// NASA Astronomy Picture of the Day, via science.nasa.gov's JSON endpoint
// (the old api.nasa.gov one now returns the NASA logo for every date).

type APOD = { title?: string; media_type?: string; hdurl?: string };

/** APOD days roll over in US Eastern time; codes are YYMMDD. */
function apodDateCode(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}${part("month")}${part("day")}`;
}

function usableAPOD(apod: APOD): apod is APOD & { hdurl: string } {
    return apod.media_type === "image" && !!apod.hdurl && !apod.hdurl.includes("nasa-logo");
}

async function fetchAPOD(date: Date): Promise<APOD> {
    return getJSON<APOD>(`https://science.nasa.gov/wp-json/wp/v2/apod-basic/${apodDateCode(date)}`);
}

async function apodToday(): Promise<Picture> {
    const apod = await fetchAPOD(new Date());
    if (!usableAPOD(apod)) throw new Error("Today's NASA picture is a video, not a photo");
    return { image: await getImage(apod.hdurl), title: apod.title ?? "NASA Picture of the Day" };
}

async function apodRandom(): Promise<Picture> {
    const start = Date.UTC(1995, 5, 16);
    let lastError: unknown = new Error("Couldn't find a NASA picture");
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const apod = await fetchAPOD(new Date(start + Math.random() * (Date.now() - start)));
            if (usableAPOD(apod)) return { image: await getImage(apod.hdurl), title: apod.title ?? "NASA Picture of the Day" };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

// The Met's public-domain collection. /v1.1/search pages by offset and
// can't go past 10,000 results, so pick a random page inside that.

async function metArt(): Promise<Picture> {
    const query = ["painting", "landscape", "portrait", "still life", "watercolor"][randomInt(5)];
    const search = async (offset: number) =>
        getJSON<{ total?: number; objectIDs?: number[] }>(
            `https://collectionapi.metmuseum.org/public/collection/v1.1/search?${new URLSearchParams({
                hasImages: "true",
                isPublicDomain: "true",
                q: query,
                limit: "50",
                offset: String(offset),
            })}`,
        );
    const first = await search(randomInt(9950));
    let ids = first.objectIDs ?? [];
    if (ids.length === 0 && first.total) ids = (await search(randomInt(Math.max(1, Math.min(first.total, 10000) - 50)))).objectIDs ?? [];
    if (ids.length === 0) throw new Error(`No Met Museum results for "${query}"`);

    for (const id of ids.sort(() => Math.random() - 0.5).slice(0, 6)) {
        try {
            const object = await getJSON<{ title: string; artistDisplayName: string; primaryImage: string; isPublicDomain: boolean }>(
                `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
            );
            if (!object.isPublicDomain || !object.primaryImage) continue;
            const title = object.artistDisplayName ? `${object.title} — ${object.artistDisplayName}` : object.title;
            return { image: await getImage(object.primaryImage), title };
        } catch {
            // Try the next one.
        }
    }
    throw new Error("Couldn't find a public-domain Met picture");
}

// Wikipedia's Picture of the Day, from a random day since 2016.

async function wikipediaPOTD(): Promise<Picture> {
    const start = Date.UTC(2016, 0, 1);
    for (let attempt = 0; attempt < 4; attempt++) {
        const day = new Date(start + Math.random() * (Date.now() - 86400000 - start));
        const date = `${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${String(day.getUTCDate()).padStart(2, "0")}`;
        const featured = await getJSON<{ image?: { title: string; image: { source: string } } }>(
            `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${date}`,
        );
        if (!featured.image) continue;
        const title = featured.image.title.replace(/^File:/, "").replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
        return { image: await getImage(featured.image.image.source), title };
    }
    throw new Error("Couldn't find a Wikipedia picture");
}

async function cat(): Promise<Picture> {
    const [first] = await getJSON<{ url: string }[]>("https://api.thecatapi.com/v1/images/search");
    if (!first) throw new Error("No cat in the response");
    return { image: await getImage(first.url), title: "Cat" };
}

async function dog(): Promise<Picture> {
    const { message } = await getJSON<{ message: string }>("https://dog.ceo/api/breeds/image/random");
    return { image: await getImage(message), title: "Dog" };
}

// Movie posters from The Movie Database (themoviedb.org). Needs the user's own
// free key, set in the plugin settings. Posters are 2:3 and the frame 3:4, so
// these default to showing the whole poster with black bars.
// This product uses the TMDB API but is not endorsed or certified by TMDB.

type TMDBMovie = { id: number; title?: string; poster_path?: string | null; release_date?: string };
type TMDBList = { results: TMDBMovie[]; total_pages?: number };

/** `BLOOMIN8_TMDB_BASE` points the plugin at a stand-in server, for tests only. */
const tmdbBase = process.env.BLOOMIN8_TMDB_BASE ?? "https://api.themoviedb.org";
const tmdbImageBase = process.env.BLOOMIN8_TMDB_IMAGE_BASE ?? "https://image.tmdb.org";

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const key = (globalSettings().tmdbKey ?? process.env.TMDB_API_KEY ?? "").trim();
    if (!key) throw new Error("Add your free TMDB key in the plugin settings");
    const query = new URLSearchParams(params);
    // A v3 key goes in the URL; the longer v4 "read access token" is a bearer token.
    const bearer = key.length > 60;
    if (!bearer) query.set("api_key", key);
    const response = await fetch(`${tmdbBase}${path}?${query}`, {
        headers: { "User-Agent": userAgent, ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
        signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401) throw new Error("TMDB rejected the key — check it in the plugin settings");
    if (!response.ok) throw new Error(`TMDB returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
}

function withPoster(list: TMDBList): TMDBMovie[] {
    return list.results.filter((movie) => !!movie.poster_path);
}

async function moviePoster(movie: TMDBMovie): Promise<Picture> {
    const year = movie.release_date?.slice(0, 4);
    const title = movie.title ? (year ? `${movie.title} (${year})` : movie.title) : "Movie poster";
    return { image: await getImage(`${tmdbImageBase}/t/p/original${movie.poster_path}`), title };
}

/** A random film from a TMDB list, from one of its first few pages. */
async function movieFromDiscover(sort: string, minVotes: string, maxPages: number): Promise<Picture> {
    const params = { include_adult: "false", sort_by: sort, "vote_count.gte": minVotes };
    const first = await tmdb<TMDBList>("/3/discover/movie", { ...params, page: "1" });
    const page = 1 + randomInt(Math.max(1, Math.min(first.total_pages ?? 1, maxPages)));
    const list = page === 1 ? first : await tmdb<TMDBList>("/3/discover/movie", { ...params, page: String(page) });
    const candidates = withPoster(list);
    if (candidates.length === 0) throw new Error("No films with a poster came back");
    return moviePoster(candidates[randomInt(candidates.length)]);
}

const moviePopular = () => movieFromDiscover("popularity.desc", "300", 25);
const movieTopRated = () => movieFromDiscover("vote_average.desc", "2000", 12);

async function movieNowPlaying(): Promise<Picture> {
    const region = Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1] ?? "US";
    const first = await tmdb<TMDBList>("/3/movie/now_playing", { region, page: "1" });
    const page = 1 + randomInt(Math.max(1, Math.min(first.total_pages ?? 1, 5)));
    const list = page === 1 ? first : await tmdb<TMDBList>("/3/movie/now_playing", { region, page: String(page) });
    const candidates = withPoster(list);
    if (candidates.length === 0) throw new Error("No films with a poster came back");
    return moviePoster(candidates[randomInt(candidates.length)]);
}

/** A film released on today's month and day in a random earlier year. */
async function movieReleasedToday(): Promise<Picture> {
    const now = new Date();
    const monthDay = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const years = Array.from({ length: now.getFullYear() - 1950 }, (_, i) => 1950 + i).sort(() => Math.random() - 0.5).slice(0, 25);
    for (const year of years) {
        const date = `${year}-${monthDay}`;
        const list = await tmdb<TMDBList>("/3/discover/movie", {
            include_adult: "false",
            sort_by: "popularity.desc",
            "vote_count.gte": "50",
            "primary_release_date.gte": date,
            "primary_release_date.lte": date,
        });
        const [found] = withPoster(list);
        if (found) return moviePoster(found);
    }
    throw new Error("Couldn't find a film released on this date");
}

export const sources: Source[] = [
    { id: "apod-today", short: "NASA today", name: "NASA: today's picture", defaultGallery: "NASA", fetch: apodToday },
    { id: "apod-random", short: "NASA random", name: "NASA: random picture", defaultGallery: "NASA", fetch: apodRandom },
    { id: "met", short: "Met art", name: "Met Museum art", defaultGallery: "Museum", fetch: metArt },
    { id: "wikipedia", short: "Wikipedia", name: "Wikipedia Picture of the Day", defaultGallery: "Wikipedia", fetch: wikipediaPOTD },
    { id: "cat", short: "Cat", name: "Random cat", defaultGallery: "Cat Photos", fetch: cat },
    { id: "dog", short: "Dog", name: "Random dog", defaultGallery: "Dog Photos", fetch: dog },
    { id: "movie-popular", short: "Movie: popular", name: "Movie poster: popular", defaultGallery: "Movie Posters", preferredFit: "fit", fetch: moviePopular },
    { id: "movie-top", short: "Movie: top", name: "Movie poster: top rated", defaultGallery: "Movie Posters", preferredFit: "fit", fetch: movieTopRated },
    { id: "movie-now", short: "Movie: now", name: "Movie poster: in cinemas now", defaultGallery: "Movie Posters", preferredFit: "fit", fetch: movieNowPlaying },
    { id: "movie-today", short: "Movie: today", name: "Movie poster: released today", defaultGallery: "Movie Posters", preferredFit: "fit", fetch: movieReleasedToday },
];

export function source(id: string | undefined): Source {
    return sources.find((s) => s.id === id) ?? sources[0];
}
