import { db, ref, push } from "./firebase.js";
import { $, toast, getName } from "./common.js";

const parse = () => $("#entries").value.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf("|");
    const n = (i < 0 ? l : l.slice(0, i)).trim();
    const a = i < 0 ? [] : l.slice(i + 1).split(",").map(x => x.trim()).filter(Boolean);
    return {
        n,
        a
    };
});

function count() {
    const n = parse().length;
    const s = +$("#size").value;
    const c = $("#count");
    c.textContent = `${n} of ${s} entries`;
    c.className = "count " + (n === s ? "ok" : "mute");
}

$("#entries").oninput = count;
$("#size").onchange = count;
count();
const params = new URLSearchParams(location.search);

if (params.get("title")) {
    $("#title").value = params.get("title").slice(0, 40);
}

$("#save").onclick = async () => {
    const title = $("#title").value.trim();
    const size = +$("#size").value;
    const items = parse();
    if (!title) {
        return toast("Give your list a title");
    }
    if (items.length !== size) {
        return toast(`You need exactly ${size} entries, you have ${items.length}`);
    }
    const seen = new Set();
    for (const it of items) {
        if (!it.n) {
            return toast("Every line needs a name before the |");
        }
        if (it.n.length > 60 || it.a.some(x => x.length > 60)) {
            return toast("Names and spellings must be under 60 characters");
        }
        const k = it.n.toLowerCase();
        if (seen.has(k)) {
            return toast(`"${it.n}" appears twice`);
        }
        seen.add(k);
    }
    $("#save").disabled = true;
    try {
        const r = await push(ref(db, "lists"), {
            title,
            titleLower: title.toLowerCase(),
            size,
            items,
            by: getName() || "Anonymous",
            created: Date.now()
        });
        location.href = "index.html?list=" + r.key;
    }
    catch (e) {
        $("#save").disabled = false;
        toast("Could not save the list: " + e.message);
    }
};
