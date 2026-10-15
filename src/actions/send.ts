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
import { clipboardImage, finderSelectedImage, renderFileForFrame, renderForFrame, type Fit } from "../images";
import { globalSettings } from "../settings";
import { refreshStatus } from "../status";
import { ensureAwake } from "../wake";
import { sendGalleryList } from "./random-photo";

type From = "auto" | "clipboard" | "finder";

type Settings = {
    /** Where the picture comes from; "auto" tries the clipboard, then Finder. */
    from?: From;
    /** Frame gallery to upload into; empty means "Stream Deck". */
    gallery?: string;
    fit?: Fit;
};

const fromOptions: From[] = ["auto", "clipboard", "finder"];
const fromNames: Record<From, string> = { auto: "Clipboard or Finder", clipboard: "Clipboard", finder: "Finder selection" };
const defaultGallery = "Stream Deck";

/**
 * Sends a picture from the Mac to the frame: the image on the clipboard (a
 * screenshot, "Copy Image", or an image file copied in Finder), or the image
 * selected in Finder. It's sized for the frame, uploaded and shown.
 *
 * On a dial: turn to choose clipboard / Finder, push or tap to send.
 */
@action({ UUID: "com.pholtom.bloomin8frame.send" })
export class SendAction extends SingletonAction<Settings> {
    private saveLater = debouncer();
    private turning = new Map<string, From>();

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        if (ev.action.isDial()) await this.drawDial(ev.action, ev.payload.settings.from ?? "auto");
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
        if (ev.action.isDial() && !isBusy(ev.action.id) && !this.turning.has(ev.action.id)) {
            await this.drawDial(ev.action, ev.payload.settings.from ?? "auto");
        }
    }

    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
        await this.send(ev.action, ev.payload.settings);
    }

    override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
        await this.sendFromDial(ev.action, ev.payload.settings);
    }

    override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
        await this.sendFromDial(ev.action, ev.payload.settings);
    }

    override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
        const dial = ev.action;
        if (isBusy(dial.id)) return;
        const next = step(fromOptions, this.turning.get(dial.id) ?? ev.payload.settings.from ?? "auto", ev.payload.ticks);
        this.turning.set(dial.id, next);
        await this.drawDial(dial, next);
        this.saveLater(dial.id, () => {
            this.turning.delete(dial.id);
            void dial.setSettings({ ...ev.payload.settings, from: next });
        });
    }

    private async sendFromDial(dial: DialAction<Settings>, settings: Settings): Promise<void> {
        const from = this.turning.get(dial.id) ?? settings.from ?? "auto";
        await this.send(dial, { ...settings, from }, () => this.drawDial(dial, from));
    }

    private drawDial(dial: DialAction<Settings>, from: From): Promise<void> {
        return dial.setFeedback({ icon: "imgs/actions/send/icon.svg", label: "Send to frame", value: fromNames[from], status: "Push to send" });
    }

    private async send(target: KeyAction<Settings> | DialAction<Settings>, settings: Settings, restore?: () => Promise<void>): Promise<void> {
        await runWithFeedback(
            target,
            async (progress) => {
                const { frameIP = "", bleName = "", orientation = "portrait" } = globalSettings();
                if (!frameIP.trim()) throw new Error("Set the frame's IP address in the plugin settings.");
                const from = settings.from ?? "auto";

                // Grab the picture first, while it's still what you meant.
                await progress("Reading…");
                let picture: Buffer | undefined;
                let file: string | undefined;
                if (from !== "finder") picture = await clipboardImage();
                if (!picture && from !== "clipboard") file = await finderSelectedImage();
                if (!picture && !file) throw new Error(from === "clipboard" ? "No image on the clipboard" : "No image to send");

                await progress("Connecting…");
                await ensureAwake(frameIP, bleName);
                const info = await deviceInfo(frameIP);
                const short = Math.min(info.width ?? 1200, info.height ?? 1600);
                const long = Math.max(info.width ?? 1200, info.height ?? 1600);
                const [width, height] = orientation === "landscape" ? [long, short] : [short, long];

                await progress("Preparing…");
                const fit = settings.fit ?? "fit";
                const jpeg = picture ? await renderForFrame(picture, width, height, fit) : await renderFileForFrame(file!, width, height, fit);

                await progress("Sending…");
                const gallery = settings.gallery?.trim() || defaultGallery;
                await ensureGallery(frameIP, gallery);
                await upload(frameIP, gallery, `deck-${Date.now().toString(36)}_${orientation === "landscape" ? "L" : "P"}.jpg`, jpeg);
                void refreshStatus();
            },
            restore,
        );
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
        await sendGalleryList(ev);
    }
}
