import { db, ref, set, runTransaction, onValue, remove, onDisconnect } from "./firebase.js";
import { $, now, esc, code, pid, toast, sorted, presence, sweep, PMODES, pointsFor, hintRules, isWatcher, watchers } from "./common.js";

if (!code) {
    location.href = "index.html";
}

const roomRef = ref(db, "rooms/" + code);
let live = false;
let room = null;
let pres = null;
const pubRef = ref(db, "publicRooms/" + code);
let pubKey = "";
let pubAt = 0;

function publish(list) {
    if (!room || !room.public || room.host !== pid || room.status !== "lobby") {
        return;
    }
    const by = room.players[room.host] ? room.players[room.host].name : "";
    const key = list.length + "|" + by;
    const now = Date.now();
    if (key === pubKey && now - pubAt < 30000) {
        return;
    }
    pubKey = key;
    pubAt = now;
    set(pubRef, {
        topic: room.topic,
        size: room.size,
        by,
        n: list.length,
        created: room.created || now,
        ts: now
    }).catch(() => { });
}

const drop = (id, force) => runTransaction(roomRef, r => {
    if (r === null) {
        return r;
    }
    const p = r.players && r.players[id];
    if (!p || r.status !== "lobby" || (!force && p.online !== false)) {
        return;
    }
    delete r.players[id];
    const k = Object.keys(r.players);
    if (!k.length) {
        return null;
    }
    if (r.host === id) {
        r.host = k[0];
    }
    return r;
});

onValue(roomRef, s => {
    room = s.val();
    const watching = isWatcher(room);
    if (!room || !room.players || (!room.players[pid] && !watching)) {
        location.href = "index.html";
        return;
    }
    if (room.status === "playing") {
        location.href = "game.html?room=" + code;
        return;
    }
    if (room.status === "ended") {
        location.href = "results.html?room=" + code;
        return;
    }
    if (!live) {
        live = true;
        pres = presence(watching);
    }
    const list = sorted(room);
    const host = room.host === pid;
    $("#lcode").textContent = code;
    const hr = hintRules(room);
    const mins = Math.round((room.duration || 300000) / 60000);
    const pl = Array.from({ length: room.size }, (_, i) => pointsFor(room, i + 1)).join(", ");
    $("#ltopic").innerHTML = `${esc(room.topic)}, top ${room.size}<br><small class="mute">${mins} min · ${esc(PMODES[room.pmode] || "Top ranks most")} points · hints: ${hr.max ? hr.max + " each, " + (hr.cost ? "-" + hr.cost + " pts" : "free") : "off"}</small><br><small class="mute">Points by rank: ${pl}</small>`;
    $("#lplayers").innerHTML = list.map(p => `<li><span>${esc(p.name)}${p.id === room.host ? " (host)" : ""}</span><span class="mute">${p.online === false ? "away" : ""}</span></li>`).join("");
    const ws = watchers(room);
    if (ws.length) {
        $("#lplayers").innerHTML += `<li><span class="mute">Spectating: ${ws.map(w => esc(w.name)).join(", ")}</span></li>`;
    }
    $("#start").hidden = !host;
    $("#start").disabled = list.length < 2;
    $("#lnote").textContent = watching ? "You are spectating. The game opens for you when the host starts it." : list.length < 2 ? `Waiting for players (${list.length}/10). You need at least 2 to start.` : host ? `${list.length}/10 players ready.` : "Waiting for the host to start.";
    publish(list);
    sweep(room, id => drop(id, false));
});

setInterval(() => {
    if (room && room.players) {
        publish(sorted(room));
        sweep(room, id => drop(id, false));
    }
}, 3000);

$("#start").onclick = () => runTransaction(roomRef, r => {
    if (r === null) {
        return r;
    }
    if (r.status !== "lobby" || r.host !== pid || Object.keys(r.players).length < 2) {
        return;
    }
    r.status = "playing";
    r.startsAt = now() + 4000;
    r.endsAt = r.startsAt + (r.duration || 300000);
    return r;
}).then(x => {
    if (x.committed) {
        remove(pubRef).catch(() => { });
    } else {
        toast("Could not start the game");
    }
});

$("#leave").onclick = async () => {
    if (isWatcher(room)) {
        if (pres) {
            await onDisconnect(pres).cancel();
        }
        await remove(ref(db, `rooms/${code}/spectators/${pid}`));
        location.href = "index.html";
        return;
    }
    if (room && sorted(room).length <= 1) {
        await remove(pubRef).catch(() => { });
    }
    await drop(pid, true);
    location.href = "index.html";
};