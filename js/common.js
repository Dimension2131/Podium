import { db, ref, set, onValue, onDisconnect } from "./firebase.js";
export const $ = s => document.querySelector(s);

export const esc = s => String(s).replace(/[&<>"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
}[c]));

export const code = (new URLSearchParams(location.search).get("room") || "").toUpperCase();

export const pid = (() => {
    let v = localStorage.getItem("podium_pid");
    if (!v) {
        v = crypto.randomUUID();
        localStorage.setItem("podium_pid", v);
    }
    return v;
})();

export const getName = () => localStorage.getItem("podium_name") || "";
export const setName = n => localStorage.setItem("podium_name", n);

export function toast(t) {
    const e = $("#toast");
    e.textContent = t;
    e.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => e.hidden = true, 2500);
}

const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
}

export function match(text, items) {
    const t = norm(text);
    if (!t) {
        return -1;
    }
    for (let i = 0; i < items.length; i++) {
        for (const n of [items[i].n, ...(items[i].a || [])]) {
            const m = norm(n);
            if (m === t) {
                return i;
            }
            if (m.length > 5 && Math.abs(m.length - t.length) <= 1 && lev(m, t) <= 1) {
                return i;
            }
        }
    }
    return -1;
}

export const settle = r => {
    const a = Object.values(r.players).filter(x => x.active).length;
    if (a === 0 || Object.keys(r.revealed || {}).length >= r.size) {
        r.status = "ended";
    }
    return r;
};

const TIER = [10, 10, 10, 30, 30, 30, 60, 60, 85, 100];

export const PMODES = {
    lin: "Top ranks most",
    rev: "Top ranks least",
    tier: "Tiered",
    custom: "Custom"
};

export const buildPoints = (mode, n) => Array.from({ length: n }, (_, i) => {
    const r = i + 1;
    if (mode === "rev") {
        return r;
    }
    if (mode === "tier") {
        return TIER[Math.ceil(r * 10 / n) - 1];
    }
    return n - r + 1;
});

export const pointsFor = (room, r) => {
    const v = room.points && room.points[r - 1];
    return typeof v === "number" ? v : room.size - r + 1;
};

export const hintRules = r => ({
    max: typeof r.hintMax === "number" ? r.hintMax : 3,
    cost: typeof r.hintCost === "number" ? r.hintCost : 1
});

export const sorted = r => Object.entries(r.players).map(([id, p]) => ({
    id,
    ...p
})).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

export const isPlayer = r => !!(r && r.players && r.players[pid]);
export const isWatcher = r => !isPlayer(r) && !!(r && r.spectators && r.spectators[pid]);
export const me = r => isPlayer(r) ? r.players[pid] : isWatcher(r) ? r.spectators[pid] : null;
export const watchers = r => Object.values((r && r.spectators) || {}).filter(s => s && s.name && s.online !== false);

export function presence(spec) {
    const on = ref(db, `rooms/${code}/${spec ? "spectators" : "players"}/${pid}/online`);
    const up = () => {
        if (!document.hidden) {
            set(on, true).catch(() => { });
        }
    };
    onValue(ref(db, ".info/connected"), s => {
        if (s.val()) {
            onDisconnect(on).set(false);
            set(on, true).catch(() => { });
        }
    });
    setInterval(up, 8000);
    document.addEventListener("visibilitychange", up);
    return on;
}

export function setHtml(el, html) {
    if (el._h !== html) {
        el.innerHTML = html;
        el._h = html;
    }
}

export function patch(el, htmls) {
    const c = el._c || [];
    if (c.length !== htmls.length || el.children.length !== htmls.length) {
        el.innerHTML = htmls.join("");
        el._c = htmls.slice();
        return;
    }
    htmls.forEach((h, i) => {
        if (c[i] !== h) {
            const t = document.createElement("template");
            t.innerHTML = h;
            el.children[i].replaceWith(t.content.firstElementChild);
            c[i] = h;
        }
    });
    el._c = c;
}

const since = {};

export function sweep(room, fn) {
    for (const [id, p] of Object.entries(room.players || {})) {
        if (p.online === false) {
            if (!since[id]) {
                since[id] = Date.now();
            }
            if (Date.now() - since[id] > 45000) {
                fn(id);
            }
        } else {
            delete since[id];
        }
    }
}