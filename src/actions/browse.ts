import {
    action,
    type DialAction,
    type DialDownEvent,
    type DialRotateEvent,
    type DidReceiveSettingsEvent,
    type SendToPluginEvent,
    SingletonAction,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { isBusy, runWithFeedback } from "../feedback";
import { show, splitImagePath } from "../frame";
import { forgetListing, imagesIn, knownGalleries, listGalleries } from "../galleries";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus } from "../status";
import { cachedThumbnail, thumbnail } from "../thumbnails";
import { ensureAwake } from "../wake";
import { sendGalleryList } from "./random-photo";

type Settings = {
    /** The gallery to browse; empty means whichever one the frame is showing. */
    gallery?: string;
};

type Browsing = { gallery: string; names?: string[]; index: number };

/**
 * A dial for flicking through a gallery: turn to step through its photos with
 * a thumbnail on the strip, push or tap to show the one picked. Holding the
 * strip moves on to the next gallery. Starts on whatever the frame is showing.
 */
@action({ UUID: "com.pholtom.bloomin8frame.browse" })
export class BrowseAction extends SingletonAction<Settings> {
    private state = new Map<string, Browsing>();
    private thumbTimers = new Map<string, NodeJS.Timeout>();

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        if (!ev.action.isDial()) return;
        this.state.set(ev.action.id, { gallery: this.startingGallery(ev.payload.settings), index: 0 });
        await this.draw(ev.action);
    }

    override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
        this.state.delete(ev.action.id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
        if (!ev.action.isDial() || isBusy(ev.action.id)) return;
        const gallery = this.startingGallery(ev.payload.settings);
        if (gallery !== this.state.get(ev.action.id)?.gallery) {
            this.state.set(ev.action.id, { gallery, index: 0 });
            await this.draw(ev.action);
        }
    }

    override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
        const dial = ev.action;
        if (isBusy(dial.id)) return;
        const browsing = await this.loaded(dial, false);
        if (!browsing?.names?.length) return;
        const count = browsing.names.length;
        browsing.index = (((browsing.index + ev.payload.ticks) % count) + count) % count;
        await this.draw(dial);
    }

    override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
        await this.showPicked(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
        if (ev.payload.hold) await this.nextGallery(ev.action, ev.payload.settings);
        else await this.showPicked(ev.action);
    }

    private startingGallery(settings: Settings): string {
        return settings.gallery?.trim() || currentStatus().gallery || "";
    }

    /**
     * The dial's gallery with its photo list, loading the list if needed. With
     * `wake`, wakes the frame first; without, gives up quietly if it's asleep.
     */
    private async loaded(dial: DialAction<Settings>, wake: boolean): Promise<Browsing | undefined> {
        const browsing = this.state.get(dial.id) ?? { gallery: "", index: 0 };
        this.state.set(dial.id, browsing);
        if (browsing.names) return browsing;

        const { frameIP = "", bleName = "" } = globalSettings();
        if (!frameIP.trim()) {
            if (wake) throw new Error("Set the frame's IP address in the plugin settings.");
            await dial.setFeedback({ status: "Set frame IP" });
            return undefined;
        }
        try {
            if (wake) await ensureAwake(frameIP, bleName);
            if (wake || !currentStatus().asleep) await refreshStatus();
            if (!browsing.gallery) browsing.gallery = currentStatus().gallery ?? (await listGalleries(frameIP))[0] ?? "";
            if (!browsing.gallery) throw new Error("Couldn't find any photos on the frame");
            await dial.setFeedback({ status: "Listing photos…" });
            browsing.names = await imagesIn(frameIP, browsing.gallery);
        } catch (error) {
            if (wake) throw error;
            await dial.setFeedback({ status: "Frame asleep: push" });
            return undefined;
        }
        // Start on the photo that's showing, if it's in this gallery.
        const showing = splitImagePath(currentStatus().image ?? "");
        browsing.index = showing?.gallery === browsing.gallery ? Math.max(0, browsing.names.indexOf(showing.filename)) : 0;
        return browsing;
    }

    private async showPicked(dial: DialAction<Settings>): Promise<void> {
        const hadList = !!this.state.get(dial.id)?.names;
        await runWithFeedback(
            dial,
            async (progress) => {
                await progress("Connecting…");
                const browsing = await this.loaded(dial, true);
                // The first push on a sleeping frame just loads the gallery to browse.
                if (!hadList || !browsing?.names?.length) return;
                const filename = browsing.names[browsing.index];
                await progress("Showing…");
                try {
                    await show(globalSettings().frameIP ?? "", `/gallerys/${browsing.gallery}/${filename}`);
                } catch (error) {
                    forgetListing(browsing.gallery);
                    browsing.names = undefined;
                    throw error;
                }
                void refreshStatus();
            },
            () => this.draw(dial),
        );
    }

    private async nextGallery(dial: DialAction<Settings>, settings: Settings): Promise<void> {
        if (isBusy(dial.id)) return;
        let galleries = knownGalleries();
        if (galleries.length === 0) {
            try {
                galleries = await listGalleries(globalSettings().frameIP ?? "");
            } catch {
                await dial.setFeedback({ status: "Frame asleep: push" });
                return;
            }
        }
        const current = this.state.get(dial.id)?.gallery ?? "";
        const next = galleries[(galleries.indexOf(current) + 1) % galleries.length] ?? "";
        this.state.set(dial.id, { gallery: next, index: 0 });
        await dial.setSettings({ ...settings, gallery: next });
        await this.draw(dial);
        await this.loaded(dial, false);
        await this.draw(dial);
    }

    private async draw(dial: DialAction<Settings>): Promise<void> {
        const browsing = this.state.get(dial.id);
        const gallery = browsing?.gallery || "Browse";
        const names = browsing?.names;
        if (!names) {
            await dial.setFeedback({ photo: "imgs/actions/browse/icon.svg", label: gallery, value: "—", status: "Turn to browse" });
            return;
        }
        if (names.length === 0) {
            await dial.setFeedback({ photo: "imgs/actions/browse/icon.svg", label: gallery, value: "Empty", status: "Hold for next gallery" });
            return;
        }
        const imagePath = `/gallerys/${browsing.gallery}/${names[browsing.index]}`;
        const thumb = cachedThumbnail(imagePath);
        await dial.setFeedback({
            photo: thumb ?? "imgs/actions/browse/icon.svg",
            label: gallery,
            value: `${browsing.index + 1} / ${names.length}`,
            status: imagePath === currentStatus().image ? "On the frame" : "Push to show",
        });
        if (!thumb) this.loadThumbnail(dial, imagePath);
    }

    /** Fetches the thumbnail once the dial stops turning, then redraws. */
    private loadThumbnail(dial: DialAction<Settings>, imagePath: string): void {
        clearTimeout(this.thumbTimers.get(dial.id));
        this.thumbTimers.set(
            dial.id,
            setTimeout(() => {
                thumbnail(globalSettings().frameIP ?? "", imagePath)
                    .then(() => (isBusy(dial.id) ? undefined : this.draw(dial)))
                    .catch(() => undefined);
            }, 350),
        );
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
        await sendGalleryList(ev);
    }
}
