/* ==========================================
   TIERRA — TERRESTRIAL ANALOG EXPLORER
   Research records : locations.json (source of truth, schema v2)
   Local edits      : browser localStorage (merged on top of the JSON)
   Custom markers   : browser localStorage (never research records)
   Sections: 1 Constants | 2 Map | 3 Data model | 4 Data loading | 5 Local storage
             6 Custom markers | 7 Filters | 8 Selection | 9 Overview | 10 Record view
             11 Comparison viewer | 12 Record editor | 13 Methodology | 14 Data manager
             15 Windows | 16 Notes | 17 Add location | 18 Controls | 19 Divider | 20 Init
========================================== */

(function () {
    "use strict";

    /* ---------- 1. CONSTANTS ---------- */

    // JSON file is looked up relative to index.html, in this order.
    const DATA_PATHS = ["locations.json", "data/locations.json"];

    // Overview GIF path or data URL (leave empty until you add your GIF, e.g. "images/overview.gif")
    const OVERVIEW_GIF_SRC = "images/overview.gif";

    const LS = {
        records: "tierra.localRecords.v2",
        method: "tierra.methodology.v2",
        notes: "tierra.notes.v1",
        custom: "tierra.customLocations.v1"
    };

    const MOBILE_QUERY = window.matchMedia("(max-width: 850px)");
    const $ = (id) => document.getElementById(id);

    const BODIES = [
        { key: "moon", label: "Moon" },
        { key: "mars", label: "Mars" }
    ];

    // The eight analogue characteristics. Add a row here to add a characteristic everywhere.
    const CHARS = [
        { key: "geology",     label: "Geology and mineralogy",                  short: "Geology",
          ph: "DESCRIBE THE GEOLOGICAL FEATURES, ROCK TYPES, MINERALS OR SURFACE MATERIALS THAT MAKE THIS SITE RELEVANT" },
        { key: "terrain",     label: "Terrain and topography",                  short: "Terrain",
          ph: "DESCRIBE THE TERRAIN, ELEVATION, SLOPE, ROUGHNESS OR OTHER RELEVANT FEATURES" },
        { key: "temperature", label: "Temperature and environmental extremes",  short: "Temperature",
          ph: "ENTER RELEVANT TEMPERATURE CONDITIONS AND ENVIRONMENTAL MEASUREMENTS" },
        { key: "water",       label: "Water and ice",                           short: "Water and ice",
          ph: "DESCRIBE WATER, ICE OR OTHER RESOURCE AVAILABILITY AT THE SITE" },
        { key: "dust",        label: "Dust and atmospheric processes",          short: "Dust",
          ph: "DESCRIBE DUST, WIND OR OTHER ATMOSPHERIC PROCESSES RELEVANT TO THE COMPARISON" },
        { key: "biology",     label: "Biology and habitability",                short: "Biology",
          ph: "DESCRIBE BIOLOGICAL ACTIVITY OR HABITABILITY CONDITIONS RELEVANT TO THE COMPARISON" },
        { key: "subsurface",  label: "Caves and subsurface environments",       short: "Subsurface",
          ph: "DESCRIBE CAVES OR OTHER SUBSURFACE ENVIRONMENTS AT THE SITE" },
        { key: "exploration", label: "Human and robotic exploration relevance", short: "Human and robotic",
          ph: "EXPLAIN WHAT THIS SITE OFFERS FOR HUMAN OR ROBOTIC EXPLORATION" }
    ];

    const METHOD_SECTIONS = [
        { key: "identification", title: "Site identification methodology",  ph: "DESCRIBE HOW ANALOGUE SITES ARE IDENTIFIED" },
        { key: "selection",      title: "Analogue selection criteria",      ph: "ENTER THE CRITERIA USED TO SELECT A SITE" },
        { key: "evidence",       title: "Evidence evaluation",              ph: "EXPLAIN HOW SCIENTIFIC EVIDENCE IS EVALUATED" },
        { key: "similarities",   title: "Similarities and differences",     ph: "EXPLAIN HOW SIMILARITIES AND DIFFERENCES ARE ASSESSED" },
        { key: "limitations",    title: "Limitations",                      ph: "DESCRIBE THE LIMITATIONS OF THE ASSESSMENT" },
        { key: "sources",        title: "Data sources and references",      ph: "LIST THE DATA SOURCES AND REFERENCES USED" }
    ];

    const state = {
        jsonRecords: [],          // research records from locations.json (normalised)
        local: {},                // id -> locally saved record (edit of a JSON record, or a new one)
        locations: [],            // effective research records = JSON merged with local
        customs: [],              // user-made yellow markers
        markers: new Map(),       // id -> L.marker
        selectedId: null,
        filters: { query: "", status: "all", target: "all", chars: new Set() },
        methodJson: {},           // methodology text from locations.json
        methodLocal: {},          // methodology text edited in this browser
        loadFailed: false,
        dataStatus: "loading",    // "loading" | "loaded" | "failed"
        dataSource: null,
        skipped: 0,
        loadErrorHTML: ""
    };

    /* ---------- helpers ---------- */

    function esc(value) {
        return String(value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function str(v) { return v === undefined || v === null ? "" : String(v); }
    function hasContent(v) {
        if (Array.isArray(v)) return v.some(hasContent);
        return v !== undefined && v !== null && String(v).trim() !== "";
    }
    function isSafeUrl(url) { return /^https?:\/\//i.test(String(url || "").trim()); }
    // Image paths: relative paths, data: URLs or http(s) URLs (no javascript:, vbscript: etc.)
    function isSafeImageSrc(src) {
        src = String(src || "").trim();
        if (!src) return false;
        if (/^data:image\//i.test(src)) return true;
        if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return /^https?:\/\//i.test(src);
        return true;
    }
    function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    function bodyLabel(key) { const b = BODIES.find((x) => x.key === key); return b ? b.label : capitalise(key); }
    function allRecords() { return state.locations.concat(state.customs); }
    function formatCoords(lat, lon) { return `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
    function slugify(s) {
        return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site";
    }
    function paras(value) {
        return String(value).trim().split(/\n{2,}/)
            .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    }
    function getPath(obj, path) { return path.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj); }
    function setPath(obj, path, value) {
        const keys = path.split(".");
        const last = keys.pop();
        const target = keys.reduce((o, k) => o[k], obj);
        target[last] = value;
    }

    const store = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
    };

    /* ---------- 2. MAP ---------- */

    // Whole world including Antarctica; no horizontal repeats.
    const worldBounds = L.latLngBounds([-85, -180], [84, 180]);

    const map = L.map("map", {
        zoomSnap: 0.25, zoomDelta: 1, maxZoom: 10,
        maxBounds: worldBounds, maxBoundsViscosity: 1,
        worldCopyJump: false, zoomControl: true
    });

    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri", maxZoom: 18, noWrap: true, bounds: worldBounds }
    ).addTo(map);

    function fitWorld(animate) {
        map.invalidateSize();
        map.setMinZoom(map.getBoundsZoom(worldBounds, false));
        map.fitBounds(worldBounds, { animate: !!animate });
    }
    fitWorld(false);

    function onMapResized() {
        const atWorld = map.getZoom() <= map.getMinZoom() + 0.01;
        map.invalidateSize();
        map.setMinZoom(map.getBoundsZoom(worldBounds, false));
        if (atWorld) map.fitBounds(worldBounds, { animate: false });
    }
    if (window.ResizeObserver) new ResizeObserver(onMapResized).observe($("map"));
    window.addEventListener("resize", onMapResized);

    const markerLayer = L.layerGroup().addTo(map);

    function createPinIcon(status, selected, preview) {
        const cls = status + (selected ? " selected" : "") + (preview ? " preview" : "");
        return L.divIcon({
            className: "tierra-pin-container",
            html: `<div class="map-pin ${cls}"></div>`,
            iconSize: [25, 25], iconAnchor: [12, 25], tooltipAnchor: [0, -24]
        });
    }

    /* ---------- 3. DATA MODEL (schema v2) ---------- */

    function normImage(i) {
        i = i && typeof i === "object" ? i : {};
        return { src: str(i.src).trim(), caption: str(i.caption), credit: str(i.credit) };
    }
    function normImages(list) {
        return (Array.isArray(list) ? list : []).filter((i) => i && typeof i === "object").map(normImage);
    }
    function bodyKey(b) { return str(b).toLowerCase().trim(); }

    // Turns any raw record (schema v2, or the older v1 layout) into a complete,
    // predictable record. Missing optional fields become empty strings/arrays.
    function normaliseRecord(raw, opts) {
        const allowBlank = !!(opts && opts.allowBlank);
        if (!raw || typeof raw !== "object") return null;
        const lat = Number(raw.lat), lon = Number(raw.lon);
        if (!allowBlank && (!raw.id || !raw.name || raw.lat === "" || raw.lon === "" ||
            !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) return null;

        // targets (v1 used a plain "planets" array)
        const legacy = Array.isArray(raw.planets) ? raw.planets : (raw.planets ? [raw.planets] : []);
        const targetsRaw = Array.isArray(raw.targets) ? raw.targets : legacy.map((b) => ({ body: b }));
        const targets = [], seen = new Set();
        targetsRaw.forEach((t) => {
            const obj = t && typeof t === "object" ? t : { body: t };
            const body = bodyKey(obj.body);
            if (!body || seen.has(body)) return;
            seen.add(body);
            targets.push({ body, environment: str(obj.environment), context: str(obj.context) });
        });

        const rc = raw.characteristics && typeof raw.characteristics === "object" ? raw.characteristics : {};
        const characteristics = {};
        CHARS.forEach((c) => {
            const v = rc[c.key] && typeof rc[c.key] === "object" ? rc[c.key] : {};
            characteristics[c.key] = { text: str(v.text), images: normImages(v.images) };
        });

        // Location images: multiple images belonging to the overall location record
        let images = [];
        if (Array.isArray(raw.images)) {
            images = normImages(raw.images);
        } else if (raw.images && typeof raw.images === "object") {
            // legacy v1 support
            if (raw.images.earth && raw.images.earth.src) images.push(normImage(raw.images.earth));
            Object.keys(raw.images).forEach((k) => {
                if (k !== "earth" && raw.images[k] && raw.images[k].src) images.push(normImage(raw.images[k]));
            });
        }
        // Migrate comparison images if location images are empty
        if (!images.length && raw.comparisons && typeof raw.comparisons === "object") {
            Object.keys(raw.comparisons).forEach((b) => {
                const c = raw.comparisons[b];
                if (c && c.earthImage && c.earthImage.src) images.push(normImage(c.earthImage));
                if (c && c.planetaryImage && c.planetaryImage.src) images.push(normImage(c.planetaryImage));
            });
        }

        // comparisons: one per target, plus any previously entered for bodies since un-ticked
        const rcomp = raw.comparisons && typeof raw.comparisons === "object" ? raw.comparisons : {};
        const compBodies = new Set(targets.map((t) => t.body));
        Object.keys(rcomp).forEach((k) => compBodies.add(bodyKey(k)));
        const comparisons = {};
        compBodies.forEach((body) => {
            const v = rcomp[body] && typeof rcomp[body] === "object" ? rcomp[body] : {};
            comparisons[body] = {
                earthObservations: str(v.earthObservations),
                planetaryObservations: str(v.planetaryObservations),
                similarities: str(v.similarities !== undefined ? v.similarities : raw.similarities),
                differences: str(v.differences !== undefined ? v.differences : raw.differences)
            };
        });

        const rel = raw.relevance && typeof raw.relevance === "object" ? raw.relevance : {};
        const references = (Array.isArray(raw.references) ? raw.references : [])
            .filter((r) => r && typeof r === "object")
            .map((r) => ({
                title: str(r.title), authors: str(r.authors), year: str(r.year), journal: str(r.journal),
                doi: str(r.doi), url: str(r.url), dataset: str(r.dataset), instrument: str(r.instrument),
                notes: str(r.notes !== undefined ? r.notes : r.note)
            }));

        return {
            id: str(raw.id).trim(),
            name: str(raw.name),
            country: str(raw.country),
            region: str(raw.region),
            lat: allowBlank && !isFinite(lat) ? "" : lat,
            lon: allowBlank && !isFinite(lon) ? "" : lon,
            elevation: str(raw.elevation),
            status: raw.status === "found" ? "found" : "possible",   // never "custom"
            sample: !!raw.sample,
            description: str(raw.description !== undefined ? raw.description : raw.overview),
            setting: str(raw.setting),
            images,
            targets, characteristics, comparisons,
            relevance: { application: str(rel.application), robotic: str(rel.robotic), human: str(rel.human) },
            evidenceNotes: str(raw.evidenceNotes !== undefined ? raw.evidenceNotes : raw.rationale),
            references,
            assessment: Array.isArray(raw.assessment) ? raw.assessment : []   // reserved for a future documented method
        };
    }

    // The clean version of a record, as written to storage and to exported JSON.
    function exportRecord(rec) {
        const out = deepClone(rec);
        delete out._origin; delete out.custom;
        if (!out.sample) delete out.sample;
        return out;
    }

    function bodiesOf(rec) { return (rec.targets || []).map((t) => t.body); }
    function documented(rec, key) {
        const c = rec.characteristics && rec.characteristics[key];
        return !!c && (hasContent(c.text) || c.images.some((i) => i.src));
    }

    /* ---------- 4. DATA LOADING (locations.json) ---------- */

    async function loadData() {
        const attempts = [];
        for (const path of DATA_PATHS) {
            const url = new URL(path, document.baseURI).href;
            let response;
            try {
                response = await fetch(url, { cache: "no-store" });
            } catch (err) {
                attempts.push({ url, problem: "network error (" + err.message + ")" });
                continue;
            }
            if (!response.ok) { attempts.push({ url, problem: "HTTP " + response.status }); continue; }
            let json;
            try { json = await response.json(); }
            catch (err) {
                const e = new Error(`${url} was found but is not valid JSON: ${err.message}`);
                e.attempts = attempts; throw e;
            }
            const list = Array.isArray(json) ? json : json.locations;
            if (!Array.isArray(list)) {
                const e = new Error(`${url} was found but has no "locations" array.`);
                e.attempts = attempts; throw e;
            }
            const ids = new Set(), result = [];
            state.skipped = 0;
            list.forEach((raw, i) => {
                const rec = normaliseRecord(raw);
                if (!rec) { console.warn(`Skipping record #${i + 1}: needs id, name, lat (-90..90) and lon (-180..180).`, raw); state.skipped++; return; }
                if (ids.has(rec.id)) { console.warn(`Duplicate id "${rec.id}" skipped.`); state.skipped++; return; }
                ids.add(rec.id);
                result.push(rec);
            });
            if (json && !Array.isArray(json) && json.methodology && typeof json.methodology === "object") {
                state.methodJson = json.methodology;
            }
            state.dataSource = path;
            console.log(`TIERRA: loaded ${result.length} records from ${url}`);
            return result;
        }
        const e = new Error("locations.json could not be found.");
        e.attempts = attempts;
        throw e;
    }

    function buildLoadErrorHTML(error) {
        const onFile = location.protocol === "file:";
        const tried = (error.attempts || [])
            .map((a) => `<li><code>${esc(a.url)}</code> : ${esc(a.problem)}</li>`).join("");
        return `
            <div class="error-box" style="margin-top:10px">
                <strong>Location data could not be loaded.</strong><br>
                ${esc(error.message)}
                ${tried ? `<br>Addresses tried:<ul>${tried}</ul>` : ""}
                ${onFile
                    ? `This page was opened directly from disk (file://). Browsers block loading JSON that way. Start a local server in the project folder (<code>python -m http.server 8000</code>) and open <code>http://localhost:8000</code>.`
                    : `Check that <code>locations.json</code> is in the same folder as <code>index.html</code>, spelled exactly like that (lower case), and that the server was started from that folder.`}
            </div>`;
    }

    /* ---------- 5. LOCAL STORAGE (edits merged on top of the JSON) ---------- */

    function loadLocal() {
        state.local = {};
        const raw = store.get(LS.records);
        if (raw) {
            try {
                const map = JSON.parse(raw);
                Object.keys(map).forEach((id) => {
                    const rec = normaliseRecord(map[id]);
                    if (rec) { rec.id = id; state.local[id] = rec; }
                });
            } catch (err) { console.warn("Saved local records could not be read.", err); }
        }
        const m = store.get(LS.method);
        if (m) { try { const o = JSON.parse(m); if (o && typeof o === "object") state.methodLocal = o; } catch (e) { /* ignore */ } }
    }

    function persistLocal() {
        const out = {};
        Object.keys(state.local).forEach((id) => { out[id] = exportRecord(state.local[id]); });
        if (!store.set(LS.records, JSON.stringify(out))) {
            window.alert("Your changes could not be saved in this browser (storage unavailable or full). Use Export JSON to keep them.");
        }
    }
    function persistMethod() { store.set(LS.method, JSON.stringify(state.methodLocal)); }

    // Effective research records = JSON records, each replaced by its local edit
    // if there is one (matched by id, so nothing is ever duplicated), plus any
    // new local records.
    function buildEffective() {
        const baseIds = new Set(state.jsonRecords.map((r) => r.id));
        const out = state.jsonRecords.map((r) => state.local[r.id]
            ? Object.assign({}, state.local[r.id], { _origin: "edited", custom: false })
            : Object.assign({}, r, { _origin: "json", custom: false }));
        Object.keys(state.local).forEach((id) => {
            if (!baseIds.has(id)) out.push(Object.assign({}, state.local[id], { _origin: "local", custom: false }));
        });
        state.locations = out;
    }

    function localCounts() {
        const baseIds = new Set(state.jsonRecords.map((r) => r.id));
        const ids = Object.keys(state.local);
        const edited = ids.filter((id) => baseIds.has(id)).length;
        return { edited, added: ids.length - edited };
    }

    function effectiveMethod(key) {
        return Object.prototype.hasOwnProperty.call(state.methodLocal, key)
            ? str(state.methodLocal[key]) : str(state.methodJson[key]);
    }

    /* ---------- 6. CUSTOM MARKERS (yellow, separate from research) ---------- */

    function loadCustoms() {
        const raw = store.get(LS.custom);
        if (!raw) return [];
        try {
            const list = JSON.parse(raw);
            if (!Array.isArray(list)) return [];
            return list
                .filter((c) => c && c.id && typeof c.name === "string" && isFinite(Number(c.lat)) && isFinite(Number(c.lon)))
                .map((c) => ({
                    id: String(c.id), name: c.name.slice(0, 80), lat: Number(c.lat), lon: Number(c.lon),
                    status: "custom", custom: true, targets: []
                }));
        } catch (err) { console.warn("Saved custom markers could not be read.", err); return []; }
    }
    function saveCustoms() {
        const slim = state.customs.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon }));
        if (!store.set(LS.custom, JSON.stringify(slim))) console.warn("Custom markers could not be saved.");
    }

    /* ---------- 7. MARKERS + FILTERS ---------- */

    function matchesFilters(loc) {
        const f = state.filters;
        if (f.status !== "all" && loc.status !== f.status) return false;           // custom never matches possible/found
        if (f.target !== "all" && (loc.custom || !bodiesOf(loc).includes(f.target))) return false;
        if (f.chars.size) {
            if (loc.custom) return false;
            for (const k of f.chars) if (!documented(loc, k)) return false;          // all selected characteristics
        }
        if (f.query) {
            const hay = `${loc.name} ${loc.country || ""} ${loc.region || ""}`.toLowerCase();
            if (!hay.includes(f.query)) return false;
        }
        return true;
    }

    function createMarker(loc) {
        const marker = L.marker([loc.lat, loc.lon], { icon: createPinIcon(loc.status, loc.id === state.selectedId) });
        marker.bindTooltip(loc.name || "(unnamed)", { direction: "top" });
        marker.on("click", () => {
            if (add.active || pick.active) return;
            selectLocation(loc.id, { fly: true });
        });
        state.markers.set(loc.id, marker);
    }

    function rebuildMarkers() {
        state.markers.clear();
        allRecords().forEach(createMarker);
        applyFilters();
    }

    function applyFilters() {
        markerLayer.clearLayers();
        let vr = 0, vc = 0;
        allRecords().forEach((loc) => {
            if (matchesFilters(loc)) {
                markerLayer.addLayer(state.markers.get(loc.id));
                if (loc.custom) vc++; else vr++;
            }
        });

        if (state.selectedId) {
            const sel = allRecords().find((l) => l.id === state.selectedId);
            if (!sel || !matchesFilters(sel)) clearSelection();
        }

        let text;
        if (state.loadFailed && !state.locations.length) text = "Data error";
        else if (vr + vc === 0) text = "No matching locations";
        else {
            text = `${vr} of ${state.locations.length} research sites`;
            if (state.customs.length) text += ` | ${vc} of ${state.customs.length} custom`;
        }
        $("map-status").textContent = text;

        if (!state.selectedId) renderOverview();
    }

    function updateCharSummary() {
        const n = state.filters.chars.size;
        $("char-summary").textContent = n ? `${n} selected (match all)` : "Any";
    }

    function clearFilters() {
        state.filters = { query: "", status: "all", target: "all", chars: new Set() };
        $("search-input").value = "";
        $("filter-status").value = "all";
        $("filter-target").value = "all";
        document.querySelectorAll("#char-options input").forEach((cb) => { cb.checked = false; });
        updateCharSummary();
    }

    /* ---------- 8. SELECTION ---------- */

    function refreshIcons() {
        allRecords().forEach((loc) => {
            const selected = loc.id === state.selectedId;
            const m = state.markers.get(loc.id);
            if (!m) return;
            m.setIcon(createPinIcon(loc.status, selected));
            m.setZIndexOffset(selected ? 1000 : 0);
        });
    }

    function selectLocation(id, opts) {
        const loc = allRecords().find((l) => l.id === id);
        if (!loc) return;
        state.selectedId = id;
        refreshIcons();
        if (loc.custom) renderCustom(loc); else renderRecord(loc);
        $("selected-label").textContent = `Selected: ${loc.name || "(unnamed)"}`;
        $("info-panel").scrollTop = 0;
        if (opts && opts.fly) map.flyTo([loc.lat, loc.lon], Math.max(map.getZoom(), 5), { duration: 1 });
        if (MOBILE_QUERY.matches) $("information-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function clearSelection() {
        state.selectedId = null;
        refreshIcons();
        renderOverview();
        $("selected-label").textContent = "No location selected";
    }

    /* ---------- 9. GLOBAL SURVEY OVERVIEW ---------- */

    const ICON = {
        inventory: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#1d3f66" stroke-width="1"><rect x="1.5" y="1.5" width="9" height="9"/><path d="M1.5 4.5h9M1.5 7.5h9M5 1.5v9"/></svg>',
        chars:     '<svg width="12" height="12" viewBox="0 0 12 12" fill="#1d3f66"><rect x="1" y="6" width="2" height="5"/><rect x="5" y="2" width="2" height="9"/><rect x="9" y="4" width="2" height="7"/></svg>',
        target:    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#1d3f66" stroke-width="1"><circle cx="6" cy="6" r="4.5"/><circle cx="6" cy="6" r="1.5"/><path d="M6 0.5v2.5M6 9v2.5M0.5 6h2.5M9 6h2.5"/></svg>',
        dataset:   '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#1d3f66" stroke-width="1"><ellipse cx="6" cy="2.8" rx="4.5" ry="1.8"/><path d="M1.5 2.8v6.4c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V2.8M1.5 6c0 1 2 1.8 4.5 1.8S10.5 7 10.5 6"/></svg>',
        pointer:   '<svg width="12" height="12" viewBox="0 0 12 12" fill="#1d3f66"><path d="M2 1l7 4.5-3 .8 1.8 3.2-1.3.8-1.8-3.2L2 9.5z"/></svg>'
    };

    function ovRow(label, value, valueClass) {
        return `<div class="ov-row"><span class="ov-label">${label}</span><span class="ov-value ${valueClass || ""}">${value}</span></div>`;
    }
    function ovBar(label, count, total) {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
            <div class="ov-bar-row">
                <div class="ov-bar-top"><span>${esc(label)}</span><span class="ov-value">${count} / ${total}</span></div>
                <div class="ov-bar-track" role="img" aria-label="${esc(label)}: ${count} of ${total} research sites">
                    <div class="ov-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>`;
    }

    // Every number comes from state.locations (research records) or state.customs.
    // Custom markers appear only on their own row and never enter any research figure.
    function renderOverview() {
        const R = state.locations, total = R.length;
        const count = (fn) => R.filter(fn).length;
        const possible = count((l) => l.status === "possible");
        const found = count((l) => l.status === "found");
        const moon = count((l) => bodiesOf(l).includes("moon"));
        const mars = count((l) => bodiesOf(l).includes("mars"));
        const both = count((l) => bodiesOf(l).includes("moon") && bodiesOf(l).includes("mars"));
        const neither = count((l) => !bodiesOf(l).includes("moon") && !bodiesOf(l).includes("mars"));
        const lc = localCounts();

        let statusHTML;
        if (state.dataStatus === "loaded") statusHTML = `<span class="led ok"></span> Loaded`;
        else if (state.dataStatus === "failed") statusHTML = `<span class="led fail"></span> Failed to load`;
        else statusHTML = `<span class="led"></span> Loading…`;

        const sourceText = state.dataStatus === "loaded" ? esc(state.dataSource)
            : state.dataStatus === "failed" ? "Unavailable" : "…";

        $("record-number").textContent = "Overview";
        const gifHTML = OVERVIEW_GIF_SRC && isSafeImageSrc(OVERVIEW_GIF_SRC)
            ? `<img src="${esc(OVERVIEW_GIF_SRC)}" alt="Global survey overview" class="ov-gif">`
            : `<div class="ov-gif-placeholder">
                   <span class="ov-gif-badge">GIF PLACEHOLDER</span>
                   <span class="ov-gif-note">[READY FOR GIF UPLOAD]</span>
               </div>`;

        $("info-panel").innerHTML = `
            <div class="overview">
                <div class="ov-gif-container" id="ov-gif-container" title="Overview animation container">
                    ${gifHTML}
                </div>

                <section class="ov-section">
                    <h3 class="ov-head">${ICON.inventory}Research inventory</h3>
                    <div class="ov-body">
                        ${ovRow("Research locations", total)}
                        ${ovRow(`<span class="mini-pin possible"></span>Possible analogue`, possible)}
                        ${ovRow(`<span class="mini-pin found"></span>Found analogue`, found)}
                        ${ovRow("Moon-associated", moon)}
                        ${ovRow("Mars-associated", mars)}
                        ${ovRow(`<span class="mini-pin custom"></span>Custom markers <small>(not research)</small>`, state.customs.length)}
                    </div>
                </section>

                <section class="ov-section">
                    <h3 class="ov-head">${ICON.chars}Analogue characteristics</h3>
                    <div class="ov-body">
                        ${CHARS.map((c) => ovBar(c.short, count((l) => documented(l, c.key)), total)).join("")}
                        <div class="ov-note">Sites with text or an image entered for that characteristic. Research records only.</div>
                    </div>
                </section>

                <section class="ov-section">
                    <h3 class="ov-head">${ICON.target}Planetary targets</h3>
                    <div class="ov-body">
                        ${ovBar("Moon", moon, total)}
                        ${ovBar("Mars", mars, total)}
                        ${ovRow("Unique research sites", total)}
                        ${ovRow("Associated with both", both)}
                        ${neither ? ovRow("No target selected", neither) : ""}
                        <div class="ov-note">Each site is counted once in the total. A site with both targets appears in both bars.</div>
                    </div>
                </section>

                <section class="ov-section">
                    <h3 class="ov-head">${ICON.dataset}Dataset status</h3>
                    <div class="ov-body">
                        ${ovRow("Source", sourceText, "text")}
                        ${ovRow("Status", statusHTML)}
                        ${state.dataStatus === "loaded" ? ovRow("Records loaded from file", state.jsonRecords.length) : ""}
                        ${ovRow("Loading errors", state.dataStatus === "failed" ? "Yes (see below)" : state.dataStatus === "loaded" ? "None" : "…")}
                        ${state.dataStatus === "loaded" && state.skipped ? ovRow("Records skipped (invalid)", state.skipped) : ""}
                        ${ovRow("Local edits in this browser", lc.edited + lc.added ? `${lc.edited} edited, ${lc.added} new` : "None")}
                        <div class="ov-actions">
                            <button class="btn" type="button" data-action="new-record">New record</button>
                            <button class="btn" type="button" data-action="export">Export JSON</button>
                        </div>
                    </div>
                </section>

                <div class="ov-hint">
                    ${ICON.pointer}
                    <span>Select a map marker to inspect its terrestrial analogue record and planetary comparison.</span>
                </div>

                ${state.dataStatus === "failed" ? state.loadErrorHTML : ""}
            </div>`;
    }

    /* ---------- 10. RECORD VIEW ---------- */

    function ph(text) { return `<span class="ph">[${esc(text)}]</span>`; }

    function recHead(num, title) {
        return `<h3 class="rec-head"><span class="rec-num">${num}</span>${esc(title)}</h3>`;
    }
    function fieldRow(label, value, placeholder) {
        const has = hasContent(value);
        return `<div class="rec-row"><span class="rec-label">${esc(label)}</span><span class="rec-value${has ? "" : " empty"}">${has ? esc(value) : ph(placeholder)}</span></div>`;
    }
    function textField(label, value, placeholder) {
        const has = hasContent(value);
        return `<div class="rec-block"><div class="rec-label">${esc(label)}</div>` +
            (has ? `<div class="rec-text">${paras(value)}</div>` : `<div class="rec-text empty">${ph(placeholder)}</div>`) + `</div>`;
    }

    function figure(label, img, placeholderText, big) {
        img = img || {};
        const ok = isSafeImageSrc(img.src);
        const media = ok
            ? `<img src="${esc(img.src)}" alt="${esc(img.caption || label)}" data-rec-img="${esc(img.src)}" loading="lazy">`
            : `<div class="image-placeholder"><strong>${esc(label)}</strong><small>${ph(placeholderText)}</small></div>`;
        const caption = esc(img.caption || "");
        const credit = img.credit ? `<span class="credit">${esc(img.credit)}</span>` : "";
        return `
            <figure class="figure${big ? " figure-big" : ""}">
                <div class="image-label">${esc(label)}</div>
                ${media}
                ${(caption || credit) ? `<figcaption>${caption}${credit}</figcaption>` : ""}
            </figure>`;
    }

    function referenceHTML(r) {
        const doi = r.doi.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, "");
        const doiUrl = doi ? "https://doi.org/" + encodeURI(doi) : "";
        const href = isSafeUrl(r.url) ? r.url.trim() : doiUrl;
        const title = r.title.trim() || r.dataset.trim() || r.url.trim() || doi || "Untitled source";
        const head = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : esc(title);
        const meta = [r.authors, r.year, r.journal].filter(hasContent).map((x) => esc(x.trim())).join(" · ");
        const lines = [];
        if (meta) lines.push(`<small>${meta}</small>`);
        if (hasContent(r.dataset) && r.title.trim()) lines.push(`<small>Dataset: ${esc(r.dataset)}</small>`);
        if (hasContent(r.instrument)) lines.push(`<small>Instrument / data product: ${esc(r.instrument)}</small>`);
        if (doi) lines.push(`<small>DOI: ${doiUrl ? `<a href="${esc(doiUrl)}" target="_blank" rel="noopener noreferrer">${esc(doi)}</a>` : esc(doi)}</small>`);
        if (hasContent(r.url) && !isSafeUrl(r.url)) lines.push(`<small>URL (not a valid http link): ${esc(r.url)}</small>`);
        if (hasContent(r.notes)) lines.push(`<small>Notes: ${esc(r.notes)}</small>`);
        return `<li>${head}${lines.join("")}</li>`;
    }

    function comparisonBody(loc, body) {
        const c = loc.comparisons[body] || normaliseRecord({ id: "x", name: "x", lat: 0, lon: 0, targets: [{ body }] }).comparisons[body];
        const B = bodyLabel(body);
        return {
            earth: textField("Earth observations", c.earthObservations, "ENTER EARTH OBSERVATIONS, MEASUREMENTS AND DATA"),
            planet: textField("Planetary observations", c.planetaryObservations, "ENTER CORRESPONDING " + B.toUpperCase() + " OBSERVATIONS AND DATA"),
            sim: textField("Similarities", c.similarities, "EXPLAIN THE SHARED CHARACTERISTICS OR PROCESSES"),
            diff: textField("Differences and limitations", c.differences, "EXPLAIN WHERE THE EARTH ANALOGUE DIFFERS FROM THE PLANETARY ENVIRONMENT")
        };
    }

    function renderLocationImages(loc) {
        const imgs = (loc.images || []).filter((i) => isSafeImageSrc(i.src));
        if (!imgs.length) {
            return `<div class="rec-block"><div class="rec-label">Location images</div><div class="rec-text empty">${ph("NO IMAGES ENTERED FOR THIS LOCATION")}</div></div>`;
        }
        return `<div class="rec-block">
            <div class="rec-label">Location images (${imgs.length})</div>
            <div class="image-comparison location-images-grid">
                ${imgs.map((im, idx) => figure(im.caption || `${loc.name || "Site"} — Image ${idx + 1}`, im, "LOCATION IMAGE")).join("")}
            </div>
        </div>`;
    }

    function renderRecord(loc) {
        const idx = state.locations.indexOf(loc);
        $("record-number").textContent = "Site " + String(idx + 1).padStart(3, "0");
        const statusText = loc.status === "found" ? "Found analogue" : "Possible analogue";
        const originBadge = loc._origin === "edited" ? `<span class="badge local">Local edit</span>`
            : loc._origin === "local" ? `<span class="badge local">Local record</span>` : "";
        const bodies = bodiesOf(loc);

        // 02 targets
        const targets = loc.targets.length
            ? loc.targets.map((t) => `
                <div class="rec-block">
                    <div class="target-tags"><span class="planet-tag">${esc(bodyLabel(t.body))}</span></div>
                    ${fieldRow("Planetary environment", t.environment, "ENTER SPECIFIC PLANETARY ENVIRONMENT")}
                    ${textField("Exploration context", t.context, "EXPLAIN WHICH EXPLORATION CONTEXT THIS SITE RELATES TO")}
                </div>`).join("")
            : `<div class="rec-text empty">${ph("SELECT PLANETARY TARGET")}</div>`;

        // 03 characteristics
        const chars = CHARS.map((c) => {
            const v = loc.characteristics[c.key];
            const imgs = v.images.filter((i) => isSafeImageSrc(i.src));
            if (!hasContent(v.text) && !imgs.length) {
                return `<div class="rec-block"><div class="rec-label">${esc(c.label)}</div><div class="rec-text empty">${ph(c.ph)}</div></div>`;
            }
            return `<div class="rec-block"><div class="rec-label">${esc(c.label)}</div>
                ${hasContent(v.text) ? `<div class="rec-text">${paras(v.text)}</div>` : ""}
                ${imgs.length ? `<div class="image-comparison">${imgs.map((i) => figure(c.short, i, "ADD IMAGE")).join("")}</div>` : ""}</div>`;
        }).join("");

        // 04 comparisons (one per target)
        const comps = bodies.length ? bodies.map((b) => {
            const p = comparisonBody(loc, b);
            return `<div class="cmp-block">
                <div class="comparison-title">Earth and ${esc(bodyLabel(b))}</div>
                ${p.earth}${p.planet}${p.sim}${p.diff}</div>`;
        }).join("") : `<div class="rec-text empty">${ph("SELECT A PLANETARY TARGET IN SECTION 02 TO ADD A COMPARISON")}</div>`;

        // 05 relevance (only categories that have content)
        const rel = loc.relevance;
        const relParts = [
            hasContent(rel.application) ? textField("Potential application to future exploration", rel.application, "") : "",
            hasContent(rel.robotic) ? textField("Robotic exploration", rel.robotic, "") : "",
            hasContent(rel.human) ? textField("Human exploration", rel.human, "") : ""
        ].join("");
        const relHTML = relParts || `<div class="rec-text empty">${ph("EXPLAIN HOW STUDYING THIS EARTH SITE COULD HELP PREPARE FOR A MOON BASE OR MARS EXPLORATION")}</div>`;

        // 06 evidence
        const refs = loc.references.filter((r) => Object.values(r).some(hasContent));
        const refHTML = refs.length
            ? `<ul class="reference-list">${refs.map(referenceHTML).join("")}</ul>`
            : `<div class="rec-text empty">${ph("ENTER SOURCE TITLE, AUTHORS, YEAR AND DOI OR URL")}</div>`;

        $("info-panel").innerHTML = `
            <div class="location-content">
                <div class="rec-actions">
                    <button class="btn" type="button" data-action="overview">Back to overview</button>
                    <button class="btn" type="button" data-action="edit">Edit record</button>
                    <button class="btn" type="button" data-action="compare">Compare</button>
                    ${loc._origin === "edited" ? `<button class="btn" type="button" data-action="revert">Revert to file</button>` : ""}
                    ${loc._origin === "local" ? `<button class="btn" type="button" data-action="delete-local">Delete local record</button>` : ""}
                </div>

                <div class="rec-badges">
                    <span class="location-status ${loc.status}">${statusText}</span>${originBadge}
                </div>
                ${loc.sample ? `<div class="sample-banner">Sample data for interface testing. Not a verified scientific record.</div>` : ""}

                ${recHead("01", "Location identification")}
                <div class="rec-grid">
                    ${fieldRow("Site name", loc.name, "ENTER SITE NAME")}
                    ${fieldRow("Country", loc.country, "ENTER COUNTRY")}
                    ${fieldRow("Region", loc.region, "ENTER REGION")}
                    ${fieldRow("Latitude", String(loc.lat), "ENTER LATITUDE")}
                    ${fieldRow("Longitude", String(loc.lon), "ENTER LONGITUDE")}
                    ${fieldRow("Elevation", loc.elevation, "ENTER ELEVATION")}
                </div>
                ${textField("Site description", loc.description, "WRITE A SHORT DESCRIPTION OF THE EARTH LOCATION")}
                ${textField("Geographic setting", loc.setting, "DESCRIBE THE GEOGRAPHIC SETTING")}
                ${renderLocationImages(loc)}

                ${recHead("02", "Planetary target")}
                ${targets}

                ${recHead("03", "Analogue characteristics")}
                ${chars}

                ${recHead("04", "Earth and planetary comparison")}
                ${comps}

                ${recHead("05", "Exploration relevance")}
                ${relHTML}

                ${recHead("06", "Evidence and references")}
                ${textField("Notes about the evidence", loc.evidenceNotes, "ENTER NOTES ABOUT THE EVIDENCE")}
                <div class="rec-label" style="margin-top:8px">Sources</div>
                ${refHTML}

                <div class="panel-note">Classification is provisional until supported by verified references.</div>
            </div>`;
    }

    function renderCustom(loc) {
        $("record-number").textContent = "Custom";
        $("info-panel").innerHTML = `
            <div class="location-content">
                <div class="rec-actions"><button class="btn" type="button" data-action="overview">Back to overview</button></div>
                <div class="rec-badges"><span class="location-status custom">Custom marker</span></div>
                <h2>${esc(loc.name)}</h2>
                <div class="location-meta">${formatCoords(loc.lat, loc.lon)}</div>
                <div class="panel-note">
                    This is your own marker. It is not a research record and has no
                    Possible or Found classification. It is stored in this browser only.
                </div>
                <p style="margin-top:12px"><button class="btn" type="button" data-action="delete-custom">Delete marker</button></p>
            </div>`;
    }

    function deleteCustom(id) {
        const loc = state.customs.find((c) => c.id === id);
        if (!loc || !window.confirm(`Delete the custom marker "${loc.name}"?`)) return;
        state.customs = state.customs.filter((c) => c.id !== id);
        state.markers.delete(id);
        saveCustoms();
        if (state.selectedId === id) clearSelection();
        applyFilters();
    }

    function revertRecord(id) {
        if (!window.confirm("Discard your local edits and go back to the version in locations.json?")) return;
        delete state.local[id];
        persistLocal(); buildEffective(); rebuildMarkers();
        selectLocation(id, {});
    }
    function deleteLocalRecord(id) {
        const rec = state.local[id];
        if (!rec || !window.confirm(`Delete the local record "${rec.name}"? Export first if you want to keep it.`)) return;
        delete state.local[id];
        persistLocal(); buildEffective();
        if (state.selectedId === id) state.selectedId = null;
        rebuildMarkers(); clearSelection();
    }

    // Broken image paths become a clear placeholder instead of a broken icon.
    document.addEventListener("error", (e) => {
        const img = e.target;
        if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-rec-img")) return;
        const box = document.createElement("div");
        box.className = "image-placeholder";
        const a = document.createElement("strong"); a.textContent = "IMAGE NOT FOUND";
        const b = document.createElement("small"); b.textContent = img.getAttribute("data-rec-img");
        box.append(a, b);
        img.replaceWith(box);
    }, true);

    /* ---------- 11. COMPARISON VIEWER ---------- */

    const cmp = { id: null, body: null };

    function openCompare(id) {
        const loc = state.locations.find((l) => l.id === id);
        if (!loc) return;
        cmp.id = id;
        cmp.body = bodiesOf(loc)[0] || null;
        renderCompare();
        openDialog("dlg-compare", {});
    }

    function renderCompare() {
        const loc = state.locations.find((l) => l.id === cmp.id);
        const bodies = bodiesOf(loc);
        const tabs = bodies.map((b) =>
            `<button class="btn" type="button" data-body="${esc(b)}" aria-pressed="${b === cmp.body}">Earth and ${esc(bodyLabel(b))}</button>`).join("");
        let content;
        if (!cmp.body) {
            content = `<div class="rec-text empty">${ph("SELECT A PLANETARY TARGET IN THE RECORD EDITOR TO ENABLE A COMPARISON")}</div>`;
        } else {
            const p = comparisonBody(loc, cmp.body);
            const t = loc.targets.find((x) => x.body === cmp.body) || {};
            content = `
                ${hasContent(t.environment) ? fieldRow("Planetary environment", t.environment, "") : ""}
                <div class="cmp-cols"><div>${p.earth}</div><div>${p.planet}</div></div>
                <div class="cmp-cols"><div>${p.sim}</div><div>${p.diff}</div></div>`;
        }
        $("cmp-body").innerHTML = `
            <div class="cmp-head">${esc(loc.name || "(unnamed site)")} <span class="muted-inline">${esc(loc.country || "")}</span></div>
            <div class="cmp-tabs">${tabs}</div>
            ${content}`;
    }

    /* ---------- 12. RECORD EDITOR ---------- */

    const ed = { draft: null, isNew: false, origId: null, dirty: false };

    function edInput(label, path, placeholder, extra) {
        const v = getPath(ed.draft, path);
        return `<label class="ed-field"><span>${esc(label)}</span><input class="text-input" type="text" ${extra || ""}
            data-path="${path}" value="${esc(v === undefined ? "" : v)}" placeholder="[${esc(placeholder)}]"></label>`;
    }
    function edArea(label, path, placeholder, rows) {
        const v = getPath(ed.draft, path);
        return `<label class="ed-field"><span>${esc(label)}</span><textarea class="text-area" rows="${rows || 3}"
            data-path="${path}" placeholder="[${esc(placeholder)}]">${esc(v === undefined ? "" : v)}</textarea></label>`;
    }
    function edImageRow(base, i, removable) {
        return `<div class="ed-imgrow">
            <input class="text-input" data-path="${base}.src" placeholder="[ADD IMAGE PATH OR URL]" value="${esc(getPath(ed.draft, base + ".src"))}">
            <input class="text-input" data-path="${base}.caption" placeholder="[CAPTION]" value="${esc(getPath(ed.draft, base + ".caption"))}">
            <input class="text-input" data-path="${base}.credit" placeholder="[CREDIT OR SOURCE]" value="${esc(getPath(ed.draft, base + ".credit"))}">
            ${removable ? `<button class="btn" type="button" data-action="ed-rm-img" data-base="${esc(removable)}" data-i="${i}">Remove</button>` : ""}
        </div>`;
    }
    function edLocationImageRow(i) {
        const base = `images.${i}`;
        const src = getPath(ed.draft, base + ".src") || "";
        const cap = getPath(ed.draft, base + ".caption") || "";
        const cred = getPath(ed.draft, base + ".credit") || "";
        const hasImg = isSafeImageSrc(src);
        return `<div class="ed-loc-imgrow">
            <div class="ed-loc-thumb-wrap">
                ${hasImg ? `<img src="${esc(src)}" class="ed-loc-thumb" alt="Preview">` : `<div class="ed-loc-thumb-placeholder">No img</div>`}
            </div>
            <div class="ed-loc-inputs">
                <div class="ed-loc-input-line">
                    <input class="text-input" data-path="${base}.src" placeholder="[IMAGE PATH, URL OR UPLOAD FILE]" value="${esc(src)}">
                    <button class="btn" type="button" data-action="ed-row-upload" data-i="${i}" title="Choose an image file from disk">Upload…</button>
                    <button class="btn" type="button" data-action="ed-rm-loc-img" data-i="${i}" title="Remove this image">Remove</button>
                </div>
                <div class="ed-loc-meta-line">
                    <input class="text-input" data-path="${base}.caption" placeholder="[CAPTION]" value="${esc(cap)}">
                    <input class="text-input" data-path="${base}.credit" placeholder="[CREDIT OR SOURCE]" value="${esc(cred)}">
                </div>
            </div>
        </div>`;
    }

    function edSection(num, title, inner) {
        return `<section class="ed-section"><h3 class="ed-head"><span class="rec-num">${num}</span>${esc(title)}</h3><div class="ed-inner">${inner}</div></section>`;
    }

    function editorHTML() {
        const d = ed.draft;
        const s1 = `
            <div class="ed-grid">
                ${edInput("Site name", "name", "ENTER SITE NAME")}
                ${edInput("Country", "country", "ENTER COUNTRY")}
                ${edInput("Region", "region", "ENTER REGION")}
                ${edInput("Elevation", "elevation", "ENTER ELEVATION")}
                ${edInput("Latitude (-90 to 90)", "lat", "ENTER LATITUDE", 'inputmode="decimal"')}
                ${edInput("Longitude (-180 to 180)", "lon", "ENTER LONGITUDE", 'inputmode="decimal"')}
            </div>
            <div class="ed-inline">
                <button class="btn" type="button" data-action="ed-pick">Pick coordinates on map</button>
                <label class="ed-field ed-select"><span>Classification</span>
                    <select data-path="status">
                        <option value="possible"${d.status === "possible" ? " selected" : ""}>Possible analogue</option>
                        <option value="found"${d.status === "found" ? " selected" : ""}>Found analogue</option>
                    </select></label>
            </div>
            ${edArea("Site description", "description", "WRITE A SHORT DESCRIPTION OF THE EARTH LOCATION", 3)}
            ${edArea("Geographic setting", "setting", "DESCRIBE THE GEOGRAPHIC SETTING", 3)}
            ${d.sample ? `<label class="ed-check"><input type="checkbox" data-path="sample" checked> Sample data (untick once this record contains real research)</label>` : ""}
            <div class="ed-sub">
                <div class="ed-subhead">
                    <span>Location images (${(d.images || []).length})</span>
                    <div style="display:flex; gap:6px;">
                        <button class="btn" type="button" data-action="ed-add-loc-img">Add image</button>
                        <button class="btn" type="button" data-action="ed-upload-loc-img">Upload image…</button>
                    </div>
                </div>
                <p class="ed-help">Upload files from your computer or enter relative paths (e.g. <code>images/site.jpg</code>) or web URLs. No limit on images.</p>
                ${(d.images && d.images.length) ? "" : `<div class="rec-text empty">${ph("NO IMAGES ADDED. CLICK 'ADD IMAGE' OR 'UPLOAD IMAGE…'")}</div>`}
                ${(d.images || []).map((im, i) => edLocationImageRow(i)).join("")}
            </div>`;

        const s2 = `<div class="ed-targets">${BODIES.map((b) => {
            const on = d.targets.some((t) => t.body === b.key);
            return `<label class="ed-check"><input type="checkbox" data-action="ed-toggle-body" data-body="${b.key}"${on ? " checked" : ""}> ${esc(b.label)}</label>`;
        }).join("")}</div>
            ${d.targets.length ? "" : `<div class="rec-text empty">${ph("SELECT PLANETARY TARGET")}</div>`}
            ${d.targets.map((t, i) => `
                <div class="ed-sub"><div class="ed-subhead">${esc(bodyLabel(t.body))}</div>
                    ${edInput("Specific planetary environment", `targets.${i}.environment`, "ENTER SPECIFIC PLANETARY ENVIRONMENT")}
                    ${edArea("Exploration context", `targets.${i}.context`, "EXPLAIN WHICH EXPLORATION CONTEXT THIS SITE RELATES TO", 2)}
                </div>`).join("")}`;

        const s3 = `<p class="ed-help">Leave a characteristic empty if it is not relevant. Images are paths or URLs (see the guide).</p>` +
            CHARS.map((c) => {
                const imgs = d.characteristics[c.key].images;
                return `<div class="ed-sub"><div class="ed-subhead">${esc(c.label)}</div>
                    ${edArea("Description", `characteristics.${c.key}.text`, c.ph, 3)}
                    ${imgs.map((im, i) => edImageRow(`characteristics.${c.key}.images.${i}`, i, `characteristics.${c.key}.images`)).join("")}
                    <button class="btn" type="button" data-action="ed-add-img" data-base="characteristics.${c.key}.images">Add image</button>
                </div>`;
            }).join("");

        const s4 = d.targets.length ? d.targets.map((t) => {
            const b = t.body, B = bodyLabel(b), base = `comparisons.${b}`;
            return `<div class="ed-sub"><div class="ed-subhead">Earth and ${esc(B)}</div>
                ${edArea("Earth observations", `${base}.earthObservations`, "ENTER EARTH OBSERVATIONS, MEASUREMENTS AND DATA", 3)}
                ${edArea("Planetary observations", `${base}.planetaryObservations`, "ENTER CORRESPONDING " + B.toUpperCase() + " OBSERVATIONS AND DATA", 3)}
                ${edArea("Similarities", `${base}.similarities`, "EXPLAIN THE SHARED CHARACTERISTICS OR PROCESSES", 3)}
                ${edArea("Differences and limitations", `${base}.differences`, "EXPLAIN WHERE THE EARTH ANALOGUE DIFFERS FROM THE PLANETARY ENVIRONMENT", 3)}
            </div>`;
        }).join("") : `<div class="rec-text empty">${ph("SELECT A PLANETARY TARGET IN SECTION 02 TO ADD A COMPARISON")}</div>`;

        const s5 = `
            ${edArea("Potential application to future exploration", "relevance.application", "EXPLAIN HOW STUDYING THIS EARTH SITE COULD HELP PREPARE FOR A MOON BASE OR MARS EXPLORATION", 3)}
            ${edArea("Robotic exploration", "relevance.robotic", "EXPLAIN WHETHER THIS LOCATION COULD HELP WITH ROVER MOBILITY, TERRAIN NAVIGATION, INSTRUMENT TESTING OR OTHER ROBOTIC CHALLENGES", 3)}
            ${edArea("Human exploration", "relevance.human", "EXPLAIN WHETHER THIS LOCATION COULD HELP WITH HABITATS, RESOURCE UTILIZATION, HUMAN OPERATIONS OR OTHER EXPLORATION CHALLENGES", 3)}`;

        const s6 = `
            ${edArea("Notes about the evidence", "evidenceNotes", "ENTER NOTES ABOUT THE EVIDENCE", 3)}
            ${d.references.map((r, i) => `
                <div class="ed-sub"><div class="ed-subhead">Source ${i + 1}
                    <button class="btn" type="button" data-action="ed-rm-ref" data-i="${i}">Remove</button></div>
                    ${edInput("Paper or source title", `references.${i}.title`, "ENTER SOURCE TITLE")}
                    <div class="ed-grid">
                        ${edInput("Author(s)", `references.${i}.authors`, "ENTER AUTHORS")}
                        ${edInput("Publication year", `references.${i}.year`, "ENTER YEAR")}
                        ${edInput("Journal or publication", `references.${i}.journal`, "ENTER JOURNAL OR PUBLICATION")}
                        ${edInput("DOI", `references.${i}.doi`, "ENTER DOI")}
                    </div>
                    ${edInput("URL", `references.${i}.url`, "ENTER SOURCE URL")}
                    <div class="ed-grid">
                        ${edInput("NASA or other agency dataset", `references.${i}.dataset`, "ENTER DATASET NAME")}
                        ${edInput("Data product or instrument", `references.${i}.instrument`, "ENTER DATA PRODUCT OR INSTRUMENT")}
                    </div>
                    ${edArea("Notes about this source", `references.${i}.notes`, "ENTER NOTES ABOUT THE EVIDENCE", 2)}
                </div>`).join("")}
            <button class="btn" type="button" data-action="ed-add-ref">Add source</button>`;

        return edSection("01", "Location identification", s1) + edSection("02", "Planetary target", s2) +
            edSection("03", "Analogue characteristics", s3) + edSection("04", "Earth and planetary comparison", s4) +
            edSection("05", "Exploration relevance", s5) + edSection("06", "Evidence and references", s6);
    }

    function renderEditor() {
        const body = $("ed-body");
        const top = body.scrollTop;
        body.innerHTML = editorHTML();
        body.scrollTop = top;
    }

    function openEditor(id) {
        const rec = id ? state.locations.find((l) => l.id === id) : null;
        ed.isNew = !rec;
        ed.origId = rec ? rec.id : null;
        ed.dirty = false;
        if (rec) ed.draft = normaliseRecord(exportRecord(rec));
        else {
            ed.draft = normaliseRecord({ id: "", name: "" }, { allowBlank: true });
            ed.draft.lat = ""; ed.draft.lon = "";
        }
        $("dlg-editor-title").textContent = rec ? "RECORD EDITOR: " + (rec.name || "UNNAMED SITE").toUpperCase() : "RECORD EDITOR: NEW RESEARCH RECORD";
        $("ed-error").textContent = "";
        renderEditor();
        $("ed-body").scrollTop = 0;
        openDialog("dlg-editor", {
            focusId: null,
            beforeClose: () => !ed.dirty || window.confirm("Discard unsaved changes to this record?")
        });
    }

    function ensureComparison(body) {
        if (!ed.draft.comparisons[body]) {
            ed.draft.comparisons[body] = normaliseRecord({ id: "x", name: "x", lat: 0, lon: 0, targets: [{ body }] }).comparisons[body];
        }
    }

    function wireEditor() {
        const body = $("ed-body");

        body.addEventListener("input", (e) => {
            const el = e.target;
            if (!el.dataset.path) return;
            setPath(ed.draft, el.dataset.path, el.type === "checkbox" ? el.checked : el.value);
            ed.dirty = true;
        });
        body.addEventListener("change", (e) => {
            const el = e.target;
            if (el.dataset.path && el.tagName === "SELECT") { setPath(ed.draft, el.dataset.path, el.value); ed.dirty = true; }
            if (el.dataset.action === "ed-toggle-body") {
                const b = el.dataset.body;
                if (el.checked) { ed.draft.targets.push({ body: b, environment: "", context: "" }); ensureComparison(b); }
                else ed.draft.targets = ed.draft.targets.filter((t) => t.body !== b);
                ed.dirty = true;
                renderEditor();
            }
        });
        body.addEventListener("click", (e) => {
            const a = e.target.closest("[data-action]");
            if (!a) return;
            const d = ed.draft;
            switch (a.dataset.action) {
                case "ed-add-img": getPath(d, a.dataset.base).push({ src: "", caption: "", credit: "" }); break;
                case "ed-rm-img": getPath(d, a.dataset.base).splice(Number(a.dataset.i), 1); break;
                case "ed-add-loc-img":
                    if (!Array.isArray(d.images)) d.images = [];
                    d.images.push({ src: "", caption: "", credit: "" });
                    break;
                case "ed-rm-loc-img":
                    if (Array.isArray(d.images)) d.images.splice(Number(a.dataset.i), 1);
                    break;
                case "ed-upload-loc-img": {
                    const fi = document.createElement("input");
                    fi.type = "file";
                    fi.accept = "image/*";
                    fi.multiple = true;
                    fi.onchange = () => {
                        const files = Array.from(fi.files || []);
                        if (!files.length) return;
                        if (!Array.isArray(d.images)) d.images = [];
                        let remaining = files.length;
                        files.forEach((file) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                d.images.push({
                                    src: String(reader.result),
                                    caption: file.name.replace(/\.[^/.]+$/, ""),
                                    credit: ""
                                });
                                remaining--;
                                if (remaining === 0) {
                                    ed.dirty = true;
                                    renderEditor();
                                }
                            };
                            reader.onerror = () => {
                                remaining--;
                                if (remaining === 0) {
                                    ed.dirty = true;
                                    renderEditor();
                                }
                            };
                            reader.readAsDataURL(file);
                        });
                    };
                    fi.click();
                    return;
                }
                case "ed-row-upload": {
                    const idx = Number(a.dataset.i);
                    const fi = document.createElement("input");
                    fi.type = "file";
                    fi.accept = "image/*";
                    fi.onchange = () => {
                        const file = (fi.files || [])[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                            if (d.images && d.images[idx]) {
                                d.images[idx].src = String(reader.result);
                                if (!d.images[idx].caption) {
                                    d.images[idx].caption = file.name.replace(/\.[^/.]+$/, "");
                                }
                                ed.dirty = true;
                                renderEditor();
                            }
                        };
                        reader.readAsDataURL(file);
                    };
                    fi.click();
                    return;
                }
                case "ed-add-ref": d.references.push({ title: "", authors: "", year: "", journal: "", doi: "", url: "", dataset: "", instrument: "", notes: "" }); break;
                case "ed-rm-ref": d.references.splice(Number(a.dataset.i), 1); break;
                case "ed-pick": startPick(); return;
                default: return;
            }
            ed.dirty = true;
            renderEditor();
        });
        $("ed-save").addEventListener("click", saveEditor);
    }

    function saveEditor() {
        const d = ed.draft;
        const err = $("ed-error");
        const lat = Number(String(d.lat).trim()), lon = Number(String(d.lon).trim());
        if (!d.name.trim()) { err.textContent = "Enter a site name."; return; }
        if (String(d.lat).trim() === "" || !isFinite(lat) || Math.abs(lat) > 90) { err.textContent = "Latitude must be a number from -90 to 90."; return; }
        if (String(d.lon).trim() === "" || !isFinite(lon) || Math.abs(lon) > 180) { err.textContent = "Longitude must be a number from -180 to 180."; return; }

        let id = ed.origId;
        if (!id) {
            const taken = new Set(state.locations.map((l) => l.id).concat(state.customs.map((c) => c.id)));
            const base = slugify(d.name); id = base;
            for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        }

        const clean = deepClone(d);
        clean.id = id; clean.lat = lat; clean.lon = lon;
        const keepImg = (i) => i && (i.src.trim() || i.caption.trim() || i.credit.trim());
        clean.images = (clean.images || []).filter(keepImg);
        CHARS.forEach((c) => { clean.characteristics[c.key].images = clean.characteristics[c.key].images.filter(keepImg); });
        clean.references = clean.references.filter((r) => Object.values(r).some(hasContent));
        const rec = normaliseRecord(clean);
        if (!rec) { err.textContent = "The record could not be saved. Check the fields."; return; }

        const base = state.jsonRecords.find((r) => r.id === id);
        if (base && JSON.stringify(exportRecord(base)) === JSON.stringify(exportRecord(rec))) delete state.local[id];   // identical to file
        else state.local[id] = rec;

        persistLocal(); buildEffective(); ed.dirty = false;
        closeDialog("dlg-editor", true);
        clearFilters();
        rebuildMarkers();
        selectLocation(id, { fly: ed.isNew });
    }

    /* ---------- 13. METHODOLOGY & ASSESSMENT ---------- */

    let methEditing = false;

    function renderMethodology() {
        $("meth-body").innerHTML = METHOD_SECTIONS.map((s) => {
            const text = effectiveMethod(s.key);
            if (methEditing) {
                return `<h3>${esc(s.title)}</h3><textarea class="text-area meth-area" rows="5" data-key="${s.key}" placeholder="[${esc(s.ph)}]">${esc(text)}</textarea>`;
            }
            return `<h3>${esc(s.title)}</h3>` + (hasContent(text) ? paras(text) : `<p class="ph-field">${ph(s.ph)}</p>`);
        }).join("") + (methEditing ? "" : `<p class="dialog-note">Descriptive text only. TIERRA does not apply or claim any validated scoring method.</p>`);
        $("meth-edit").hidden = methEditing;
        $("meth-save").hidden = !methEditing;
        $("meth-cancel").hidden = !methEditing;
    }

    function initMethodology() {
        $("btn-method").addEventListener("click", () => {
            methEditing = false; $("meth-status").textContent = "";
            renderMethodology();
            openDialog("dlg-method", {});
        });
        $("meth-edit").addEventListener("click", () => { methEditing = true; renderMethodology(); const t = $("meth-body").querySelector("textarea"); if (t) t.focus(); });
        $("meth-cancel").addEventListener("click", () => { methEditing = false; renderMethodology(); });
        $("meth-save").addEventListener("click", () => {
            $("meth-body").querySelectorAll("textarea[data-key]").forEach((t) => {
                const k = t.dataset.key;
                if (t.value === str(state.methodJson[k])) delete state.methodLocal[k];
                else state.methodLocal[k] = t.value;
            });
            persistMethod();
            methEditing = false; renderMethodology();
            $("meth-status").textContent = "Saved in this browser. Use Data > Export JSON to keep it.";
        });
    }

    /* ---------- 14. DATA MANAGER (export / import) ---------- */

    function buildExport() {
        const method = {};
        METHOD_SECTIONS.forEach((s) => { method[s.key] = effectiveMethod(s.key); });
        return {
            _readme: "TIERRA research dataset, schema version 2. Exported from the TIERRA app. Replace locations.json in your project with this file to publish it.",
            schemaVersion: 2,
            exportedAt: new Date().toISOString(),
            methodology: method,
            locations: state.locations.map(exportRecord)
        };
    }

    function downloadJSON(filename, obj) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportJSON() {
        downloadJSON("locations.json", buildExport());
        const m = $("data-message"); if (m) m.textContent = `Exported ${state.locations.length} records as locations.json.`;
    }

    function renderDataSummary() {
        const lc = localCounts();
        $("data-summary").innerHTML = `
            Source file: <b>${state.dataStatus === "loaded" ? esc(state.dataSource) : "unavailable"}</b><br>
            Records in file: <b>${state.jsonRecords.length}</b><br>
            Local edits: <b>${lc.edited}</b> edited, <b>${lc.added}</b> new<br>
            Research records in use: <b>${state.locations.length}</b><br>
            Custom markers (not exported): <b>${state.customs.length}</b>`;
    }

    function importData(text) {
        const msg = $("data-message");
        let json;
        try { json = JSON.parse(text); } catch (e) { msg.textContent = "Import failed: the file is not valid JSON."; return; }
        const list = Array.isArray(json) ? json : json && json.locations;
        if (!Array.isArray(list)) { msg.textContent = 'Import failed: no "locations" list found.'; return; }
        let added = 0, updated = 0, same = 0, bad = 0;
        list.forEach((raw) => {
            const rec = normaliseRecord(raw);
            if (!rec) { bad++; return; }
            const key = (r) => JSON.stringify(exportRecord(r));
            const base = state.jsonRecords.find((r) => r.id === rec.id);
            const local = state.local[rec.id];
            if (base && key(base) === key(rec)) { if (local) { delete state.local[rec.id]; updated++; } else same++; return; }
            if (local && key(local) === key(rec)) { same++; return; }
            state.local[rec.id] = rec;
            if (base || local) updated++; else added++;
        });
        if (json && !Array.isArray(json) && json.methodology && typeof json.methodology === "object") {
            METHOD_SECTIONS.forEach((s) => {
                if (typeof json.methodology[s.key] !== "string") return;
                if (json.methodology[s.key] === str(state.methodJson[s.key])) delete state.methodLocal[s.key];
                else state.methodLocal[s.key] = json.methodology[s.key];
            });
            persistMethod();
        }
        persistLocal(); buildEffective(); rebuildMarkers();
        if (state.selectedId && !allRecords().some((l) => l.id === state.selectedId)) clearSelection();
        renderDataSummary();
        msg.textContent = `Import finished: ${added} new, ${updated} updated, ${same} unchanged, ${bad} skipped.`;
    }

    function initDataManager() {
        $("btn-data").addEventListener("click", () => { $("data-message").textContent = ""; renderDataSummary(); openDialog("dlg-data", {}); });
        $("data-export").addEventListener("click", exportJSON);
        $("data-new").addEventListener("click", () => { closeDialog("dlg-data", true); openEditor(null); });
        $("data-import").addEventListener("click", () => $("import-file").click());
        $("import-file").addEventListener("change", (e) => {
            const file = e.target.files[0];
            e.target.value = "";
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => importData(String(reader.result));
            reader.onerror = () => { $("data-message").textContent = "The file could not be read."; };
            reader.readAsText(file);
        });
        $("data-clear").addEventListener("click", () => {
            const lc = localCounts();
            if (!lc.edited && !lc.added && !Object.keys(state.methodLocal).length) { $("data-message").textContent = "There are no local edits to clear."; return; }
            if (!window.confirm("Delete all local edits, local records and local methodology text from this browser? Export first if you want to keep them.")) return;
            state.local = {}; state.methodLocal = {};
            persistLocal(); persistMethod(); buildEffective();
            if (state.selectedId && !allRecords().some((l) => l.id === state.selectedId)) state.selectedId = null;
            rebuildMarkers(); clearSelection(); renderDataSummary();
            $("data-message").textContent = "Local edits cleared.";
        });
    }

    /* ---------- 15. WINDOWS (dialogs) ---------- */

    const dialogs = {};   // id -> { opener, onClose, beforeClose }

    function focusables(root) {
        return Array.from(root.querySelectorAll("button, input, textarea, select, [tabindex]:not([tabindex='-1'])"))
            .filter((el) => !el.disabled && el.offsetParent !== null);
    }

    function openDialog(id, opts) {
        opts = opts || {};
        const el = $(id);
        dialogs[id] = { opener: document.activeElement, onClose: opts.onClose, beforeClose: opts.beforeClose };
        resetDialogPosition(el);          // always open centred
        el.hidden = false;
        const target = opts.focusId ? $(opts.focusId)
            : focusables(el).find((n) => !n.classList.contains("dialog-close"));
        if (target) target.focus();
    }

    function closeDialog(id, silent) {
        const el = $(id);
        const d = dialogs[id];
        if (el.hidden) return;
        if (!silent && d && d.beforeClose && !d.beforeClose()) return;
        el.hidden = true;
        if (d && d.opener && typeof d.opener.focus === "function" && document.contains(d.opener)) d.opener.focus();
        if (d && d.onClose && !silent) d.onClose();
    }

    function resetDialogPosition(backdrop) {
        const dlg = backdrop.querySelector(".dialog");
        dlg.style.position = dlg.style.left = dlg.style.top = dlg.style.margin = "";
    }

    function clampDialog(dlg) {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const r = dlg.getBoundingClientRect();
        dlg.style.left = Math.min(Math.max(0, r.left), Math.max(0, vw - r.width)) + "px";
        dlg.style.top = Math.min(Math.max(0, r.top), Math.max(0, vh - r.height)) + "px";
    }

    function initDialogDrag() {
        document.querySelectorAll(".dialog").forEach((dlg) => {
            const bar = dlg.querySelector(".dialog-titlebar");
            let grab = null;

            bar.addEventListener("pointerdown", (e) => {
                if (e.target.closest("button")) return;                 // close button still works
                if (e.pointerType === "mouse" && e.button !== 0) return;
                const r = dlg.getBoundingClientRect();
                dlg.style.position = "fixed";
                dlg.style.margin = "0";
                dlg.style.left = r.left + "px";
                dlg.style.top = r.top + "px";
                grab = { x: e.clientX - r.left, y: e.clientY - r.top };
                try { bar.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
                document.body.classList.add("dragging-dialog");
                e.preventDefault();                                     // no text selection
            });

            bar.addEventListener("pointermove", (e) => {
                if (!grab || !bar.hasPointerCapture(e.pointerId)) return;
                const vw = document.documentElement.clientWidth;
                const vh = document.documentElement.clientHeight;
                const r = dlg.getBoundingClientRect();
                const x = Math.min(Math.max(0, e.clientX - grab.x), Math.max(0, vw - r.width));
                const y = Math.min(Math.max(0, e.clientY - grab.y), Math.max(0, vh - r.height));
                dlg.style.left = x + "px";
                dlg.style.top = y + "px";
            });

            function end(e) {
                if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
                grab = null;
                document.body.classList.remove("dragging-dialog");
            }
            bar.addEventListener("pointerup", end);
            bar.addEventListener("pointercancel", end);
        });

        // keep moved windows reachable if the browser window shrinks
        window.addEventListener("resize", () => {
            document.querySelectorAll(".dialog").forEach((dlg) => {
                if (dlg.style.position === "fixed") clampDialog(dlg);
            });
        });
    }

    function openDialogId() {
        return Array.from(document.querySelectorAll(".dialog-backdrop")).find((el) => !el.hidden);
    }

    function wireDialogs() {
        document.querySelectorAll(".dialog-backdrop").forEach((backdrop) => {
            backdrop.addEventListener("mousedown", (e) => {
                if (e.target === backdrop && !backdrop.hasAttribute("data-modal-lock")) closeDialog(backdrop.id);
            });
            backdrop.querySelectorAll("[data-close]").forEach((btn) =>
                btn.addEventListener("click", () => closeDialog(backdrop.id)));
        });

        document.addEventListener("keydown", (e) => {
            const open = openDialogId();
            if (e.key === "Escape") {
                if (pick.active) { cancelPick(); e.preventDefault(); }
                else if (open) { closeDialog(open.id); e.preventDefault(); }
                else if (add.active) { stopAddMode(); e.preventDefault(); }
                return;
            }
            if (e.key === "Tab" && open) {
                const items = focusables(open);
                if (!items.length) return;
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
                else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
            }
        });
    }

    /* ---------- 16. NOTES ---------- */

    function initNotes() {
        const area = $("notes-text");
        const status = $("notes-status");
        let timer = null;

        function save() {
            clearTimeout(timer);
            const ok = store.set(LS.notes, area.value);
            status.style.color = ok ? "" : "#A65343";
            status.textContent = ok ? "Saved" : "Could not save (browser storage unavailable)";
        }

        area.value = store.get(LS.notes) || "";
        area.addEventListener("input", () => {
            status.textContent = "Saving…";
            clearTimeout(timer);
            timer = setTimeout(save, 500);
        });
        $("notes-save").addEventListener("click", save);
        $("btn-notes").addEventListener("click", () => {
            status.textContent = "";
            openDialog("dlg-notes", { onClose: save, focusId: "notes-text" });
        });
    }

    /* ---------- 17. MAP MODES: add custom marker / pick coordinates ---------- */

    const add = { active: false, pending: null, preview: null };
    const pick = { active: false };

    function startAddMode() {
        add.active = true;
        $("btn-add-location").setAttribute("aria-pressed", "true");
        $("map").classList.add("adding");
        $("mode-hint").textContent = "Click the map to choose a location. Esc cancels.";
    }

    function stopAddMode() {
        add.active = false;
        add.pending = null;
        if (add.preview) { map.removeLayer(add.preview); add.preview = null; }
        $("btn-add-location").setAttribute("aria-pressed", "false");
        $("map").classList.remove("adding");
        $("mode-hint").textContent = "";
    }

    function pickPoint(latlng) {
        add.pending = {
            lat: Math.max(-85, Math.min(84, latlng.lat)),
            lon: Math.max(-180, Math.min(180, latlng.lng))
        };
        if (add.preview) map.removeLayer(add.preview);
        add.preview = L.marker([add.pending.lat, add.pending.lon], {
            icon: createPinIcon("custom", false, true), interactive: false, keyboard: false
        }).addTo(map);

        $("add-name").value = "";
        $("add-error").textContent = "";
        $("add-coords").textContent = formatCoords(add.pending.lat, add.pending.lon);
        openDialog("dlg-add", { onClose: stopAddMode, focusId: "add-name" });
    }

    function saveCustomFromDialog() {
        const name = $("add-name").value.trim();
        if (!name) {
            $("add-error").textContent = "Enter a name for the location.";
            $("add-name").focus();
            return;
        }
        const loc = {
            id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name, lat: add.pending.lat, lon: add.pending.lon, status: "custom", custom: true, targets: []
        };
        state.customs.push(loc);
        createMarker(loc);
        saveCustoms();
        closeDialog("dlg-add", true);
        stopAddMode();
        clearFilters();
        applyFilters();
        selectLocation(loc.id, { fly: false });
    }

    function initAddLocation() {
        $("btn-add-location").addEventListener("click", () => {
            if (pick.active) return;
            if (add.active) stopAddMode(); else startAddMode();
        });
        $("add-save").addEventListener("click", saveCustomFromDialog);
        $("add-name").addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); saveCustomFromDialog(); }
        });
    }

    // "Pick coordinates on map" from the record editor: the editor window is
    // hidden while you click the map, then comes back with the coordinates filled in.
    function startPick() {
        if (add.active) stopAddMode();
        $("dlg-editor").hidden = true;
        pick.active = true;
        $("map").classList.add("adding");
        $("mode-hint").textContent = "Click the map to set the record's coordinates. Esc cancels.";
    }
    function endPick() {
        pick.active = false;
        $("map").classList.remove("adding");
        $("mode-hint").textContent = "";
        $("dlg-editor").hidden = false;
    }
    function cancelPick() { endPick(); }
    function finishPick(latlng) {
        ed.draft.lat = Math.max(-85, Math.min(84, latlng.lat)).toFixed(5);
        ed.draft.lon = Math.max(-180, Math.min(180, latlng.lng)).toFixed(5);
        ed.dirty = true;
        endPick();
        renderEditor();
    }

    /* ---------- 18. TOOLBAR, MAP EVENTS, PANEL ACTIONS ---------- */

    function wireControls() {
        $("search-input").addEventListener("input", (e) => { state.filters.query = e.target.value.trim().toLowerCase(); applyFilters(); });
        $("filter-status").addEventListener("change", (e) => { state.filters.status = e.target.value; applyFilters(); });
        $("filter-target").addEventListener("change", (e) => { state.filters.target = e.target.value; applyFilters(); });
        $("clear-filters").addEventListener("click", () => { clearFilters(); applyFilters(); });
        $("reset-view").addEventListener("click", () => { clearSelection(); fitWorld(true); });
        $("btn-add-location").setAttribute("aria-pressed", "false");

        // characteristics: combinable checkboxes inside a classic drop-down
        $("char-options").innerHTML = CHARS.map((c) =>
            `<label class="menu-item"><input type="checkbox" value="${c.key}"> ${esc(c.short)}</label>`).join("") +
            `<div class="menu-note">Sites must match all ticked characteristics.</div>`;
        $("char-options").addEventListener("change", (e) => {
            if (e.target.type !== "checkbox") return;
            if (e.target.checked) state.filters.chars.add(e.target.value); else state.filters.chars.delete(e.target.value);
            updateCharSummary();
            applyFilters();
        });
        document.addEventListener("mousedown", (e) => { if (!e.target.closest("#char-menu")) $("char-menu").open = false; });

        map.on("mousemove", (e) => {
            $("coordinates").textContent = `Lat ${e.latlng.lat.toFixed(4)} | Lon ${e.latlng.lng.toFixed(4)}`;
        });
        map.on("click", (e) => {
            $("coordinates").textContent = `Lat ${e.latlng.lat.toFixed(4)} | Lon ${e.latlng.lng.toFixed(4)}`;
            if (pick.active) finishPick(e.latlng);
            else if (add.active && !add.pending) pickPoint(e.latlng);
            else if (!add.active && state.selectedId) clearSelection();   // click empty map = deselect
        });

        $("info-panel").addEventListener("click", (e) => {
            const a = e.target.closest("[data-action]");
            if (!a) return;
            const id = state.selectedId;
            switch (a.dataset.action) {
                case "overview": clearSelection(); break;
                case "edit": if (id) openEditor(id); break;
                case "compare": if (id) openCompare(id); break;
                case "revert": if (id) revertRecord(id); break;
                case "delete-local": if (id) deleteLocalRecord(id); break;
                case "delete-custom": if (id) deleteCustom(id); break;
                case "new-record": openEditor(null); break;
                case "export": exportJSON(); break;
                default: break;
            }
        });

        $("cmp-body").addEventListener("click", (e) => {
            const b = e.target.closest("[data-body]");
            if (b) { cmp.body = b.dataset.body; renderCompare(); }
        });
    }

    /* ---------- 19. RESIZABLE PANEL ---------- */

    function initDivider() {
        const workspace = $("workspace");
        const divider = $("divider");
        const panel = $("information-panel");

        const MIN_PANEL = 280;
        const MAX_RATIO = 0.70;
        const MIN_MAP = 300;
        let customWidth = null;

        function limits() {
            const w = workspace.clientWidth;
            const max = Math.max(MIN_PANEL, Math.min(w * MAX_RATIO, w - MIN_MAP - 24));
            return { min: MIN_PANEL, max: Math.floor(max) };
        }
        function setWidth(px) {
            const { min, max } = limits();
            customWidth = Math.round(Math.min(max, Math.max(min, px)));
            workspace.style.setProperty("--panel-w", customWidth + "px");
        }
        function reset() { customWidth = null; workspace.style.removeProperty("--panel-w"); }

        divider.addEventListener("pointerdown", (e) => {
            if (MOBILE_QUERY.matches) return;
            e.preventDefault();
            divider.setPointerCapture(e.pointerId);
            divider.classList.add("dragging");
            document.body.classList.add("resizing");
        });
        divider.addEventListener("pointermove", (e) => {
            if (!divider.hasPointerCapture(e.pointerId)) return;
            setWidth(panel.getBoundingClientRect().right - e.clientX - divider.offsetWidth / 2);
        });
        function endDrag(e) {
            if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
            divider.classList.remove("dragging");
            document.body.classList.remove("resizing");
        }
        divider.addEventListener("pointerup", endDrag);
        divider.addEventListener("pointercancel", endDrag);
        divider.addEventListener("dblclick", reset);

        divider.addEventListener("keydown", (e) => {
            const current = panel.getBoundingClientRect().width;
            if (e.key === "ArrowLeft")  { setWidth(current + 24); e.preventDefault(); }
            if (e.key === "ArrowRight") { setWidth(current - 24); e.preventDefault(); }
            if (e.key === "Home" || e.key === "Escape") { reset(); e.preventDefault(); }
        });

        window.addEventListener("resize", () => { if (customWidth !== null) setWidth(customWidth); });
    }

    /* ---------- 20. INITIALISE ---------- */

    async function init() {
        wireDialogs();
        initDialogDrag();
        wireControls();
        wireEditor();
        initDivider();
        initNotes();
        initAddLocation();
        initMethodology();
        initDataManager();

        loadLocal();
        state.customs = loadCustoms();
        renderOverview();     // shows "Loading…" until the JSON arrives

        try {
            state.jsonRecords = await loadData();
            state.dataStatus = "loaded";
        } catch (error) {
            console.error("TIERRA: failed to load research data.", error);
            state.loadFailed = true;
            state.dataStatus = "failed";
            state.loadErrorHTML = buildLoadErrorHTML(error);
        }

        buildEffective();
        rebuildMarkers();
        console.log(`TIERRA initialised: ${state.locations.length} research records (${localCounts().edited} edited, ${localCounts().added} new locally), ${state.customs.length} custom markers.`);
    }

    init();
})();
