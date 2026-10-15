import {
    action,
    type DialAction,
    type DialDownEvent,
    type DialRotateEvent,
    type KeyAction,
    type KeyDownEvent,
    SingletonAction,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from "@elgato/streamdeck";

import { isBusy, runWithFeedback } from "../feedback";
import { imageExists, show } from "../frame";
import { forget, goBackTo, previousPhotos } from "../history";
import { photoFace } from "../keyface";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus, watchStatus } from "../status";
import { cachedThumbnail, thumbnail } from "../thumbnails";
import { ensureAwake } from "../wake";

/**
 * Goes back to the photo the frame showed before this one; press again to keep
 * going back. The key shows the photo it will go back to.
 *
 * On a dial: turn to look back through the history (thumbnails on the strip),
 * push or tap to show the one picked.
 */
@action({ UUID: "com.pholtom.bloomin8frame.previous" })
export class PreviousAction extends SingletonAction {
    private unsubscribers = new Map<string, () => void>();
    /** Each dial's position in the history (0 = the photo just before this one). */
    private positions = new Map<string, number>();
    private thumbTimers = new Map<string, NodeJS.Timeout>();

    override onWillAppear(ev: WillAppearEvent): void {
        const target = ev.action;
        this.unsubscribers.set(
            target.id,
            watchStatus(() => {
                if (!isBusy(target.id)) void this.draw(target);
            }),
        );
    }

    override onWillDisappear(ev: WillDisappearEvent): void {
        this.unsubscribers.get(ev.action.id)?.();
        this.unsubscribers.delete(ev.action.id);
        this.positions.delete(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent): Promise<void> {
        await this.goBack(ev.action, 0);
    }

    override async onDialDown(ev: DialDownEvent): Promise<void> {
        await this.goBack(ev.action, this.positions.get(ev.action.id) ?? 0);
    }

    override async onTouchTap(ev: TouchTapEvent): Promise<void> {
        await this.goBack(ev.action, this.positions.get(ev.action.id) ?? 0);
    }

    override async onDialRotate(ev: DialRotateEvent): Promise<void> {
        const dial = ev.action;
        if (isBusy(dial.id)) return;
        const history = await previousPhotos();
        if (history.length === 0) return void this.draw(dial);
        const position = Math.min(history.length - 1, Math.max(0, (this.positions.get(dial.id) ?? 0) + ev.payload.ticks));
        this.positions.set(dial.id, position);
        await this.draw(dial);
    }

    /** Shows history[position], skipping photos that have since been deleted. */
    private async goBack(target: KeyAction | DialAction, position: number): Promise<void> {
        await runWithFeedback(
            target,
            async (progress) => {
                const { frameIP = "", bleName = "" } = globalSettings();
                if (!frameIP.trim()) throw new Error("Set the frame's IP address in the plugin settings.");
                const history = (await previousPhotos()).slice(position);
                if (history.length === 0) throw new Error("No history yet");

                await progress("Connecting…");
                await ensureAwake(frameIP, bleName);
                for (const imagePath of history) {
                    if (!(await imageExists(frameIP, imagePath))) {
                        await forget(imagePath);
                        continue;
                    }
                    await progress("Going back…");
                    await goBackTo(imagePath);
                    await show(frameIP, imagePath);
                    this.positions.set(target.id, 0);
                    await refreshStatus();
                    return;
                }
                throw new Error("No history yet");
            },
            () => this.draw(target),
        );
    }

    private async draw(target: KeyAction | DialAction): Promise<void> {
        const history = await previousPhotos();
        const position = Math.min(this.positions.get(target.id) ?? 0, Math.max(0, history.length - 1));
        const imagePath = history[position];
        const thumb = imagePath ? cachedThumbnail(imagePath) : undefined;
        if (imagePath && !thumb) this.loadThumbnail(target, imagePath);

        if (target.isDial()) {
            await target.setFeedback({
                photo: thumb ?? "imgs/actions/previous/icon.svg",
                label: "Previous",
                value: imagePath ? (position === 0 ? "Last photo" : `${position + 1} back`) : "No history",
                status: imagePath ? "Push to show" : "Shows as you go",
            });
        } else {
            await target.setImage(photoFace({ thumbnail: thumb, caption: imagePath ? "◀ Back" : undefined, placeholder: "No history" }));
        }
    }

    /** Fetches a missing thumbnail once the dial or key has settled, then redraws. */
    private loadThumbnail(target: KeyAction | DialAction, imagePath: string): void {
        const ip = globalSettings().frameIP ?? "";
        if (!ip.trim() || currentStatus().asleep) return;
        clearTimeout(this.thumbTimers.get(target.id));
        this.thumbTimers.set(
            target.id,
            setTimeout(() => {
                thumbnail(ip, imagePath)
                    .then(() => (isBusy(target.id) ? undefined : this.draw(target)))
                    .catch(() => undefined);
            }, 350),
        );
    }
}
