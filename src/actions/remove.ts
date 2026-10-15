import {
    action,
    type DialAction,
    type DialDownEvent,
    type KeyAction,
    type KeyDownEvent,
    SingletonAction,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from "@elgato/streamdeck";

import { isBusy, runWithFeedback, shortReason } from "../feedback";
import { deleteImage, deviceInfo, show, splitImagePath } from "../frame";
import { forgetListing, imagesIn } from "../galleries";
import { forget } from "../history";
import { messageFace, photoFace } from "../keyface";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus, watchStatus } from "../status";
import { forgetThumbnail, thumbnail } from "../thumbnails";
import { ensureAwake } from "../wake";

/** How long the "press again to delete" prompt stays armed. */
const confirmWindow = 5000;

/**
 * Deletes the photo that's on the frame. The first press wakes the frame,
 * checks exactly which photo is showing and asks for a second press; only a
 * second press within five seconds deletes that photo. Then, because the
 * e-ink screen would otherwise keep showing the deleted picture, it shows
 * another photo from the same gallery.
 */
@action({ UUID: "com.pholtom.bloomin8frame.remove" })
export class RemoveAction extends SingletonAction {
    /** The photo each key/dial is waiting to have confirmed, until it expires. */
    private armed = new Map<string, { imagePath: string; timer: NodeJS.Timeout }>();
    private unsubscribers = new Map<string, () => void>();

    override onWillAppear(ev: WillAppearEvent): void {
        if (!ev.action.isDial()) return;
        const dial = ev.action;
        this.unsubscribers.set(
            dial.id,
            watchStatus(() => {
                if (!isBusy(dial.id) && !this.armed.has(dial.id)) void this.drawDial(dial);
            }),
        );
    }

    override onWillDisappear(ev: WillDisappearEvent): void {
        this.unsubscribers.get(ev.action.id)?.();
        this.unsubscribers.delete(ev.action.id);
        this.disarm(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent): Promise<void> {
        await this.press(ev.action);
    }

    override async onDialDown(ev: DialDownEvent): Promise<void> {
        await this.press(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent): Promise<void> {
        await this.press(ev.action);
    }

    private async press(target: KeyAction | DialAction): Promise<void> {
        if (isBusy(target.id)) return;
        const armed = this.armed.get(target.id);
        if (armed) {
            this.disarm(target.id);
            await this.remove(target, armed.imagePath);
        } else {
            await this.arm(target);
        }
    }

    /** First press: find out exactly what's showing, then ask for confirmation. */
    private async arm(target: KeyAction | DialAction): Promise<void> {
        const progress = (message: string) => (target.isDial() ? target.setFeedback({ status: message }) : target.setImage(messageFace(message)));
        let imagePath: string | undefined;
        let thumb: string | undefined;
        try {
            const { frameIP = "", bleName = "" } = globalSettings();
            if (!frameIP.trim()) throw new Error("Set frame IP");
            await progress("Checking…");
            await ensureAwake(frameIP, bleName);
            imagePath = (await deviceInfo(frameIP)).image;
            if (!imagePath || !splitImagePath(imagePath)) throw new Error("Nothing to delete");
            thumb = await thumbnail(frameIP, imagePath).catch(() => undefined);
        } catch (error) {
            const reason = error instanceof Error && error.message === "Nothing to delete" ? "Nothing to delete" : shortReason(String(error));
            await (target.isDial() ? target.setFeedback({ status: reason }) : target.setImage(messageFace(reason, "error")));
            await target.showAlert();
            setTimeout(() => void this.restore(target), 4000);
            return;
        }

        const timer = setTimeout(() => {
            this.armed.delete(target.id);
            void this.restore(target);
        }, confirmWindow);
        this.armed.set(target.id, { imagePath, timer });
        if (target.isDial()) {
            await target.setFeedback({
                photo: thumb ?? "imgs/actions/remove/icon.svg",
                label: "Delete this?",
                value: { value: "Push again", color: "#ff5c5c" },
                status: "to delete it",
            });
        } else {
            await target.setImage(photoFace({ thumbnail: thumb, caption: "Press to delete", tone: "warn" }));
        }
    }

    /** Second press: delete exactly the photo that was confirmed. */
    private async remove(target: KeyAction | DialAction, imagePath: string): Promise<void> {
        await runWithFeedback(
            target,
            async (progress) => {
                const ip = globalSettings().frameIP ?? "";
                const parts = splitImagePath(imagePath)!;
                await progress("Deleting…");
                await deleteImage(ip, parts.gallery, parts.filename);
                forgetListing(parts.gallery);
                forgetThumbnail(imagePath);
                await forget(imagePath);

                // Replace it on screen with another photo from the same gallery.
                const others = (await imagesIn(ip, parts.gallery).catch(() => [])).filter((name) => name !== parts.filename);
                if (others.length > 0) {
                    await progress("Showing another…");
                    await show(ip, `/gallerys/${parts.gallery}/${others[Math.floor(Math.random() * others.length)]}`);
                }
                await refreshStatus();
            },
            () => this.restore(target),
        );
    }

    private disarm(id: string): void {
        clearTimeout(this.armed.get(id)?.timer);
        this.armed.delete(id);
    }

    private restore(target: KeyAction | DialAction): Promise<void> {
        return target.isDial() ? this.drawDial(target) : target.setImage();
    }

    private drawDial(dial: DialAction): Promise<void> {
        return dial.setFeedback({
            photo: currentStatus().thumbnail ?? "imgs/actions/remove/icon.svg",
            label: "Remove",
            value: "From frame",
            status: "Push twice to delete",
        });
    }
}
