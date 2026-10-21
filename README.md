# BLOOMIN8 Frame — Stream Deck plugin

A standalone Stream Deck plugin for the BLOOMIN8 e-ink photo frame. It talks
straight to the frame's local HTTP API; it doesn't need the [Bloomin8 Mac apps](https://github.com/philipholtom/Bloomin8-Mac-Widget)
and shares no code or settings with them.

> 🤖 This plugin — every line of code, this README included — was built by
> [Claude Code](https://claude.com/claude-code), Anthropic's AI coding assistant,
> from plain-English requests in a chat conversation.

## Install

Download `com.pholtom.bloomin8frame.streamDeckPlugin` from the
[latest release](https://github.com/philipholtom/bloomin8-streamdeck/releases/latest)
and double-click it; Stream Deck installs it. Then drag the actions from the
**BLOOMIN8 Frame** category onto keys or dials, and fill in the frame's IP
address and Bluetooth name in any action's settings.

Needs an Apple Silicon Mac on macOS 13 or later, and Stream Deck 6.9 or later.
To build it yourself instead, see [Building](#building).

## Actions

Every action works on a key and on a Stream Deck + dial (Browse is dial-only).

| Action | Key | Dial (turn · push or tap) |
| --- | --- | --- |
| **Random Photo** | Shows a random photo from one gallery, or any gallery (each gallery gets an equal chance). | Turn to choose the gallery · show a random photo. |
| **Browse Gallery** | — | Turn to flick through a gallery's photos, with a thumbnail on the strip · show the one picked. Hold the strip for the next gallery. Starts on whatever the frame is showing. |
| **Previous Photo** | Goes back to the photo shown before; press again to keep going back. The key shows the photo it will go back to. | Turn back through the history (thumbnails) · show it. |
| **Send to Frame** | Sends the clipboard's image (a screenshot, "Copy Image", or an image file copied in Finder), or else the image selected in Finder. Uploads go to a "Stream Deck" gallery unless you choose another. | Turn to choose clipboard / Finder · send. |
| **Fresh Picture** | Fetches a picture from NASA (today's or a random Astronomy Picture of the Day), the Met Museum, Wikipedia's Picture of the Day, a random cat or dog, or a movie poster (popular, top rated, in cinemas now, or released today), and shows it. | Turn to choose the source · fetch and show. |
| **Favourite This** | Copies the photo that's showing into your Favourites gallery (or one you choose); the original stays put and the screen doesn't redraw. The heart fills in while the photo on the frame is already a favourite. | The photo and whether it's saved · save it. |
| **Remove from Frame** | Deletes the photo that's showing. The first press shows which photo and asks you to press again within five seconds; then it shows another photo from the same gallery. | Same, push twice. |
| **Wake Frame** | Wakes the frame's Wi-Fi over Bluetooth and waits until it answers. | Shows whether the frame is awake · wake it. |
| **Frame Status** | The photo that's on the frame, with its battery level; refreshes every minute and dims when the frame is asleep. Press to wake it and refresh. | The same on the strip · refresh. |

Actions that change the picture wake the frame first if it's asleep, as long
as the Bluetooth name is set. Progress and errors appear on the key, or on the
bottom line of a dial's strip.

**Low battery:** when the battery is at or below the warning level (20% unless
you change it), Frame Status turns red with a ⚠, and the Mac posts one
notification each time it drops that low.

**History:** Previous remembers the last 30 photos the frame showed, including
ones changed by other apps (noticed by the once-a-minute status check while a
Status, Previous, Remove or Wake dial is on screen). It's kept in
`~/Library/Application Support/com.pholtom.bloomin8frame/`.

## Settings

Open any of the plugin's keys in Stream Deck to set these (they're shared by
every key):

- **IP address** — the frame's address on your network.
- **Bluetooth name** — the name the frame advertises, used to wake it.
- **Orientation** — portrait or landscape, for pictures the plugin uploads.
- **Low battery** — the warning level, or off, and whether to post a Mac notification.

## The helpers

The plugin ships two small Swift helpers in `bin/`:

- **FrameWaker.app** — the Bluetooth wake. The Stream Deck app doesn't declare
  Bluetooth use, so its plugins can't use Bluetooth themselves; FrameWaker is
  launched with `open` so macOS treats it as its own app, and the first wake
  asks for Bluetooth permission for "BLOOMIN8 Frame Waker". It finds the frame
  by name, writes the wake pulse (0x01 then 0x00 to characteristic 0xF001),
  and quits.
- **frameimage** — sizes pictures for the frame with ImageIO: applies photos'
  rotation flags, reads HEIC, and always writes a plain baseline JPEG (the
  frame can't decode progressive JPEGs; it logs "Image parsing failed"). It
  also reads images from the clipboard.

## Building

Needs Node 20+ and the Xcode Command Line Tools (for `swiftc`).

```sh
npm install
npm run build      # bundles bin/plugin.js and builds the Swift helpers
npm run link       # links the plugin into Stream Deck (first time only)
npm run restart    # reloads it in Stream Deck after a rebuild (stops the plugin; Stream Deck relaunches it)
```

Changes to `manifest.json` or the layouts only load when the Stream Deck app
itself restarts.

`npm run pack` makes an installable `.streamDeckPlugin` file in `dist/`.
Logs are in `com.pholtom.bloomin8frame.sdPlugin/logs/`.
