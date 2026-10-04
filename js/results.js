import { db, ref, onValue } from "./firebase.js";
import { $, esc, code, sorted, isPlayer, isWatcher, setHtml, patch } from "./common.js";

if (!code) {
    location.href = "index.html";
}

let latest = "";
let bounce = 0;

onValue(ref(db, "rooms/" + code), s => {
    const room = s.val();
    if (!room || !room.players || !(isPlayer(room) || isWatcher(room))) {
        location.href = "index.html";
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
    $("#statsbtn").href = "stats.html?room=" + code;
    const list = sorted(room);
    const rev = room.revealed || {};
    setHtml($("#podium"), [["p2", 1], ["p1", 0], ["p3", 2]].filter(([, i]) => list[i]).map(([c, i]) => `<div class="pod ${c}"><h2>${i + 1}</h2><div>${esc(list[i].name)}</div><div>${list[i].score} pts</div></div>`).join(""));
    const h = [];
    for (let r = 1; r <= room.size; r++) {
        const by = rev["r" + r];
        h.push(`<div class="box ${by ? "open" : "ghost"}"><b>#${r}</b><span>${esc(room.items[r - 1].n)}</span><small>${by && room.players[by] ? esc(room.players[by].name) : "Not guessed"}</small></div>`);
    }
    patch($("#answers"), h);
});