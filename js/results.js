import { db, ref, onValue } from "./firebase.js";
import { $, esc, code, pid, sorted } from "./common.js";

if (!code) {
    location.href = "index.html";
}

onValue(ref(db, "rooms/" + code), s => {
    const room = s.val();
    if (!room || !room.players || !room.players[pid]) {
        location.href = "index.html";
        return;
    }
    if (room.status !== "ended") {
        location.href = (room.status === "lobby" ? "lobby" : "game") + ".html?room=" + code;
        return;
    }
    const list = sorted(room);
    const rev = room.revealed || {};
    $("#podium").innerHTML = [["p2", 1], ["p1", 0], ["p3", 2]].filter(([, i]) => list[i]).map(([c, i]) => `<div class="pod ${c}"><h2>${i + 1}</h2><div>${esc(list[i].name)}</div><div>${list[i].score} pts</div></div>`).join("");
    let h = "";
    for (let r = 1; r <= room.size; r++) {
        const by = rev["r" + r];
        h += `<div class="box ${by ? "open" : "ghost"}"><b>#${r}</b><span>${esc(room.items[r - 1].n)}</span><small>${by && room.players[by] ? esc(room.players[by].name) : "Not guessed"}</small></div>`;
    }
    $("#answers").innerHTML = h;
});
