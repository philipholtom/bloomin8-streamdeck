/**
 * Key images drawn as SVG (144x144), so they need no image libraries.
 */

function escape(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function svgURL(body: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144">${body}</svg>`;
    return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Up to two short lines of text, word-wrapped to fit a key. */
function wrap(text: string, maxChars = 13, maxLines = 3): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
        if (!line) line = word;
        else if ((line + " " + word).length <= maxChars) line += " " + word;
        else {
            lines.push(line);
            line = word;
        }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + "…";
    }
    return lines.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 1) + "…" : l));
}

/** A plain message on a dark key — progress ("Waking…") or an error. */
export function messageFace(message: string, tone: "busy" | "error" = "busy"): string {
    const color = tone === "error" ? "#ff8a80" : "#ffffff";
    const lines = wrap(message);
    const top = 72 - ((lines.length - 1) * 24) / 2 + 8;
    const text = lines
        .map((l, i) => `<text x="72" y="${top + i * 24}" font-family="Helvetica, Arial, sans-serif" font-size="21" font-weight="600" fill="${color}" text-anchor="middle">${escape(l)}</text>`)
        .join("");
    return svgURL(`<rect width="144" height="144" fill="${tone === "error" ? "#3a1414" : "#1c1c1e"}"/>${text}`);
}

/**
 * The frame-status key: the current photo filling the key, with a strip at the
 * bottom showing battery (and "asleep" when the frame isn't answering).
 */
export function statusFace(options: { thumbnail?: string; battery?: number; asleep: boolean; label?: string }): string {
    const { thumbnail, battery, asleep, label } = options;
    const photo = thumbnail
        ? `<image x="0" y="0" width="144" height="144" xlink:href="${thumbnail}" href="${thumbnail}" preserveAspectRatio="xMidYMid slice"${asleep ? ' opacity="0.55"' : ""}/>`
        : `<rect width="144" height="144" fill="#1c1c1e"/><text x="72" y="72" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#8e8e93" text-anchor="middle">No photo yet</text>`;
    const parts: string[] = [];
    if (battery !== undefined) parts.push(`${battery}%`);
    if (asleep) parts.push("asleep");
    else if (label) parts.push(label);
    const strip = parts.length
        ? `<rect x="0" y="112" width="144" height="32" fill="#000000" fill-opacity="0.65"/>` +
          `<text x="72" y="135" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="600" fill="${battery !== undefined && battery <= 15 ? "#ff8a80" : "#ffffff"}" text-anchor="middle">${escape(parts.join(" · ").slice(0, 16))}</text>`
        : "";
    return svgURL(photo + strip);
}
