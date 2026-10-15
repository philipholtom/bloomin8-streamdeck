# BLOOMIN8 Frame — Stream Deck plugin

A standalone Stream Deck plugin for the BLOOMIN8 e-ink photo frame. It talks
straight to the frame's local HTTP API; it doesn't need the [Blooming8 Mac apps](https://github.com/philipholtom/Blooming8-Mac-Widget)
and shares no code or settings with them.

> 🤖 This plugin — every line of code, this README included — was built by
> [Claude Code](https://claude.com/claude-code), Anthropic's AI coding assistant,
> from plain-English requests in a chat conversation.

## Keys

| Key | What it does |
| --- | --- |
| **Random Photo** | Shows a random photo that's already on the frame — from one gallery, or any gallery (each gallery gets an equal chance). |
| **Wake Frame** | Wakes the frame's Wi-Fi over Bluetooth and waits until it answers. |
| **Frame Status** | Shows the photo that's on the frame, with its battery level; refreshes every minute and dims with "asleep" when the frame's Wi-Fi is off. Press to wake it and refresh. |
| **Fresh Picture** | Fetches a picture from NASA (today's or a random Astronomy Picture of the Day), the Met Museum, Wikipedia's Picture of the Day, or a random cat or dog; sizes it for the frame (fill or fit), uploads it and shows it. |

Every action also works on a Stream Deck + dial, with its touch strip showing:

| Dial | Turn | Push or tap | Strip shows |
| --- | --- | --- | --- |
| **Random Photo** | choose a gallery (or any) | show a random photo | the chosen gallery |
| **Wake Frame** | — | wake the frame | whether it's awake or asleep |
| **Frame Status** | — | refresh (waking it if needed) | the photo on the frame, battery and gallery |
| **Fresh Picture** | choose the source | fetch and show | the chosen source |

Progress and errors appear on the strip's bottom line.

Random Photo and Fresh Picture wake the frame first if it's asleep, as long as
the Bluetooth name is set.

## Settings

Open any of the plugin's keys in Stream Deck to set these (they're shared by
every key):

- **IP address** — the frame's address on your network.
- **Bluetooth name** — the name the frame advertises, used to wake it.
- **Orientation** — portrait or landscape, for Fresh Picture.

## How waking works

The Stream Deck app doesn't declare Bluetooth use, so its plugins can't use
Bluetooth themselves. The plugin includes a tiny helper app,
`bin/FrameWaker.app`, launched with `open` so macOS treats it as its own app:
the first wake asks for Bluetooth permission for "BLOOMIN8 Frame Waker". It
finds the frame by name, writes the wake pulse (0x01 then 0x00 to
characteristic 0xF001), and quits.

Pictures are resized with macOS's built-in `sips`, so the plugin has no native
Node modules.

## Building

Needs Node 20+ and the Xcode Command Line Tools (for `swiftc`).

```sh
npm install
npm run build      # bundles bin/plugin.js and builds bin/FrameWaker.app
npm run link       # links the plugin into Stream Deck (first time only)
npm run restart    # reloads it in Stream Deck after a rebuild
```

`npm run pack` makes an installable `.streamDeckPlugin` file in `dist/`.
Logs are in `com.pholtom.bloomin8frame.sdPlugin/logs/`.
