import { db, ref, get, onValue, query, limitToLast } from "./firebase.js";
import { $, esc, code, sorted, isPlayer, isWatcher, pointsFor } from "./common.js";

if (!code) {
    location.href = "index.html";
}

$("#back").href = "results.html?room=" + code;

const COLORS = ["#8b5cf6", "#22d3ee", "#f5c451", "#fb7185", "#34d399", "#fb923c", "#60a5fa", "#f472b6", "#a3e635", "#c084fc"];
const fmt = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const secs = ms => ms < 10000 ? (ms / 1000).toFixed(1) + "s" : fmt(ms);
const names = list => list.map(p => esc(p.name)).join(" & ");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

let latest = "";
let bounce = 0;
let drawn = false;

onValue(ref(db, "rooms/" + code), async s => {
    const room = s.val();
    if (!room || !room.players || !(isPlayer(room) || isWatcher(room))) {
        location.replace("index.html");
        return;
    }
    latest = room.status;
    if (room.status !== "ended") {
        clearTimeout(bounce);
        bounce = setTimeout(() => {
            if (latest !== "ended") {
                location.replace((latest === "lobby" ? "lobby" : "game") + ".html?room=" + code);
            }
        }, 1500);
        return;
    }
    clearTimeout(bounce);
    if (drawn) {
        return;
    }
    drawn = true;
    let chat = [];
    try {
        const c = await get(query(ref(db, "chats/" + code), limitToLast(1000)));
        chat = Object.values(c.val() || {});
    } catch (e) { }
    draw(room, chat);
});

function draw(room, chat) {
    const list = sorted(room);
    const color = {};
    list.forEach((p, i) => color[p.id] = COLORS[i % COLORS.length]);
    const rev = room.revealed || {};
    const at = room.revealedAt || {};
    const start = room.startsAt || 0;
    const timed = !!start && Object.keys(at).length > 0;
    const found = [];
    for (let r = 1; r <= room.size; r++) {
        const by = rev["r" + r];
        if (by && room.players[by]) {
            found.push({ r, by, t: at["r" + r] || 0, name: room.items[r - 1].n });
        }
    }
    const missing = [];
    for (let r = 1; r <= room.size; r++) {
        if (!rev["r" + r]) {
            missing.push({ r, name: room.items[r - 1].n });
        }
    }
    const gaveUp = list.filter(p => p.active === false);
    const watching = Object.values(room.spectators || {}).filter(x => x && x.name).length;
    const endAt = room.endedAt || (found.length ? Math.max(...found.map(f => f.t)) : 0);
    const played = timed && endAt > start ? endAt - start : 0;

    $("#sub").textContent = `${room.topic}, top ${room.size} · ${plural(list.length, "player")}${watching ? " · " + plural(watching, "spectator") : ""}`;

    const sum = [
        [`${found.length}/${room.size}`, "found"],
        played ? [fmt(played), "played"] : null,
        gaveUp.length ? [String(gaveUp.length), "gave up"] : null,
        watching ? [String(watching), "watching"] : null
    ].filter(Boolean).map(([a, b]) => `<div class="sum"><b>${a}</b><span>${b}</span></div>`).join("");

    const board = Array.from({ length: room.size }, (_, i) => {
        const r = i + 1;
        const by = rev["r" + r];
        const p = by && room.players[by];
        return p ? `<div class="sq" style="--c:${color[by]}" title="${esc(p.name)}"><b>#${r}</b><small>${esc(p.name)}</small></div>` : `<div class="sq empty" title="Never found"><b>#${r}</b><small>-</small></div>`;
    }).join("");

    const tiles = [];
    const tile = (cls, label, big, line) => tiles.push(`<div class="tile ${cls}"><small>${label}</small><b>${big}</b><span>${line}</span></div>`);

    const pickMax = (rows, key) => {
        const m = Math.max(...rows.map(key));
        return m > 0 ? rows.filter(x => key(x) === m) : [];
    };

    const low = list.map(p => ({ ...p, n: found.filter(f => f.by === p.id && f.r > room.size / 2).length }));
    const dd = pickMax(low, p => p.n);
    if (dd.length) {
        tile("gold", "Deep Diver", names(dd), `${plural(dd[0].n, "entry")} in the lower half`);
    }

    if (timed) {
        const ev = found.filter(f => f.t).sort((a, b) => a.t - b.t);
        const gaps = ev.map((f, i) => ({ ...f, gap: f.t - (i ? ev[i - 1].t : start) }));
        if (gaps.length) {
            const fast = gaps.reduce((a, b) => b.gap < a.gap ? b : a);
            tile("silver", "Speedrunner", esc(room.players[fast.by].name), `#${fast.r} in ${secs(fast.gap)}`);
            const f1 = ev[0];
            tile("bronze", "First Guess", esc(room.players[f1.by].name), `#${f1.r} at ${fmt(f1.t - start)}`);
            const fl = ev[ev.length - 1];
            tile("gold", "Last Man Standing", esc(room.players[fl.by].name), `#${fl.r} at ${fmt(fl.t - start)}`);
            if (room.endsAt) {
                const cl = list.map(p => ({ ...p, n: ev.filter(f => f.by === p.id && f.t >= room.endsAt - 30000).length }));
                const cw = pickMax(cl, p => p.n);
                if (cw.length) {
                    tile("silver", "Clutch Up", names(cw), `${plural(cw[0].n, "guess")} in the last 30s`);
                }
            }
        }
    }

    const ct = {};
    const nm = {};
    for (const m of chat) {
        if (m && !m.s && m.u) {
            ct[m.u] = (ct[m.u] || 0) + 1;
            nm[m.u] = m.n || nm[m.u];
        }
    }
    const top = Math.max(0, ...Object.values(ct));
    if (top > 0) {
        const w = Object.keys(ct).filter(k => ct[k] === top).map(k => esc((room.players[k] || (room.spectators || {})[k] || {}).name || nm[k] || "Someone"));
        tile("bronze", "Chatty", w.join(" &amp; "), `${plural(top, "message")}`);
    }

    const gu = gaveUp.filter(p => p.gaveUpAt).sort((a, b) => a.gaveUpAt - b.gaveUpAt);
    if (gu.length) {
        tile("coral", "Quitter", esc(gu[0].name), start ? `gave up at ${fmt(gu[0].gaveUpAt - start)}` : "first to give up");
        if (gu.length >= 2) {
            const l = gu[gu.length - 1];
            tile("coral", "Couldn't Last Longer", esc(l.name), start ? `gave up at ${fmt(l.gaveUpAt - start)}` : "last to give up");
        }
    }

    const wide = [];
    if (timed) {
        const ev = found.filter(f => f.t).sort((a, b) => a.t - b.t);
        const gaps = ev.map((f, i) => ({ ...f, gap: f.t - (i ? ev[i - 1].t : start) }));
        if (gaps.length) {
            const hd = gaps.reduce((a, b) => b.gap > a.gap ? b : a);
            wide.push(`<div class="tile wide gold"><small>Hardest to Find</small><b>${esc(hd.name)} <em>#${hd.r}</em></b><span>${esc(room.players[hd.by].name)} · took ${secs(hd.gap)} to appear after the previous answer</span></div>`);
        }
    }
    if (missing.length) {
        wide.push(`<div class="tile wide ghost"><small>Never found</small><div class="nf">${missing.map(m => `<i>#${m.r} ${esc(m.name)}</i>`).join("")}</div></div>`);
    }

    const rows = list.map(p => {
        const mine = found.filter(f => f.by === p.id);
        const sq = Array.from({ length: room.size }, (_, i) => `<i class="${mine.some(f => f.r === i + 1) ? "on" : ""}"></i>`).join("");
        return `<div class="prow" style="--c:${color[p.id]}"><span class="dot"></span><b>${esc(p.name)}</b><div class="pq" style="--n:${room.size}">${sq}</div><span class="mute">${mine.length}/${room.size} · ${p.score} pts</span></div>`;
    }).join("");

    let race = "";
    if (timed && played) {
        const W = 640, H = 240, L = 34, B = 24, T = 10, R = 10;
        const pts = {};
        let max = 1;
        list.forEach(p => pts[p.id] = [[0, 0]]);
        for (const f of found.filter(f => f.t).sort((a, b) => a.t - b.t)) {
            const a = pts[f.by];
            const v = a[a.length - 1][1] + pointsFor(room, f.r);
            a.push([f.t - start, v]);
            max = Math.max(max, v);
        }
        const X = t => L + (t / played) * (W - L - R);
        const Y = v => H - B - (v / max) * (H - B - T);
        const paths = list.map(p => {
            const a = pts[p.id];
            let d = `M${X(0)} ${Y(0)}`;
            for (let i = 1; i < a.length; i++) {
                d += ` H${X(Math.min(a[i][0], played)).toFixed(1)} V${Y(a[i][1]).toFixed(1)}`;
            }
            d += ` H${X(played)}`;
            return `<path d="${d}" pathLength="1" style="stroke:${color[p.id]}"/>`;
        }).join("");
        const grid = [0, .5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${Y(max * f)}" y2="${Y(max * f)}"/><text x="${L - 6}" y="${Y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join("");
        race = `<h2>Score race</h2><div class="tile wide race"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points from answers over time">${grid}<g class="lines">${paths}</g><text x="${L}" y="${H - 6}">0:00</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmt(played)}</text></svg><div class="legend">${list.map(p => `<span style="--c:${color[p.id]}"><i></i>${esc(p.name)}</span>`).join("")}</div></div>`;
    }

    $("#sbody").innerHTML = `<div class="sums">${sum}</div>
<h2>Board map</h2><div class="bmap">${board}</div>
${tiles.length ? `<h2>Highlights</h2><div class="tiles">${tiles.join("")}</div>` : ""}
${wide.length ? `<div class="tiles one">${wide.join("")}</div>` : ""}
<h2>Entries per player</h2><div class="prows">${rows}</div>
${race}
${timed ? "" : `<p class="mute">Timing stats (Speedrunner, Clutch Up and others) only appear for games played after they were added.</p>`}
<p class="mute foot">The podium is decided by points. These are just for fun.</p>`;
}
