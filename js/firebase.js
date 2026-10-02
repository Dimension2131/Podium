import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import * as d from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./config.js";
const app = initializeApp(firebaseConfig);
export const db = d.getDatabase(app);

export const {
    ref,
    get,
    set,
    push,
    remove,
    onValue,
    onChildAdded,
    onDisconnect,
    runTransaction,
    query,
    limitToLast
} = d;
