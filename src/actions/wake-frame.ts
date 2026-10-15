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

import { isBusy, runWithFeedback } from "../feedback";
import { globalSettings } from "../settings";
import { currentStatus, refreshStatus, watchStatus, type FrameStatus } from "../status";
import { ensureAwake, sendWakePulse } from "../wake";

/**
 * Sends the Bluetooth wake pulse and waits for the frame's Wi-Fi to answer.
 * On a dial, the strip also shows whether the frame is awake right now.
 */
@action({ UUID: "com.pholtom.bloomin8frame.wake" })
export class WakeFrameAction extends SingletonAction {
    private unsubscribers = new Map<string, () => void>();

    override onWillAppear(ev: WillAppearEvent): void {
        if (!ev.action.isDial()) return;
        const dial = ev.action;
        this.unsubscribers.set(
            dial.id,
            watchStatus((status) => {
                if (!isBusy(dial.id)) void this.drawDial(dial, status);
            }),
        );
    }

    override onWillDisappear(ev: WillDisappearEvent): void {
        this.unsubscribers.get(ev.action.id)?.();
        this.unsubscribers.delete(ev.action.id);
    }

    override async onKeyDown(ev: KeyDownEvent): Promise<void> {
        await this.wake(ev.action);
    }

    override async onDialDown(ev: DialDownEvent): Promise<void> {
        await this.wake(ev.action, () => this.drawDial(ev.action, currentStatus()));
    }

    override async onTouchTap(ev: TouchTapEvent): Promise<void> {
        await this.wake(ev.action, () => this.drawDial(ev.action, currentStatus()));
    }

    private drawDial(dial: DialAction, status: FrameStatus): Promise<void> {
        return dial.setFeedback({
            icon: "imgs/actions/wake/icon.svg",
            label: "Frame",
            value: status.checkedAt === undefined ? "—" : status.asleep ? "Asleep" : "Awake",
            status: "Push to wake",
        });
    }

    private async wake(target: KeyAction | DialAction, restore?: () => Promise<void>): Promise<void> {
        await runWithFeedback(
            target,
            async (progress) => {
                const { frameIP = "", bleName = "" } = globalSettings();
                await progress("Waking…");
                if (frameIP.trim()) {
                    await ensureAwake(frameIP, bleName); // returns at once if it's already awake
                    await refreshStatus();
                } else {
                    await sendWakePulse(bleName);
                }
            },
            restore,
        );
    }
}
