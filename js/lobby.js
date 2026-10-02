import { db, ref, runTransaction, onValue } from "./firebase.js";
import { $, esc, code, pid, toast, sorted, presence, sweep, PMODES, pointsFor, hintRules } from "./common.js";

if (!code) {
    location.href = "index.html";
}

const roomRef = ref(db, "rooms/" + code);
let live = false;
let room = null;

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
    if (!room || !room.players || !room.players[pid]) {
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
        presence();
    }
    const list = sorted(room);
    const host = room.host === pid;
    $("#lcode").textContent = code;
    const hr = hintRules(room);
    const mins = Math.round((room.duration || 300000) / 60000);
    const pl = Array.from({ length: room.size }, (_, i) => pointsFor(room, i + 1)).join(", ");
    $("#ltopic").innerHTML = `${esc(room.topic)}, top ${room.size}<br><small class="mute">${mins} min · ${esc(PMODES[room.pmode] || "Top ranks most")} points · hints: ${hr.max ? hr.max + " each, " + (hr.cost ? "-" + hr.cost + " pts" : "free") : "off"}</small><br><small class="mute">Points by rank: ${pl}</small>`;
    $("#lplayers").innerHTML = list.map(p => `<li><span>${esc(p.name)}${p.id === room.host ? " (host)" : ""}</span><span class="mute">${p.online === false ? "away" : ""}</span></li>`).join("");
    $("#start").hidden = !host;
    $("#start").disabled = list.length < 2;
    $("#lnote").textContent = list.length < 2 ? `Waiting for players (${list.length}/10). You need at least 2 to start.` : host ? `${list.length}/10 players ready.` : "Waiting for the host to start.";
    sweep(room, id => drop(id, false));
});

setInterval(() => room && sweep(room, id => drop(id, false)), 3000);

$("#start").onclick = () => runTransaction(roomRef, r => {
    if (r === null) {
        return r;
    }
    if (r.status !== "lobby" || r.host !== pid || Object.keys(r.players).length < 2) {
        return;
    }
    r.status = "playing";
    r.endsAt = Date.now() + (r.duration || 300000);
    return r;
}).then(x => {
    if (!x.committed) {
        toast("Could not start the game");
    }
});

$("#leave").onclick = async () => {
    await drop(pid, true);
    location.href = "index.html";
};
