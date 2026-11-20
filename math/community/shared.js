// Shared code for /math/community/ (board) and /math/community/puzzles/.
// Data lives in a Google Sheet behind an Apps Script web app
// (_source/math/community/community.gs, inside the challenges board's Apps Script project). Every request carries the passcode from the link;
// without it the script returns nothing, so the page itself holds no names or data.
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyS20GsOgEa4RmLN70IJMo9CbRrYAgXEQhhKJD_lJtLeKubasJCF-kgY3kS53q1Mqz_/exec';

// Community members, from the sheet ("חברים" tab): d = shown name, f = first names, s = surnames (duplicates only).
let MEMBERS = [];
const LEADERS = ['תאיר', 'לירון'];

function normName(s) {
    return String(s || '').replace(/[׳’`]/g, "'").replace(/["״]/g, '').replace(/\s+/g, ' ').trim();
}
// Typed full name -> { status: 'empty' | 'ok' | 'ambiguous' | 'unknown', display, typed }
// Unknown names are accepted too (shown as typed).
function resolveName(typed) {
    const t = normName(typed);
    if (!t) return { status: 'empty', display: '', typed: '' };
    const words = t.split(' ');
    let cands = MEMBERS.filter(m => m.f.some(f => words.includes(f)));
    if (cands.length > 1) {
        const bySurname = cands.filter(m => m.s && m.s.some(s => words.includes(s)));
        if (bySurname.length === 1) cands = bySurname;
        else return { status: 'ambiguous', display: '', typed: t, options: cands.map(m => m.d) };
    }
    if (cands.length === 1) return { status: 'ok', display: cands[0].d, typed: t };
    return { status: 'unknown', display: t, typed: t };
}

function sortedNames(names) {
    const lead = LEADERS.filter(n => names.includes(n));
    return lead.concat(names.filter(n => !LEADERS.includes(n)).sort((a, b) => a.localeCompare(b, 'he')));
}

// ---- Who am I: remembered for the whole site (same origin = all gifted-teachers-il pages) ----
const ME_KEY = 'gti-me';
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function safeDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function getMe() { try { const m = JSON.parse(safeGet(ME_KEY)); return m && m.display ? m : null; } catch (e) { return null; } }
function setMe(m) { m ? safeSet(ME_KEY, JSON.stringify({ typed: m.typed, display: m.display })) : safeDel(ME_KEY); }

// "שם מלא" field with a live check under it. Prefilled from the browser.
// field.get() -> resolved name or null (and shows why); field.input = the <input>.
function mountNameField(box, id) {
    box.className = 'field-group';
    box.innerHTML = `<label for="${id}">שם מלא <span class="required">*</span></label>
        <input type="text" id="${id}" class="name-input" autocomplete="name">
        <div class="name-status" aria-live="polite"></div>`;
    const input = box.querySelector('input'), status = box.querySelector('.name-status');
    const me = getMe();
    if (me) input.value = me.typed;
    function check(final) {
        const r = resolveName(input.value);
        status.className = 'name-status';
        if (r.status === 'ambiguous') {
            status.textContent = 'יש בקהילה ' + r.options.join(' ו') + ' – נא לכתוב גם שם משפחה.';
            status.classList.add(final ? 'bad' : 'info');
        } else if (r.status === 'unknown' && final) {
            status.textContent = 'השם לא מופיע ברשימת הקהילה שלנו – זה בסדר, הוא יוצג כפי שנכתב.';
            status.classList.add('info');
        } else if (r.status === 'ok' && r.display !== r.typed) {
            status.textContent = 'יוצג בלוח: ' + r.display;
        } else status.textContent = '';
        return r;
    }
    input.addEventListener('input', () => check(false));
    input.addEventListener('blur', () => check(true));
    if (input.value) check(false);
    return {
        input,
        get() {
            const r = check(true);
            if (r.status === 'empty' || r.status === 'ambiguous') return null;
            setMe(r);
            return r;
        }
    };
}

// ---- Store: the Apps Script web app ----
// A random token per browser marks what this browser created (only its hash is kept in the sheet),
// so a card or a mark can be changed only from where it was made.
const TOKEN_KEY = 'gti-token';
function myToken() {
    let t = safeGet(TOKEN_KEY);
    if (!t) {
        t = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()).replace(/-/g, '');
        safeSet(TOKEN_KEY, t);
    }
    return t;
}
async function api(action, extra) {
    const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request: no CORS preflight
        body: JSON.stringify(Object.assign({ app: 'community', action, k: safeGet(KEY_STORE) || '', t: myToken() }, extra || {}))
    });
    return res.json();
}
function apiError(d) { const e = new Error(d.error || 'server'); e.code = d.error; return e; }
const Store = {
    async all() { return api('all'); },                       // {ok, members, cards, puzzles, wants} or {ok:false, error:'key'}
    async addPuzzle(p) { const d = await api('addPuzzle', { puzzle: p }); if (!d.ok) throw apiError(d); return d.id; },
    async saveCard(c) { const d = await api('saveCard', { card: c }); if (!d.ok) throw apiError(d); },
    async toggleWant(id, name) { const d = await api('toggleWant', { id, name }); if (!d.ok) throw apiError(d); return d.names; }
};

// ---- Helpers ----
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Text with line breaks; $...$ is rendered by KaTeX afterwards (renderMath).
function textHtml(s) { return esc(s).replace(/\n/g, '<br>'); }
function renderMath(el) {
    if (window.renderMathInElement) {
        renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
    }
}
function memberId(name) {   // stable id for #links, also for names not on the list
    let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return 'm-' + h.toString(36);
}

// Reads an image file and returns a downscaled JPEG data URL (longest side <= maxSide).
function shrinkImage(file, maxSide) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const s = Math.min(1, maxSide / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
            const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            g.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(img.src);
            resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// ---- Passcode gate (both pages). Remembered; arrives in the link as #k=... ----
// The script checks it; loads the data and calls onData(data).
const KEY_STORE = 'gti-board-key';
function boot(onData) {
    const hk = location.hash.match(/^#k=([^&]+)/);
    if (hk) { safeSet(KEY_STORE, decodeURIComponent(hk[1])); history.replaceState(null, '', location.pathname + location.search); }
    const gate = document.getElementById('gate');
    gate.hidden = false;

    function showGate(wrong) {
        gate.innerHTML = `<div class="gate-card">
            <div class="gate-icon">🔒</div>
            <h1>הדף סגור לחברות וחברי הקהילה</h1>
            <p>הכניסה היא דרך הקישור שקיבלת בקבוצה. אפשר גם להקליד כאן את מילת הקוד.</p>
            <form><input type="text" placeholder="מילת קוד" aria-label="מילת קוד" autocomplete="off"><button class="pill-btn" type="submit">כניסה</button></form>
            <div class="error-message"${wrong ? ' style="display:block"' : ''}>מילת הקוד לא נכונה.</div></div>`;
        gate.querySelector('form').onsubmit = e => {
            e.preventDefault();
            safeSet(KEY_STORE, gate.querySelector('input').value.trim());
            load(true);
        };
    }
    async function load(typed) {
        if (!safeGet(KEY_STORE)) return showGate(false);
        gate.innerHTML = '<div class="loading">טוען…</div>';
        let d;
        try { d = await Store.all(); }
        catch (e) {
            gate.innerHTML = '<div class="gate-card"><h1>משהו השתבש בטעינה</h1><p>כדאי לרענן את הדף בעוד רגע. אם זה חוזר – כתבו לנו.</p></div>';
            return;
        }
        if (!d.ok && d.error === 'key') { if (!typed) safeDel(KEY_STORE); return showGate(typed); }
        if (!d.ok) { gate.innerHTML = '<div class="gate-card"><h1>משהו השתבש בטעינה</h1><p>כדאי לרענן את הדף בעוד רגע. אם זה חוזר – כתבו לנו.</p></div>'; return; }
        MEMBERS = d.members || [];
        gate.hidden = true;
        onData(d);
    }
    load(false);
}

// ---- Profile card (board grid + popup on the puzzles page) ----
function profileHtml(c) {
    const n = c.name;
    const phone = c.phoneOk && c.phone ? c.phone.replace(/[^\d+]/g, '') : '';
    const wa = phone ? '972' + phone.replace(/^\+?972|^0/, '') : '';
    return `${c.photo ? `<img class="pf-photo" src="${c.photo}" alt="${esc(n)}">` : `<div class="pf-photo pf-initial">${esc(n[0])}</div>`}
        <div class="pf-name">${esc(n)}</div>
        <div class="pf-about">${textHtml(c.about)}</div>
        ${c.collab ? `<div class="pf-collab"><span class="pf-h">אשמח לשיתופי פעולה</span>${textHtml(c.collab)}</div>` : ''}
        ${phone ? `<div class="pf-contact"><a class="pf-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">וואטסאפ</a><a class="pf-btn light" href="tel:${esc(phone)}"><span dir="ltr">${esc(c.phone)}</span></a></div>` : ''}`;
}

// ---- Simple popup ----
function openModal(innerHtml, cls) {
    let back = document.getElementById('gtiModal');
    if (!back) {
        back = document.createElement('div');
        back.id = 'gtiModal'; back.className = 'modal-back';
        back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true');
        back.addEventListener('click', e => { if (e.target === back) closeModal(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
        document.body.appendChild(back);
    }
    back.innerHTML = `<div class="modal ${cls || ''}"><button type="button" class="modal-x" aria-label="סגירה">×</button>${innerHtml}</div>`;
    back.querySelector('.modal-x').onclick = closeModal;
    back.classList.add('open');
    return back.querySelector('.modal');
}
function closeModal() { const b = document.getElementById('gtiModal'); if (b) b.classList.remove('open'); }

// Asks for the full name in a popup (when needed before an action). Resolves to the name or null.
function askName(why) {
    return new Promise(resolve => {
        const m = openModal(`<h2>מה שמך?</h2><p>${esc(why)}</p><form><div></div><button class="pill-btn" type="submit">שמירה</button></form>`);
        const f = mountNameField(m.querySelector('form div'), 'askName');
        f.input.focus();
        m.querySelector('form').onsubmit = e => { e.preventDefault(); const r = f.get(); if (r) { closeModal(); resolve(r); } };
    });
}
