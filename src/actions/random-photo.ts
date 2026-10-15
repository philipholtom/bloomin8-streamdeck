import streamDeck, {
    action,
    type DialAction,
    type DialDownEvent,
    type DialRotateEvent,
    type DidReceiveSettingsEvent,
    type KeyAction,
    type KeyDownEvent,
    type SendToPluginEvent,
    SingletonAction,
    type TouchTapEvent,
    type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { debouncer, step } from "../dial";
import { isBusy, runWithFeedback } from "../feedback";
import { show } from "../frame";
import { forgetListing, imagesIn, knownGalleries, listGalleries } from "../galleries";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus } from "../status";
import { ensureAwake } from "../wake";

type Settings = {
    /** One gallery, or empty for any gallery. */
    gallery?: string;
};

/**
 * Shows a random photo that's already on the frame. With no gallery chosen,
 * every gallery gets equal odds (then a random photo inside it), which avoids
 * listing every gallery — a big one takes the frame many seconds to list.
 *
 * On a dial: turn to choose the gallery, push or tap to show a photo.
 */
@action({ UUID: "com.pholtom.bloomin8frame.random" })
export class RandomPhotoAction extends SingletonAction<Settings> {
    private saveLater = debouncer();
    /** A dial's gallery while it's being turned (saved once it stops). */
    private turning = new Map<string, string>();

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        if (ev.action.isDial()) await this.drawDial(ev.action, ev.payload.settings.gallery ?? "");
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
        if (ev.action.isDial() && !isBusy(ev.action.id) && !this.turning.has(ev.action.id)) {
            await this.drawDial(ev.action, ev.payload.settings.gallery ?? "");
        }
    }

    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
        await this.showRandom(ev.action, ev.payload.settings.gallery);
    }

    override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
        await this.showFromDial(ev.action, ev.payload.settings.gallery);
    }

    override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
        await this.showFromDial(ev.action, ev.payload.settings.gallery);
    }

    override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
        const dial = ev.action;
        if (isBusy(dial.id)) return;
        if (knownGalleries().length === 0) {
            await dial.setFeedback({ status: "Listing galleries…" });
            try {
                await listGalleries(globalSettings().frameIP ?? "");
            } catch {
                await dial.setFeedback({ status: "Frame asleep: push" });
                return;
            }
        }
        const current = this.turning.get(dial.id) ?? ev.payload.settings.gallery ?? "";
        const next = step(["", ...knownGalleries()], current, ev.payload.ticks);
        this.turning.set(dial.id, next);
        await this.drawDial(dial, next);
        this.saveLater(dial.id, () => {
            this.turning.delete(dial.id);
            void dial.setSettings({ ...ev.payload.settings, gallery: next });
        });
    }

    private async showFromDial(dial: DialAction<Settings>, saved: string | undefined): Promise<void> {
        const gallery = this.turning.get(dial.id) ?? saved ?? "";
        await this.showRandom(dial, gallery, () => this.drawDial(dial, gallery));
    }

    private drawDial(dial: DialAction<Settings>, gallery: string): Promise<void> {
        return dial.setFeedback({
            icon: "imgs/actions/random/icon.svg",
            label: "Random photo",
            value: gallery || "Any gallery",
            status: "Push to show",
        });
    }

    private async showRandom(target: KeyAction<Settings> | DialAction<Settings>, wanted: string | undefined, restore?: () => Promise<void>): Promise<void> {
        await runWithFeedback(
            target,
            async (progress) => {
                const { frameIP = "", bleName = "" } = globalSettings();
                if (!frameIP.trim()) throw new Error("Set the frame's IP address in the plugin settings.");
                await progress("Connecting…");
                await ensureAwake(frameIP, bleName);

                await progress("Choosing…");
                const only = wanted?.trim();
                const pool = only ? [only] : await listGalleries(frameIP);
                const current = currentStatus().image;

                // Try a few galleries in case one turns out to be empty.
                for (const gallery of [...pool].sort(() => Math.random() - 0.5).slice(0, 4)) {
                    const names = await imagesIn(frameIP, gallery);
                    const choices = names.filter((name) => `/gallerys/${gallery}/${name}` !== current);
                    if (choices.length === 0) continue;
                    const pick = choices[Math.floor(Math.random() * choices.length)];
                    await progress("Showing…");
                    try {
                        await show(frameIP, `/gallerys/${gallery}/${pick}`);
                    } catch (error) {
                        forgetListing(gallery); // maybe the listing was stale
                        throw error;
                    }
                    void refreshStatus();
                    return;
                }
                throw new Error(only ? `"${only}" has no other photos` : "Couldn't find any photos on the frame");
            },
            restore,
        );
    }

    /** The settings panel asks for the frame's galleries to fill its menu. */
    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
        await sendGalleryList(ev);
    }
}

/** Replies to a settings panel's `getGalleries` request with the frame's galleries. */
export async function sendGalleryList(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    const payload = ev.payload as { event?: string } | null;
    if (payload?.event !== "getGalleries") return;
    try {
        await streamDeck.ui.sendToPropertyInspector({ event: "galleries", items: await listGalleries(globalSettings().frameIP ?? "") });
    } catch (error) {
        await streamDeck.ui.sendToPropertyInspector({ event: "galleries", error: error instanceof Error ? error.message : String(error) });
    }
}
