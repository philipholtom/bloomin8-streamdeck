import {
    action,
    type DialAction,
    type DialDownEvent,
    type DidReceiveSettingsEvent,
    type KeyAction,
    type KeyDownEvent,
    type SendToPluginEvent,
    SingletonAction,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { isBusy, runWithFeedback } from "../feedback";
import { deviceInfo, ensureGallery, fetchImage, splitImagePath, upload } from "../frame";
import { addToListing, cachedListing, imagesIn } from "../galleries";
import { heartFace } from "../keyface";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus, watchStatus } from "../status";
import { ensureAwake } from "../wake";
import { sendGalleryList } from "./random-photo";

type Settings = {
    /** The gallery favourites are copied into; empty means "Favourites". */
    gallery?: string;
};

const defaultGallery = "Favourites";

/**
 * Copies the photo that's on the frame into a favourites gallery, so a good
 * random pick is easy to find again. The original stays where it is and the
 * screen doesn't redraw. The key shows a filled heart while the photo on the
 * frame is already a favourite.
 */
@action({ UUID: "com.pholtom.bloomin8frame.favourite" })
export class FavouriteAction extends SingletonAction<Settings> {
    private unsubscribers = new Map<string, () => void>();
    private galleryOf = new Map<string, string>();
    /** Favourites galleries we've asked the frame to list, so each is only fetched once in a while. */
    private listing = new Set<string>();

    override onWillAppear(ev: WillAppearEvent<Settings>): void {
        const target = ev.action;
        this.galleryOf.set(target.id, ev.payload.settings.gallery?.trim() || defaultGallery);
        this.unsubscribers.set(
            target.id,
            watchStatus(() => {
                if (!isBusy(target.id)) void this.draw(target);
            }),
        );
    }

    override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
        this.unsubscribers.get(ev.action.id)?.();
        this.unsubscribers.delete(ev.action.id);
        this.galleryOf.delete(ev.action.id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
        this.galleryOf.set(ev.action.id, ev.payload.settings.gallery?.trim() || defaultGallery);
        if (!isBusy(ev.action.id)) await this.draw(ev.action);
    }

    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
        await this.favourite(ev.action);
    }

    override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
        await this.favourite(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
        await this.favourite(ev.action);
    }

    /**
     * Whether the photo on the frame is already in the favourites gallery, from
     * what's cached; undefined if we don't know yet. A copy keeps the original's
     * filename, so a matching name means it's there.
     */
    private isFavourite(gallery: string): boolean | undefined {
        const showing = splitImagePath(currentStatus().image ?? "");
        if (!showing) return undefined;
        if (showing.gallery === gallery) return true;
        return cachedListing(gallery)?.includes(showing.filename);
    }

    private async favourite(target: KeyAction<Settings> | DialAction<Settings>): Promise<void> {
        const gallery = this.galleryOf.get(target.id) ?? defaultGallery;
        let already = false;
        await runWithFeedback(
            target,
            async (progress) => {
                const { frameIP = "", bleName = "" } = globalSettings();
                if (!frameIP.trim()) throw new Error("Set the frame's IP address in the plugin settings.");
                await progress("Connecting…");
                await ensureAwake(frameIP, bleName);

                // Ask the frame what's showing right now, rather than trusting the last poll.
                const imagePath = (await deviceInfo(frameIP)).image;
                const showing = imagePath ? splitImagePath(imagePath) : undefined;
                if (!imagePath || !showing) throw new Error("Nothing to favourite");
                void refreshStatus();

                await progress("Checking…");
                const existing = await imagesIn(frameIP, gallery).catch(() => [] as string[]);
                if (showing.gallery === gallery || existing.includes(showing.filename)) {
                    already = true;
                    return;
                }

                await progress("Saving…");
                const photo = await fetchImage(frameIP, imagePath);
                await ensureGallery(frameIP, gallery);
                await upload(frameIP, gallery, showing.filename, photo, false);
                addToListing(gallery, showing.filename);
            },
            async () => {
                await this.draw(target, already ? "Already saved" : undefined);
                if (already) setTimeout(() => void (isBusy(target.id) ? undefined : this.draw(target)), 3000);
            },
        );
    }

    private async draw(target: KeyAction<Settings> | DialAction<Settings>, note?: string): Promise<void> {
        const gallery = this.galleryOf.get(target.id) ?? defaultGallery;
        const favourite = this.isFavourite(gallery);
        if (favourite === undefined) this.learn(target, gallery);

        if (target.isDial()) {
            await target.setFeedback({
                photo: currentStatus().thumbnail ?? "imgs/actions/favourite/icon.svg",
                label: gallery,
                value: favourite ? { value: "♥ Saved", color: "#ff6b8a" } : { value: "Not saved", color: "#ffffff" },
                status: note ?? (favourite ? "It's a favourite" : "Push to save"),
            });
        } else {
            await target.setImage(heartFace(!!favourite, note));
        }
    }

    /** Lists the favourites gallery (while the frame is awake) so the heart can be filled in. */
    private learn(target: KeyAction<Settings> | DialAction<Settings>, gallery: string): void {
        const ip = globalSettings().frameIP ?? "";
        if (!ip.trim() || currentStatus().asleep || !currentStatus().image || this.listing.has(gallery)) return;
        this.listing.add(gallery);
        imagesIn(ip, gallery)
            .catch(() => [])
            .then(() => (isBusy(target.id) ? undefined : this.draw(target)))
            .finally(() => setTimeout(() => this.listing.delete(gallery), 15 * 60_000));
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
        await sendGalleryList(ev);
    }
}
