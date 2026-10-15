import streamDeck from "@elgato/streamdeck";

import { FrameStatusAction } from "./actions/frame-status";
import { GeneratedContentAction } from "./actions/generated-content";
import { RandomPhotoAction } from "./actions/random-photo";
import { WakeFrameAction } from "./actions/wake-frame";
import { loadGlobalSettings } from "./settings";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new RandomPhotoAction());
streamDeck.actions.registerAction(new WakeFrameAction());
streamDeck.actions.registerAction(new FrameStatusAction());
streamDeck.actions.registerAction(new GeneratedContentAction());

await streamDeck.connect();
await loadGlobalSettings();
