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
 * A photo filling the key with a caption strip along the bottom — the Status,
 * Previous and Remove keys. `tone` "warn" makes the strip red.
 */
export function photoFace(options: { thumbnail?: string; caption?: string; dim?: boolean; tone?: "normal" | "warn"; placeholder?: string }): string {
    const { thumbnail, caption, dim, tone = "normal", placeholder = "No photo yet" } = options;
    const photo = thumbnail
        ? `<image x="0" y="0" width="144" height="144" xlink:href="${thumbnail}" href="${thumbnail}" preserveAspectRatio="xMidYMid slice"${dim ? ' opacity="0.55"' : ""}/>`
        : `<rect width="144" height="144" fill="#1c1c1e"/><text x="72" y="72" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#8e8e93" text-anchor="middle">${escape(placeholder)}</text>`;
    const strip = caption
        ? `<rect x="0" y="112" width="144" height="32" fill="${tone === "warn" ? "#c62828" : "#000000"}" fill-opacity="${tone === "warn" ? "0.9" : "0.65"}"/>` +
          `<text x="72" y="135" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="600" fill="#ffffff" text-anchor="middle">${escape(caption.slice(0, 16))}</text>`
        : "";
    const border = tone === "warn" ? `<rect x="3" y="3" width="138" height="138" fill="none" stroke="#ff5252" stroke-width="6"/>` : "";
    return svgURL(photo + strip + border);
}

/**
 * The frame-status key: the current photo with battery (and "asleep" when the
 * frame isn't answering). A low battery turns the strip red with a ⚠ and
 * outlines the key.
 */
export function statusFace(options: { thumbnail?: string; battery?: number; asleep: boolean; low?: boolean }): string {
    const { thumbnail, battery, asleep, low } = options;
    const parts: string[] = [];
    if (battery !== undefined) parts.push(low ? `⚠ ${battery}%` : `${battery}%`);
    if (asleep) parts.push("asleep");
    return photoFace({ thumbnail, caption: parts.join(" · ") || undefined, dim: asleep, tone: low ? "warn" : "normal" });
}
