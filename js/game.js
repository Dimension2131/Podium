import { db, ref, push, runTransaction, onValue, onChildAdded, query, limitToLast } from "./firebase.js";
import { $, esc, code, pid, toast, match, settle, sorted, presence, pointsFor, hintRules } from "./common.js";

if (!code) {
    location.href = "index.html";
}

const roomRef = ref(db, "rooms/" + code);
const chatRef = ref(db, "chats/" + code);
let room = null;
let live = false;
let hintLog = [];
const hinted = new Set();

const say = o => push(chatRef, {
    ...o,
    ts: Date.now()
});

const end = () => runTransaction(roomRef, r => {
    if (r === null) {
        return r;
    }
    if (r.status !== "playing") {
        return;
    }
    r.status = "ended";
    return r;
});

onValue(roomRef, s => {
    room = s.val();
    if (!room || !room.players || !room.players[pid]) {
        location.href = "index.html";
        return;
    }
    if (room.status === "lobby") {
        location.href = "lobby.html?room=" + code;
        return;
    }
    if (room.status === "ended") {
        location.href = "results.html?room=" + code;
        return;
    }
    if (!live) {
        live = true;
        presence();
    }
    render();
    check();
});

onChildAdded(query(chatRef, limitToLast(100)), s => {
    const v = s.val();
    const p = document.createElement("p");
    if (v.s) {
        p.className = "sys";
        p.textContent = v.t;
    } else {
        p.innerHTML = `<b>${esc(v.n)}:</b> `;
        p.append(document.createTextNode(v.t));
    }
    const c = $("#chat");
    c.append(p);
    c.scrollTop = c.scrollHeight;
});

function check() {
    if (!room || room.status !== "playing") {
        return;
    }
    const a = Object.values(room.players).filter(x => x.active).length;
    if (a === 0 || Object.keys(room.revealed || {}).length >= room.size || Date.now() >= room.endsAt) {
        end();
    }
}

setInterval(() => {
    if (!room) {
        return;
    }
    const left = Math.max(0, (room.endsAt || 0) - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor(left % 60000 / 1000);
    $("#timer").textContent = `${m}:${String(s).padStart(2, "0")}`;
    check();
}, 1000);

function render() {
    const me = room.players[pid];
    const spec = !me.active;
    const rev = room.revealed || {};
    $("#gtitle").textContent = `${room.topic}, top ${room.size}${spec ? " (spectating)" : ""}`;
    $("#gscore").innerHTML = sorted(room).map(p => `<span class="chip${p.active ? "" : " out"}${p.id === pid ? " me" : ""}">${esc(p.name)} ${p.score}</span>`).join("");
    let h = "";
    for (let r = 1; r <= room.size; r++) {
        const it = room.items[r - 1];
        const by = rev["r" + r];
        const pts = pointsFor(room, r);
        if (by) {
            h += `<div class="box open"><b>#${r} · ${pts} pts</b><span>${esc(it.n)}</span><small>${esc(room.players[by] ? room.players[by].name : "")}</small></div>`;
        } else if (spec) {
            h += `<div class="box ghost"><b>#${r}</b><span>${esc(it.n)}</span></div>`;
        } else {
            h += `<div class="box lock"><b>#${r} · ${pts} pts</b><span>?</span></div>`;
        }
    }
    $("#grid").innerHTML = h;
    $("#hints").innerHTML = hintLog.map(x => `<div>${esc(x)}</div>`).join("");
    const hr = hintRules(room);
    $("#hint").hidden = hr.max === 0;
    $("#hint").textContent = `Hint (${Math.max(0, hr.max - (me.hints || 0))} left${hr.cost ? `, -${hr.cost} pt${hr.cost > 1 ? "s" : ""}` : ", free"})`;
    $("#hint").disabled = spec || (me.hints || 0) >= hr.max;
    $("#giveup").disabled = spec;
    $("#msg").placeholder = spec ? "Chat with other players" : "Type a name to guess it";
}

async function send() {
    const t = $("#msg").value.trim().slice(0, 100);
    $("#msg").value = "";
    if (!t || !room) {
        return;
    }
    const me = room.players[pid];
    const i = match(t, room.items);
    if (i >= 0) {
        if (!me.active) {
            return toast("Spectators can't reveal answers");
        }
        if ((room.revealed || {})["r" + (i + 1)]) {
            return toast("Already guessed");
        }
        const pts = pointsFor(room, i + 1);
        const key = "r" + (i + 1);
        const res = await runTransaction(roomRef, r => {
            if (r === null) {
                return r;
            }
            const p = r.players && r.players[pid];
            if (r.status !== "playing" || !p || !p.active) {
                return;
            }
            r.revealed = r.revealed || {};
            if (r.revealed[key]) {
                return;
            }
            r.revealed[key] = pid;
            p.score = (p.score || 0) + pts;
            return settle(r);
        });
        if (res.committed) {
            say({
                s: 1,
                t: `${me.name} guessed #${i + 1}: ${room.items[i].n} (+${pts})`
            });
        } else {
            toast("Someone was faster");
        }
        return;
    }
    say({
        u: pid,
        n: me.name,
        t,
        s: 0
    });
}

$("#send").onclick = send;

$("#msg").onkeydown = e => {
    if (e.key === "Enter") {
        send();
    }
};

$("#hint").onclick = async () => {
    const me = room.players[pid];
    if (!me.active || (me.hints || 0) >= hintRules(room).max) {
        return;
    }
    const rev = room.revealed || {};
    const open = [];
    for (let r = 1; r <= room.size; r++) {
        if (!rev["r" + r]) {
            open.push(r);
        }
    }
    if (!open.length) {
        return;
    }
    const fresh = open.filter(r => !hinted.has(r));
    const pool = fresh.length ? fresh : open;
    const r = pool[Math.random() * pool.length | 0];
    const nm = room.items[r - 1].n;
    const res = await runTransaction(roomRef, x => {
        if (x === null) {
            return x;
        }
        const p = x.players[pid];
        const hr = hintRules(x);
        if (x.status !== "playing" || !p || !p.active || (p.hints || 0) >= hr.max) {
            return;
        }
        p.hints = (p.hints || 0) + 1;
        p.score = Math.max(0, (p.score || 0) - hr.cost);
        return x;
    });
    if (!res.committed) {
        return;
    }
    hinted.add(r);
    const w = nm.split(" ").length;
    hintLog.push(`Rank #${r} starts with "${nm[0].toUpperCase()}", ${w} word${w > 1 ? "s" : ""}, ${nm.replace(/ /g, "").length} letters`);
    render();
};

$("#giveup").onclick = async () => {
    if (!confirm("Give up? You will reveal every answer and become a spectator.")) {
        return;
    }
    const name = room.players[pid].name;
    await runTransaction(roomRef, r => {
        if (r === null) {
            return r;
        }
        if (r.status !== "playing" || !r.players[pid] || !r.players[pid].active) {
            return;
        }
        r.players[pid].active = false;
        return settle(r);
    });
    say({
        s: 1,
        t: `${name} gave up`
    });
};
