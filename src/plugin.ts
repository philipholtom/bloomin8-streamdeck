import streamDeck from "@elgato/streamdeck";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FrameStatusAction } from "./actions/frame-status";
import { BrowseAction } from "./actions/browse";
import { FavouriteAction } from "./actions/favourite";
import { GeneratedContentAction } from "./actions/generated-content";
import { PreviousAction } from "./actions/previous";
import { RandomPhotoAction } from "./actions/random-photo";
import { RemoveAction } from "./actions/remove";
import { SendAction } from "./actions/send";
import { WakeFrameAction } from "./actions/wake-frame";
import { loadGlobalSettings, onGlobalSettingsChanged } from "./settings";
import { redrawStatus } from "./status";

streamDeck.logger.setLevel("info");

// Stream Deck's plugin packer drops the executable bit, so an installed copy's
// Swift helpers couldn't run; put it back on our own two helpers at startup.
const bin = path.dirname(fileURLToPath(import.meta.url));
for (const helper of ["frameimage", "FrameWaker.app/Contents/MacOS/FrameWaker"]) {
    await chmod(path.join(bin, helper), 0o755).catch((error) => streamDeck.logger.warn(`Couldn't make ${helper} executable: ${error}`));
}

streamDeck.actions.registerAction(new RandomPhotoAction());
streamDeck.actions.registerAction(new WakeFrameAction());
streamDeck.actions.registerAction(new FrameStatusAction());
streamDeck.actions.registerAction(new GeneratedContentAction());
streamDeck.actions.registerAction(new PreviousAction());
streamDeck.actions.registerAction(new BrowseAction());
streamDeck.actions.registerAction(new RemoveAction());
streamDeck.actions.registerAction(new SendAction());
streamDeck.actions.registerAction(new FavouriteAction());

await streamDeck.connect();
await loadGlobalSettings();
onGlobalSettingsChanged(redrawStatus);
