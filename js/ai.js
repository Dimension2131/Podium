import { GEMINI_MODELS } from "./config.js";
const BASE = "https://podium.rukshanyashitha4.workers.dev/v1beta/models";

const H = {
    "Content-Type": "application/json"
};

const SKIP = [404, 429, 500, 503];
let cached = null;
const good = {};
const cool = {};
const ver = n => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);

async function candidates() {
    if (cached) {
        return cached;
    }
    const r = await fetch(BASE + "?pageSize=1000", { headers: H });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
        console.error("Gemini ListModels failed", r.status, d);
        if (r.status === 400 || r.status === 401 || r.status === 403) {
            throw new Error("Gemini rejected the key (" + r.status + "): " + ((d.error && d.error.message) || "check the key and its restrictions"));
        }
        return {
            search: GEMINI_MODELS,
            plain: GEMINI_MODELS
        };
    }
    const names = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""));
    let gem = names.filter(n => /^gemini-\d+(\.\d+)?-flash/.test(n) && !/image|tts|live|audio|embedding|thinking|robotics|computer|native|exp|omni|transcribe|preview/.test(n) && ver(n) >= 3).sort((a, b) => {
        const la = /lite/.test(a);
        const lb = /lite/.test(b);
        if (la !== lb) {
            return la ? 1 : -1;
        }
        if (ver(a) !== ver(b)) {
            return ver(b) - ver(a);
        }
        return a.localeCompare(b);
    }).slice(0, 6);
    if (!gem.length) {
        gem = GEMINI_MODELS;
    }
    const gemma = names.filter(n => /^gemma-.*-it$/.test(n)).sort();
    const old25 = names.filter(n => /^gemini-2\.5-flash(-lite)?$/.test(n)).sort((a, b) => /lite/.test(a) - /lite/.test(b));
    cached = {
        search: [...old25, ...gem],
        plain: [...gem, ...gemma]
    };
    console.log("Gemini models to try:", cached);
    return cached;
}

async function ask(model, prompt, search) {
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (search) {
        body.tools = [{ google_search: {} }];
    }
    const res = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: H,
        body: JSON.stringify(body)
    });
    const d = await res.json().catch(() => ({}));
    return {
        res,
        d
    };
}

async function run(models, prompt, search) {
    const mode = search ? "s" : "p";
    const g = good[mode];
    const order = g && models.includes(g) ? [g, ...models.filter(m => m !== g)] : models;
    let last = null;
    let quota = false;
    let searchFails = 0;
    for (const model of order) {
        if ((cool[model + mode] || 0) > Date.now()) {
            quota = true;
            continue;
        }
        const out = await ask(model, prompt, search);
        if (out.res.ok) {
            good[mode] = model;
            console.log("Gemini used:", model, search ? "(with search)" : "(no search)");
            return {
                out,
                quota
            };
        }
        last = out;
        const s = out.res.status;
        console.warn("Gemini", s, "for", model, search ? "(search)" : "(no search)", "-", out.d.error && out.d.error.message);
        if (s === 404) {
            cool[model + "s"] = cool[model + "p"] = Infinity;
        } else if (s === 429) {
            quota = true;
            cool[model + mode] = Date.now() + 60000;
            if (search && ++searchFails >= 2) {
                break;
            }
        } else if (s === 500 || s === 503) {
            cool[model + mode] = Date.now() + 10000;
        }
        if (!SKIP.includes(s)) {
            break;
        }
    }
    if (!last) {
        last = {
            res: {
                ok: false,
                status: 429
            },
            d: { error: { message: "Every model is cooling down after quota errors. Wait a minute." } }
        };
    }
    return {
        out: last,
        quota
    };
}

const mk = (topic, size, search) => `${search ? `Find the most widely cited ranking for: "${topic}". Use current web sources.` : `Give the most widely cited ranking you know for: "${topic}".`} Return exactly ${size} entries, rank 1 first. Reply with JSON only, no markdown, in this shape: {"title":"short list title under 40 characters","items":[{"n":"Name","a":["alternate spelling or nickname"]}]}. Each n is a short name under 60 characters with no rank numbers or notes, with no duplicates. a is optional and holds at most 3 short alternates.`;

export async function generate(topic, size) {
    const m = await candidates();
    let r = await run(m.search, mk(topic, size, true), true);
    if (!r.out.res.ok && r.quota) {
        console.warn("Search quota exhausted on every model. Retrying without Search (answers from model memory).");
        r = await run(m.plain, mk(topic, size, false), false);
    }
    const { res, d } = r.out;
    if (!res.ok) {
        console.error("Gemini error", res.status, d);
        const msg = String((d.error && d.error.message) || "no details").slice(0, 160);
        if (res.status === 429) {
            throw new Error("No Gemini model has free quota left for this key. Check ai.dev/rate-limit. " + msg);
        }
        throw new Error("Gemini error " + res.status + ": " + msg);
    }
    const cand = d.candidates && d.candidates[0];
    if (!cand) {
        console.error("Gemini empty response", d);
        throw new Error("Gemini returned nothing" + (d.promptFeedback && d.promptFeedback.blockReason ? " (blocked: " + d.promptFeedback.blockReason + ")" : ", try again"));
    }
    const parts = (cand.content && cand.content.parts || []).filter(p => !p.thought);
    const text = parts.map(p => p.text || "").join("");
    let j;
    try {
        j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    }
    catch (e) {
        console.error("Unparsable Gemini text:", text);
        throw new Error("Gemini did not return a usable list, try again");
    }
    const seen = new Set();
    const items = [];
    for (const x of j.items || []) {
        const n = String(x.n || "").trim().slice(0, 60);
        if (!n || seen.has(n.toLowerCase())) {
            continue;
        }
        seen.add(n.toLowerCase());
        items.push({
            n,
            a: (Array.isArray(x.a) ? x.a : []).map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 3)
        });
    }
    if (items.length < size) {
        throw new Error(`Gemini returned only ${items.length} usable entries, try again`);
    }
    return {
        title: String(j.title || topic).trim().slice(0, 40),
        size,
        items: items.slice(0, size),
        by: "AI"
    };
}
