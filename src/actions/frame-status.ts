import streamDeck, {
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

import { shortReason } from "../feedback";
import { messageFace, statusFace } from "../keyface";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus, watchStatus, type FrameStatus } from "../status";
import { ensureAwake } from "../wake";

/**
 * Shows the photo that's on the frame with its battery level, refreshing every
 * minute. Pressing it (or pushing/tapping the dial) wakes the frame if needed
 * and refreshes straight away.
 */
@action({ UUID: "com.pholtom.bloomin8frame.status" })
export class FrameStatusAction extends SingletonAction {
    private unsubscribers = new Map<string, () => void>();
    private pressing = new Set<string>();

    override onWillAppear(ev: WillAppearEvent): void {
        const target = ev.action;
        const draw = (status: FrameStatus) => {
            if (!this.pressing.has(target.id)) void this.draw(target, status);
        };
        this.unsubscribers.set(target.id, watchStatus(draw));
    }

    override onWillDisappear(ev: WillDisappearEvent): void {
        this.unsubscribers.get(ev.action.id)?.();
        this.unsubscribers.delete(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent): Promise<void> {
        await this.refresh(ev.action);
    }

    override async onDialDown(ev: DialDownEvent): Promise<void> {
        await this.refresh(ev.action);
    }

    override async onTouchTap(ev: TouchTapEvent): Promise<void> {
        await this.refresh(ev.action);
    }

    private async refresh(target: KeyAction | DialAction): Promise<void> {
        if (this.pressing.has(target.id)) return;
        this.pressing.add(target.id);
        const progress = (message: string) =>
            target.isDial() ? target.setFeedback({ status: message }) : target.setImage(messageFace(message));
        let failure: string | undefined;
        try {
            const { frameIP = "", bleName = "" } = globalSettings();
            if (!frameIP.trim()) throw new Error("Set frame IP");
            if (currentStatus().asleep && bleName.trim()) {
                await progress("Waking…");
                await ensureAwake(frameIP, bleName);
            }
            await progress("Checking…");
            await refreshStatus();
            if (currentStatus().asleep) throw new Error("Frame not answering");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            streamDeck.logger.error(`Frame status: ${message}`);
            failure = shortReason(message);
            await target.showAlert();
        } finally {
            this.pressing.delete(target.id);
            await this.draw(target, currentStatus());
            // On a dial, leave the reason up until the next poll redraws it.
            if (failure && target.isDial()) await target.setFeedback({ status: failure });
        }
    }

    private draw(target: KeyAction | DialAction, status: FrameStatus): Promise<void> {
        const configured = !!globalSettings().frameIP?.trim();
        const asleep = status.asleep && status.checkedAt !== undefined;
        if (target.isDial()) {
            return target.setFeedback({
                photo: status.thumbnail ?? "imgs/actions/status/icon.svg",
                battery: status.battery !== undefined ? `${status.battery}%` : "—",
                status: !configured ? "Set frame IP" : asleep ? "Asleep" : (status.gallery ?? "Checking…"),
            });
        }
        if (!configured) return target.setImage(messageFace("Set frame IP", "error"));
        return target.setImage(statusFace({ thumbnail: status.thumbnail, battery: status.battery, asleep }));
    }
}
