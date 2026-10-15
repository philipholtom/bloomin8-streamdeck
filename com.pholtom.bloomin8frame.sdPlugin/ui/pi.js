// Shared settings-panel code. Talks to Stream Deck over its own WebSocket
// protocol: global settings (frame IP, Bluetooth name, orientation) are shared
// by every key; anything with data-setting belongs to this one key.
//
// Inputs:  data-global="frameIP"    → saved in the plugin's global settings
//          data-setting="gallery"   → saved in this key's settings
// A <select data-galleries> is filled with the frame's galleries on request.

let socket;
let uuid;
let globals = {};
let settings = {};

function send(event, payload) {
    socket?.send(JSON.stringify({ event, context: uuid, payload }));
}

function fill() {
    document.querySelectorAll("[data-global]").forEach((el) => setValue(el, globals[el.dataset.global] ?? el.dataset.default));
    document.querySelectorAll("[data-setting]").forEach((el) => setValue(el, settings[el.dataset.setting] ?? el.dataset.default));
}

function setValue(el, value) {
    if (value === undefined) return;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === value)) {
        // Keep a saved gallery visible even before the list has loaded.
        el.add(new Option(value, value));
    }
    el.value = value;
}

function wire() {
    document.querySelectorAll("[data-global]").forEach((el) =>
        el.addEventListener("change", () => {
            globals[el.dataset.global] = el.value.trim();
            send("setGlobalSettings", globals);
        }),
    );
    document.querySelectorAll("[data-setting]").forEach((el) =>
        el.addEventListener("change", () => {
            settings[el.dataset.setting] = el.value.trim();
            send("setSettings", settings);
        }),
    );
    document.querySelectorAll("[data-load-galleries]").forEach((button) => button.addEventListener("click", loadGalleries));
}

function loadGalleries() {
    const status = document.getElementById("gallery-status");
    if (status) {
        status.textContent = "Asking the frame…";
        status.classList.remove("error");
    }
    send("sendToPlugin", { event: "getGalleries" });
}

function showGalleries(payload) {
    const status = document.getElementById("gallery-status");
    if (payload.error) {
        if (status) {
            status.textContent = `Couldn't list galleries: ${payload.error}. Is the frame awake?`;
            status.classList.add("error");
        }
        return;
    }
    document.querySelectorAll("select[data-galleries]").forEach((select) => {
        const keep = [...select.options].filter((o) => o.dataset.fixed !== undefined);
        select.replaceChildren(...keep, ...payload.items.map((name) => new Option(name, name)));
        setValue(select, settings[select.dataset.setting] ?? "");
    });
    if (status) status.textContent = `${payload.items.length} galleries on the frame.`;
}

// Stream Deck calls this when the panel opens.
window.connectElgatoStreamDeckSocket = (port, inUUID, registerEvent, _info, actionInfo) => {
    uuid = inUUID;
    settings = JSON.parse(actionInfo).payload.settings ?? {};
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.onopen = () => {
        socket.send(JSON.stringify({ event: registerEvent, uuid }));
        send("getGlobalSettings");
        fill();
    };
    socket.onmessage = (message) => {
        const data = JSON.parse(message.data);
        if (data.event === "didReceiveGlobalSettings") {
            globals = data.payload.settings ?? {};
            fill();
        } else if (data.event === "didReceiveSettings") {
            settings = data.payload.settings ?? {};
            fill();
        } else if (data.event === "sendToPropertyInspector" && data.payload?.event === "galleries") {
            showGalleries(data.payload);
        }
    };
};

document.addEventListener("DOMContentLoaded", wire);
