import {
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
import type { JsonValue } from "@elgato/utils";

import { debouncer, step } from "../dial";
import { isBusy, runWithFeedback } from "../feedback";
import { deviceInfo, ensureGallery, upload } from "../frame";
import { renderForFrame, type Fit } from "../images";
import { globalSettings } from "../settings";
import { source, sources } from "../sources";
import { refreshStatus } from "../status";
import { ensureAwake } from "../wake";
import { sendGalleryList } from "./random-photo";

type Settings = {
    source?: string;
    /** Frame gallery to upload into; empty means the source's own default. */
    gallery?: string;
    /** "auto" (or unset) lets the source choose: posters show whole, the rest fill. */
    fit?: Fit | "auto";
};

/**
 * Fetches a fresh picture from the web (NASA, the Met, Wikipedia, cats, dogs, movie posters),
 * sizes it for the frame, uploads it and shows it.
 *
 * On a dial: turn to choose the source, push or tap to fetch and show.
 */
@action({ UUID: "com.pholtom.bloomin8frame.generated" })
export class GeneratedContentAction extends SingletonAction<Settings> {
    private saveLater = debouncer();
    /** A dial's source while it's being turned (saved once it stops). */
    private turning = new Map<string, string>();

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        if (ev.action.isDial()) await this.drawDial(ev.action, source(ev.payload.settings.source).id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
        if (ev.action.isDial() && !isBusy(ev.action.id) && !this.turning.has(ev.action.id)) {
            await this.drawDial(ev.action, source(ev.payload.settings.source).id);
        }
    }

    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
        await this.fetchAndShow(ev.action, ev.payload.settings);
    }

    override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
        await this.fetchFromDial(ev.action, ev.payload.settings);
    }

    override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
        await this.fetchFromDial(ev.action, ev.payload.settings);
    }

    override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
        const dial = ev.action;
        if (isBusy(dial.id)) return;
        const current = this.turning.get(dial.id) ?? source(ev.payload.settings.source).id;
        const next = step(sources.map((s) => s.id), current, ev.payload.ticks);
        this.turning.set(dial.id, next);
        await this.drawDial(dial, next);
        this.saveLater(dial.id, () => {
            this.turning.delete(dial.id);
            void dial.setSettings({ ...ev.payload.settings, source: next });
        });
    }

    private async fetchFromDial(dial: DialAction<Settings>, settings: Settings): Promise<void> {
        const sourceID = this.turning.get(dial.id) ?? source(settings.source).id;
        await this.fetchAndShow(dial, { ...settings, source: sourceID }, () => this.drawDial(dial, sourceID));
    }

    private drawDial(dial: DialAction<Settings>, sourceID: string): Promise<void> {
        return dial.setFeedback({
            icon: "imgs/actions/generated/icon.svg",
            label: "Fresh picture",
            value: source(sourceID).short,
            status: "Push to show",
        });
    }

    private async fetchAndShow(target: KeyAction<Settings> | DialAction<Settings>, settings: Settings, restore?: () => Promise<void>): Promise<void> {
        await runWithFeedback(
            target,
            async (progress) => {
                const { frameIP = "", bleName = "", orientation = "portrait" } = globalSettings();
                if (!frameIP.trim()) throw new Error("Set the frame's IP address in the plugin settings.");
                const chosen = source(settings.source);

                // Fetch first: the frame's Wi-Fi may doze off again while we wait on the web.
                await progress("Fetching…");
                const picture = await chosen.fetch();

                await progress("Connecting…");
                await ensureAwake(frameIP, bleName);

                // The frame reports its panel size (e.g. 1200x1600). Landscape
                // pictures are composed sideways and the frame rotates them.
                const info = await deviceInfo(frameIP);
                const short = Math.min(info.width ?? 1200, info.height ?? 1600);
                const long = Math.max(info.width ?? 1200, info.height ?? 1600);
                const [width, height] = orientation === "landscape" ? [long, short] : [short, long];

                await progress("Preparing…");
                const fit: Fit = settings.fit === "fill" || settings.fit === "fit" ? settings.fit : chosen.preferredFit ?? "fill";
                const jpeg = await renderForFrame(picture.image, width, height, fit);

                await progress("Sending…");
                const gallery = settings.gallery?.trim() || chosen.defaultGallery;
                await ensureGallery(frameIP, gallery);
                const filename = `${chosen.id}-${Date.now().toString(36)}_${orientation === "landscape" ? "L" : "P"}.jpg`;
                await upload(frameIP, gallery, filename, jpeg);
                void refreshStatus();
            },
            restore,
        );
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
        await sendGalleryList(ev);
    }
}
