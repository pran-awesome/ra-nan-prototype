// RA-NAN หน้า admin: login ด้วย Supabase Auth แล้วอ่าน/เขียนตารางผ่าน RLS (สิทธิ์จริงอยู่ที่ฐานข้อมูล ไม่ใช่ที่หน้านี้)
const cfg = window.RANAN_CONFIG;
const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

const ESRI_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const RANK = { staff: 1, admin: 2, owner: 3 };
const LAND_USES = ["นา", "สวน", "ไร่", "บ่อปลา", "ที่อยู่อาศัย", "ป่า", "อื่น ๆ"];

const state = {
  profile: null,
  plots: [],
  villagers: [],
  area: null,
  selectedPlot: null,
  photoStatus: "pending",
};
const $ = (id) => document.getElementById(id);
const can = (min) => RANK[state.profile?.role] >= RANK[min];

// ==========================================
// DOM helpers (ใช้ textContent เสมอ กัน XSS จากชื่อ/คำบรรยายที่คนพิมพ์)
// ==========================================

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, isError = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = isError ? "error" : "";
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), isError ? 6000 : 3500);
}

// แปลงผลลัพธ์ supabase-js เป็น data หรือ throw พร้อมข้อความภาษาไทย
async function q(promise) {
  const { data, error, count } = await promise;
  if (error) {
    const msg = error.message || String(error);
    if (/duplicate key.*code/i.test(msg)) throw new Error("รหัสแปลงนี้มีอยู่แล้ว");
    if (/row-level security|permission denied/i.test(msg)) throw new Error("ไม่มีสิทธิ์ทำรายการนี้");
    throw new Error(msg);
  }
  return count ?? data;
}

// ห่อ handler ปุ่ม: กันกดซ้ำ + แสดง error
function action(fn) {
  return async (e) => {
    e?.preventDefault?.();
    const btn = e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
    if (btn) btn.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      console.error(err);
      toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };
}

function avatar(url, name, cls = "avatar") {
  if (url) return h("img", { class: cls, src: url, alt: "", loading: "lazy" });
  return h("span", { class: cls }, (name || "?").trim().charAt(0));
}

function fmtDate(s) {
  return new Date(s).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
}

function field(label, input) {
  return h("label", {}, label, input);
}

// กล่องถามข้อมูล คืน object ค่าที่กรอก หรือ null ถ้ายกเลิก
function ask({ title, body = [], fields = [], ok = "ตกลง", cancel = "ยกเลิก", danger = false }) {
  const dialog = $("dialog");
  const form = $("dialog-body");
  const inputs = fields.map((f) => {
    let input;
    if (f.type === "select") {
      input = h("select", { name: f.name }, f.options.map(([v, t]) => h("option", { value: v, selected: v === f.value }, t)));
    } else if (f.type === "textarea") {
      input = h("textarea", { name: f.name, placeholder: f.placeholder || "" });
      input.value = f.value ?? "";
    } else {
      input = h("input", { name: f.name, type: f.type || "text", value: f.value ?? "", required: f.required, placeholder: f.placeholder || "" });
    }
    return field(f.label, input);
  });
  form.replaceChildren(
    h("h3", {}, title),
    ...body,
    ...inputs,
    h("div", { class: "row no-print" },
      h("button", { value: "ok", class: danger ? "danger" : "" }, ok),
      cancel && h("button", { value: "cancel", class: "secondary", formnovalidate: true }, cancel))
  );
  return new Promise((resolve) => {
    dialog.onclose = () => {
      if (dialog.returnValue !== "ok") return resolve(null);
      resolve(Object.fromEntries(new FormData(form)));
    };
    dialog.returnValue = "";
    dialog.showModal();
  });
}

// ==========================================
// Login
// ==========================================

function showLogin() {
  $("app").hidden = true;
  $("login-view").hidden = false;
}

// Supabase Auth ต้องใช้อีเมล จึงแปลง username เป็นอีเมลภายใน (ไม่มีการส่งอีเมลจริง ดู sql/004_username_login.sql)
const USER_DOMAIN = "ra-nan.local";
const normUser = (u) => u.trim().toLowerCase();
const toEmail = (u) => (u.includes("@") ? normUser(u) : `${normUser(u)}@${USER_DOMAIN}`);

$("to-signup").onclick = (e) => { e.preventDefault(); $("login-form").hidden = true; $("signup-form").hidden = false; };
$("to-login").onclick = (e) => { e.preventDefault(); $("login-form").hidden = false; $("signup-form").hidden = true; };

$("login-form").onsubmit = action(async (e) => {
  const f = Object.fromEntries(new FormData(e.target));
  const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(f.username), password: f.password });
  if (error) throw new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  await enterApp(data.user);
});

$("signup-form").onsubmit = action(async (e) => {
  const f = Object.fromEntries(new FormData(e.target));
  const { error } = await sb.rpc("signup_with_invite", {
    p_username: f.username,
    p_token: f.token,
    p_password: f.password,
    p_display_name: f.display_name,
  });
  if (error) {
    const m = error.message;
    if (/NOT_INVITED|OWNER_EXISTS/.test(m)) throw new Error("ชื่อผู้ใช้นี้ยังไม่ได้รับเชิญ หรือรหัสเชิญไม่ถูกต้อง/หมดอายุ");
    if (/USERNAME_TAKEN/.test(m)) throw new Error("ชื่อผู้ใช้นี้สมัครแล้ว ให้เข้าสู่ระบบแทน");
    if (/BAD_USERNAME/.test(m)) throw new Error("ชื่อผู้ใช้ต้องยาว 3-32 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ -");
    if (/WEAK_PASSWORD/.test(m)) throw new Error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
    throw new Error(m);
  }
  const { data, error: loginError } = await sb.auth.signInWithPassword({ email: toEmail(f.username), password: f.password });
  if (loginError) throw new Error("สมัครแล้ว แต่เข้าสู่ระบบไม่สำเร็จ ลองเข้าสู่ระบบอีกครั้ง");
  await enterApp(data.user);
});

function askNewPassword(user) {
  showLogin();
  for (const id of ["login-form", "signup-form"]) $(id).hidden = true;
  $("password-form").hidden = false;
  $("password-form").onsubmit = action(async (e) => {
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.confirm) throw new Error("รหัสผ่านสองช่องไม่ตรงกัน");
    if (f.password === "admin") throw new Error("ห้ามใช้รหัสผ่านเดิม");
    const { error } = await sb.auth.updateUser({ password: f.password });
    if (error) throw new Error(error.message);
    await q(sb.rpc("password_changed"));
    $("password-form").hidden = true;
    $("login-form").hidden = false;
    toast("ตั้งรหัสผ่านใหม่แล้ว");
    await enterApp(user);
  });
}

$("logout").onclick = action(async () => {
  await sb.auth.signOut();
  location.reload();
});

async function enterApp(user) {
  const profile = await q(sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
  if (!profile || !profile.is_active) {
    await sb.auth.signOut();
    showLogin();
    throw new Error("บัญชีนี้ไม่มีสิทธิ์ใช้งาน หรือถูกปิดการใช้งานแล้ว");
  }
  state.profile = profile;
  // บัญชีเริ่มต้น (admin/admin) ต้องตั้งรหัสผ่านใหม่ก่อน
  if (profile.must_change_password) return askNewPassword(user);
  $("login-view").hidden = true;
  $("app").hidden = false;
  $("me-name").textContent = profile.display_name || profile.username;
  $("me-role").textContent = profile.role;
  document.querySelectorAll("[data-min]").forEach((el) => (el.hidden = !can(el.dataset.min)));

  await Promise.all([loadPlots(), loadVillagers()]);
  initMap();
  refreshPendingBadge();
}

// ==========================================
// Tabs
// ==========================================

$("tabs").onclick = action(async (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  await showTab(btn.dataset.tab);
});

async function showTab(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== `tab-${tab}`));
  if (tab === "plots") map?.resize();
  if (tab === "villagers") renderVillagers();
  if (tab === "photos") await loadPhotos();
  if (tab === "team") await loadTeam();
  if (tab === "log") await loadLog();
}

// ==========================================
// Data
// ==========================================

async function loadPlots() {
  const [plots, areas] = await Promise.all([
    q(sb.from("admin_plots").select("*").order("code")),
    q(sb.from("admin_areas").select("*")),
  ]);
  state.plots = plots;
  state.area = areas.find((a) => a.is_active) || null;
  if (state.selectedPlot) state.selectedPlot = plots.find((p) => p.id === state.selectedPlot.id) || null;
  renderPlotLayers();
  renderPlotList();
  renderPlotPanel();
}

async function loadVillagers() {
  state.villagers = await q(
    sb.from("villagers")
      .select("id,full_name,nickname,phone,note,show_on_map,line_user_id,line_display_name,linked_at,avatar_url,created_at")
      .order("full_name")
  );
}

function plotsOfVillager(villagerId) {
  return state.plots.filter((p) => p.villagers.some((v) => v.villager_id === villagerId));
}

function villagerName(v) {
  return v.nickname ? `${v.full_name} (${v.nickname})` : v.full_name;
}

// ==========================================
// แผนที่ + เครื่องมือวาด
// ==========================================

let map = null;
let markers = [];
const draw = { mode: null, coords: [], point: null, onDone: null, onCancel: null, dragIndex: null };

function initMap() {
  if (map) return;
  const bounds = state.area ? bboxOf(state.area.geojson) : [[100.45, 13.645], [100.48, 13.67]];
  map = new maplibregl.Map({
    container: "map",
    bounds,
    fitBoundsOptions: { padding: 30 },
    maxZoom: 20,
    style: {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
          attribution: ESRI_ATTRIBUTION,
        },
      },
      layers: [{ id: "satellite", type: "raster", source: "satellite" }],
    },
  });
  map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "bottom-right");

  // style.load ไม่รอภาพดาวเทียม (ถ้าโหลด tile ไม่ได้ event "load" อาจไม่มาเลย)
  map.once("style.load", () => {
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("area", { type: "geojson", data: empty });
    map.addSource("plots", { type: "geojson", data: empty });
    map.addSource("draft", { type: "geojson", data: empty });
    map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffd54f", "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({
      id: "plots-fill", type: "fill", source: "plots",
      paint: { "fill-color": ["case", ["get", "active"], "#66bb6a", "#9e9e9e"], "fill-opacity": 0.25 },
    });
    map.addLayer({ id: "plots-selected", type: "fill", source: "plots", filter: ["==", ["get", "id"], -1], paint: { "fill-color": "#ffeb3b", "fill-opacity": 0.35 } });
    map.addLayer({ id: "plots-line", type: "line", source: "plots", paint: { "line-color": "#fff", "line-width": 1.5 } });
    map.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#ff9800", "fill-opacity": 0.3 } });
    map.addLayer({ id: "draft-line", type: "line", source: "draft", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#ff9800", "line-width": 2.5 } });
    map.addLayer({
      id: "draft-vertex", type: "circle", source: "draft", filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": ["case", ["==", ["get", "i"], 0], 8, 6], "circle-color": "#ff9800", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });
    renderPlotLayers();

    map.on("click", onMapClick);
    map.on("click", "plots-fill", (e) => {
      if (draw.mode) return;
      selectPlot(e.features[0].properties.id);
    });
    map.on("mouseenter", "plots-fill", () => { if (!draw.mode) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "plots-fill", () => { if (!draw.mode) map.getCanvas().style.cursor = ""; });
    map.on("mousedown", "draft-vertex", startDrag);
    map.on("touchstart", "draft-vertex", startDrag);
    map.on("contextmenu", "draft-vertex", (e) => {
      if (draw.mode !== "edit" || draw.coords.length <= 3) return;
      draw.coords.splice(e.features[0].properties.i, 1);
      renderDraft();
    });
  });
}

function bboxOf(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else c.forEach(walk);
  };
  walk(geojson.coordinates);
  return [[minX, minY], [maxX, maxY]];
}

function renderPlotLayers() {
  if (!map?.getSource("plots")) return;
  map.getSource("area").setData(state.area ? { type: "Feature", geometry: state.area.geojson, properties: {} } : { type: "FeatureCollection", features: [] });
  map.getSource("plots").setData({
    type: "FeatureCollection",
    features: state.plots.map((p) => ({ type: "Feature", geometry: p.geojson, properties: { id: p.id, active: p.is_active } })),
  });
  map.setFilter("plots-selected", ["==", ["get", "id"], state.selectedPlot?.id ?? -1]);

  markers.forEach((m) => m.remove());
  markers = state.plots.map((p) => {
    const v = p.villagers[0];
    const el = h("div", { class: "pin-marker", title: p.name || p.code },
      avatar(v?.avatar_url, v?.nickname || v?.full_name || p.code),
      h("div", { class: "label" }, p.code));
    el.addEventListener("click", (e) => {
      if (draw.mode) return;
      e.stopPropagation();
      selectPlot(p.id);
    });
    return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.pin_lng, p.pin_lat]).addTo(map);
  });
}

// ---- วาด / แก้เส้น / ปักหมุด ----

function startDraw({ mode, coords = [], hint, onDone, onCancel }) {
  Object.assign(draw, { mode, coords: coords.map((c) => [...c]), point: null, onDone, onCancel });
  $("draw-bar").hidden = false;
  $("draw-hint").textContent = hint;
  $("draw-undo").hidden = mode !== "draw";
  $("draw-done").hidden = mode === "pin";
  map.doubleClickZoom.disable();
  map.getCanvas().style.cursor = "crosshair";
  markers.forEach((m) => (m.getElement().style.pointerEvents = "none"));
  renderDraft();
}

function stopDraw() {
  draw.mode = null;
  $("draw-bar").hidden = true;
  map.doubleClickZoom.enable();
  map.getCanvas().style.cursor = "";
  markers.forEach((m) => (m.getElement().style.pointerEvents = ""));
}

function clearDraft() {
  draw.coords = [];
  draw.point = null;
  renderDraft();
}

function renderDraft() {
  const f = [];
  const c = draw.coords;
  if (c.length >= 3) f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...c, c[0]]] }, properties: {} });
  if (c.length >= 2) {
    const line = draw.mode === "draw" ? c : [...c, c[0]];
    f.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} });
  }
  if (draw.mode) c.forEach((p, i) => f.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { i } }));
  if (draw.point) f.push({ type: "Feature", geometry: { type: "Point", coordinates: draw.point }, properties: { i: 0 } });
  map.getSource("draft")?.setData({ type: "FeatureCollection", features: f });
}

function onMapClick(e) {
  if (!draw.mode) return;
  const pt = [e.lngLat.lng, e.lngLat.lat];
  if (draw.mode === "pin") {
    draw.point = pt;
    renderDraft();
    const done = draw.onDone;
    stopDraw();
    done(pt);
    return;
  }
  if (map.queryRenderedFeatures(e.point, { layers: ["draft-vertex"] }).length) {
    // แตะจุดแรกตอนวาด = ปิดรูป
    if (draw.mode === "draw" && draw.coords.length >= 3 &&
        map.queryRenderedFeatures(e.point, { layers: ["draft-vertex"] })[0].properties.i === 0) finishDraw();
    return;
  }
  if (draw.mode === "draw") {
    draw.coords.push(pt);
  } else {
    // โหมดแก้: แตะบนแผนที่ = เพิ่มจุดบนเส้นที่ใกล้ที่สุด
    draw.coords.splice(nearestSegment(e.point) + 1, 0, pt);
  }
  renderDraft();
}

function nearestSegment(px) {
  let best = 0, bestD = Infinity;
  const pts = draw.coords.map((c) => map.project(c));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px.x - a.x) * dx + (px.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px.x - (a.x + t * dx), px.y - (a.y + t * dy));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function startDrag(e) {
  if (draw.mode !== "edit" && draw.mode !== "draw") return;
  if (e.points && e.points.length !== 1) return;
  e.preventDefault();
  draw.dragIndex = e.features[0].properties.i;
  const move = (ev) => {
    draw.coords[draw.dragIndex] = [ev.lngLat.lng, ev.lngLat.lat];
    renderDraft();
  };
  const up = () => {
    map.off("mousemove", move);
    map.off("touchmove", move);
    draw.dragIndex = null;
  };
  map.on("mousemove", move);
  map.on("touchmove", move);
  map.once("mouseup", up);
  map.once("touchend", up);
}

function finishDraw() {
  if (draw.coords.length < 3) return toast("ต้องมีอย่างน้อย 3 จุด", true);
  const coords = draw.coords;
  const done = draw.onDone;
  stopDraw();
  renderDraft();
  done(coords);
}

$("draw-done").onclick = finishDraw;
$("draw-undo").onclick = () => { draw.coords.pop(); renderDraft(); };
$("draw-cancel").onclick = () => {
  const cancel = draw.onCancel;
  stopDraw();
  clearDraft();
  cancel?.();
};
document.addEventListener("keydown", (e) => {
  if (!draw.mode || e.target.matches("input, textarea")) return;
  if (e.key === "Escape") $("draw-cancel").click();
  if (e.key === "Enter") finishDraw();
  if (e.key === "Backspace" && draw.mode === "draw") $("draw-undo").click();
});

const polygonOf = (coords) => ({ type: "Polygon", coordinates: [[...coords, coords[0]]] });

// เส้นแปลงที่แก้ด้วยเครื่องมือได้: polygon เดียว ไม่มีรู
function editableRing(geojson) {
  const polys = geojson.type === "MultiPolygon" ? geojson.coordinates : [geojson.coordinates];
  if (polys.length !== 1 || polys[0].length !== 1) return null;
  return polys[0][0].slice(0, -1);
}

// ==========================================
// แปลง: รายการ + แผงแก้ไข
// ==========================================

$("plot-search").oninput = () => renderPlotList();

function renderPlotList() {
  const term = $("plot-search").value.trim().toLowerCase();
  const items = state.plots.filter((p) =>
    !term || [p.code, p.name, ...p.villagers.map((v) => `${v.full_name} ${v.nickname || ""}`)].join(" ").toLowerCase().includes(term));
  $("plot-list").replaceChildren(
    ...items.map((p) => h("li", { class: p.id === state.selectedPlot?.id ? "active" : "", onclick: () => selectPlot(p.id) },
      avatar(p.villagers[0]?.avatar_url, p.villagers[0]?.nickname || p.villagers[0]?.full_name || p.code),
      h("div", { class: "grow" },
        h("div", {}, h("b", {}, p.code), " ", p.name),
        h("div", { class: "sub" }, p.villagers.map((v) => v.nickname || v.full_name).join(", ") || "ยังไม่มีผู้ใช้แปลง")),
      h("span", { class: "pill" }, `${p.area_rai} ไร่`),
      !p.is_active && h("span", { class: "pill warn" }, "ปิด"))),
    items.length ? "" : h("li", { class: "sub" }, state.plots.length ? "ไม่พบ" : "ยังไม่มีแปลง กด \"+ วาดแปลงใหม่\" เพื่อเริ่ม")
  );
}

function selectPlot(id) {
  state.selectedPlot = state.plots.find((p) => p.id === id) || null;
  clearDraft();
  renderPlotLayers();
  renderPlotList();
  renderPlotPanel();
  if (state.selectedPlot) map.fitBounds(bboxOf(state.selectedPlot.geojson), { padding: 80, maxZoom: 18 });
  if (window.matchMedia("(max-width: 760px)").matches) $("plot-panel").scrollIntoView({ behavior: "smooth" });
}

function nextPlotCode() {
  const nums = state.plots.map((p) => Number(p.code.match(/(\d+)$/)?.[1] || 0));
  return `P-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
}

function plotForm(p) {
  const ro = !can("admin");
  const landUse = h("input", { name: "land_use", list: "land-uses", value: p.land_use || "", disabled: ro });
  return h("form", { id: "plot-form" },
    h("datalist", { id: "land-uses" }, LAND_USES.map((u) => h("option", { value: u }))),
    h("div", { class: "row" },
      h("div", { class: "grow" }, field("รหัสแปลง *", h("input", { name: "code", value: p.code || "", required: true, disabled: ro }))),
      h("div", { class: "grow" }, field("ชื่อแปลง", h("input", { name: "name", value: p.name || "", disabled: ro })))),
    field("ใช้ทำอะไร", landUse),
    field("หมายเหตุ", Object.assign(h("textarea", { name: "note", disabled: ro }), { value: p.note || "" })),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "is_active", checked: p.is_active !== false, disabled: ro }), "ใช้งานอยู่ (แสดงบนแผนที่)")
  );
}

function readPlotForm() {
  const form = $("plot-form");
  const f = Object.fromEntries(new FormData(form));
  if (!f.code?.trim()) throw new Error("กรุณาใส่รหัสแปลง");
  return { code: f.code.trim(), name: f.name?.trim() || "", land_use: f.land_use?.trim() || null, note: f.note?.trim() || null, is_active: form.is_active.checked };
}

async function savePlot(id, fields, geojson, pin) {
  const res = await q(sb.rpc("save_plot", {
    p_id: id, p_code: fields.code, p_name: fields.name, p_land_use: fields.land_use, p_note: fields.note,
    p_geojson: geojson, p_pin: pin, p_is_active: fields.is_active,
  }));
  state.selectedPlot = { id: res.id };
  clearDraft();
  await loadPlots();
  if (res.overlaps.length) toast(`บันทึกแล้ว แต่แปลงนี้ทับกับ ${res.overlaps.join(", ")} เกิน 5% กรุณาตรวจเส้นแปลง`, true);
  else toast("บันทึกแปลงแล้ว");
  return res.id;
}

const currentPin = (p) => (p.pin_moved ? { type: "Point", coordinates: [p.pin_lng, p.pin_lat] } : null);

function renderPlotPanel() {
  const panel = $("plot-panel");
  const p = state.selectedPlot;
  if (!p) return panel.replaceChildren();
  const admin = can("admin");

  const ring = editableRing(p.geojson);
  const assigned = new Set(p.villagers.map((v) => v.villager_id));
  const pick = h("select", { class: "grow" },
    h("option", { value: "" }, "— เลือกชาวบ้าน —"),
    state.villagers.filter((v) => !assigned.has(v.id)).map((v) => h("option", { value: v.id }, villagerName(v))));

  panel.replaceChildren(h("div", { class: "panel" },
    h("div", { class: "row" },
      h("h3", { class: "grow" }, `แปลง ${p.code}`),
      h("span", { class: "pill" }, `${p.area_rai} ไร่`),
      h("span", { class: "pill" }, `${p.photo_count} รูป`),
      h("button", { class: "link", onclick: () => selectPlot(null) }, "ปิด")),
    plotForm(p),
    admin && h("div", { class: "row" },
      h("button", { onclick: action(() => savePlot(p.id, readPlotForm(), p.geojson, currentPin(p))) }, "บันทึก"),
      ring && h("button", {
        class: "secondary",
        onclick: () => startDraw({
          mode: "edit", coords: ring,
          hint: "ลากจุดเพื่อย้าย • แตะเส้นเพื่อเพิ่มจุด • คลิกขวาที่จุดเพื่อลบ",
          onDone: action((coords) => savePlot(p.id, readPlotForm(), polygonOf(coords), currentPin(p))),
        }),
      }, "แก้เส้นแปลง"),
      h("button", {
        class: "secondary",
        onclick: () => startDraw({
          mode: "pin", hint: "แตะตำแหน่งที่จะวางหมุดของแปลงนี้",
          onDone: action((pt) => savePlot(p.id, readPlotForm(), p.geojson, { type: "Point", coordinates: pt })),
        }),
      }, "ย้ายหมุด"),
      p.pin_moved && h("button", { class: "secondary", onclick: action(() => savePlot(p.id, readPlotForm(), p.geojson, null)) }, "หมุดกลางแปลง"),
      h("button", { class: "danger", onclick: action(() => deletePlot(p)) }, "ลบ")),
    !ring && admin && h("p", { class: "muted" }, "แปลงนี้มีหลายส่วนหรือมีรู แก้เส้นในหน้านี้ไม่ได้ ให้นำเข้าไฟล์ใหม่แทน"),
    h("h3", { style: "margin-top:14px" }, "ผู้ใช้แปลง"),
    h("ul", { class: "list" },
      p.villagers.map((v) => h("li", { onclick: () => openVillager(v.villager_id) },
        avatar(v.avatar_url, v.nickname || v.full_name),
        h("div", { class: "grow" }, v.full_name, v.nickname ? ` (${v.nickname})` : ""),
        v.is_primary ? h("span", { class: "pill ok", title: "รูปจาก LINE จะลงแปลงนี้ก่อน" }, "แปลงหลัก") :
          admin && h("button", { class: "link", onclick: action((e) => { e.stopPropagation(); return setPrimary(v); }) }, "ตั้งเป็นแปลงหลัก"),
        admin && h("button", { class: "link", onclick: action((e) => { e.stopPropagation(); return endAssignment(v); }) }, "เลิกใช้"))),
      p.villagers.length ? "" : h("li", { class: "sub" }, "ยังไม่มี")),
    admin && h("div", { class: "row" },
      pick,
      h("button", { onclick: action(() => addAssignment(p, Number(pick.value))) }, "เพิ่มผู้ใช้แปลง"))
  ));
}

async function deletePlot(p) {
  const ok = await ask({
    title: `ลบแปลง ${p.code}?`,
    body: [h("p", {}, `รูป ${p.photo_count} รูปของแปลงนี้จะไม่มีแปลงและหายจากแผนที่ (รูปไม่ถูกลบ) ถ้าแค่เลิกใช้ ให้เอาเครื่องหมาย "ใช้งานอยู่" ออกแทน`)],
    ok: "ลบแปลง", danger: true,
  });
  if (!ok) return;
  await q(sb.from("plots").delete().eq("id", p.id));
  state.selectedPlot = null;
  await loadPlots();
  toast("ลบแปลงแล้ว");
}

async function addAssignment(p, villagerId) {
  if (!villagerId) throw new Error("เลือกชาวบ้านก่อน");
  const first = plotsOfVillager(villagerId).length === 0;
  await q(sb.from("plot_assignments").insert({ plot_id: p.id, villager_id: villagerId, is_primary: first }));
  await loadPlots();
}

async function setPrimary(v) {
  await q(sb.from("plot_assignments").update({ is_primary: false }).eq("villager_id", v.villager_id).is("end_date", null));
  await q(sb.from("plot_assignments").update({ is_primary: true }).eq("id", v.assignment_id));
  await loadPlots();
}

async function endAssignment(v) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  await q(sb.from("plot_assignments").update({ end_date: today, is_primary: false }).eq("id", v.assignment_id));
  await loadPlots();
}

// ---- แปลงใหม่ ----

function showNewPlotForm(geojson) {
  state.selectedPlot = null;
  renderPlotLayers();
  const draft = { code: nextPlotCode(), is_active: true };
  $("plot-panel").replaceChildren(h("div", { class: "panel" },
    h("h3", {}, "แปลงใหม่"),
    plotForm(draft),
    h("div", { class: "row" },
      h("button", { onclick: action(() => savePlot(null, readPlotForm(), geojson, null)) }, "บันทึกแปลง"),
      h("button", {
        class: "secondary",
        onclick: () => startDraw({ mode: "edit", coords: editableRing(geojson), hint: "ลากจุดเพื่อแก้ แล้วกดเสร็จ", onDone: (c) => showNewPlotForm(polygonOf(c)) }),
      }, "แก้เส้น"),
      h("button", { class: "secondary", onclick: () => { clearDraft(); renderPlotPanel(); } }, "ยกเลิก"))
  ));
  draw.coords = editableRing(geojson) || [];
  renderDraft();
  $("plot-form").code.focus();
}

$("new-plot").onclick = () => {
  state.selectedPlot = null;
  renderPlotPanel();
  startDraw({
    mode: "draw",
    hint: "แตะมุมแปลงทีละจุด แตะจุดแรกหรือกด \"เสร็จ\" เพื่อปิดรูป",
    onDone: (coords) => showNewPlotForm(polygonOf(coords)),
  });
};

// กรอกพิกัดมุมแปลง เช่น คัดลอกจาก Google Maps ("13.65709, 100.46593") บรรทัดละจุด
$("coords-plot").onclick = action(async () => {
  const f = await ask({
    title: "กรอกพิกัดมุมแปลง",
    body: [h("p", { class: "muted" }, "บรรทัดละ 1 จุด เรียงตามขอบแปลง อย่างน้อย 3 จุด รูปแบบ \"ละติจูด, ลองจิจูด\" เช่น 13.65709, 100.46593 (คัดลอกจาก Google Maps ได้)")],
    fields: [{ name: "coords", label: "พิกัด", type: "textarea", placeholder: "13.65700, 100.46580\n13.65700, 100.46620\n13.65730, 100.46620" }],
    ok: "แสดงบนแผนที่",
  });
  if (!f) return;
  const coords = parseCoordLines(f.coords);
  showNewPlotForm(polygonOf(coords));
  map.fitBounds(bboxOf(polygonOf(coords)), { padding: 80, maxZoom: 18 });
});

function parseCoordLines(text) {
  const coords = text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const nums = line.match(/-?\d+(\.\d+)?/g)?.map(Number);
    if (!nums || nums.length < 2) throw new Error(`บรรทัด ${i + 1} อ่านพิกัดไม่ได้: ${line}`);
    const [a, b] = nums;
    // ไทยอยู่ที่ lat 5-21, lng 97-106 ถ้าเลขแรกเกิน 90 แปลว่าใส่ lng ก่อน
    return Math.abs(a) > 90 ? [a, b] : [b, a];
  });
  if (coords.length && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1]) coords.pop();
  if (coords.length < 3) throw new Error("ต้องมีอย่างน้อย 3 จุด");
  return coords;
}

// ---- นำเข้าไฟล์ GeoJSON / KML ----

$("import-file").onchange = action(async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const text = await file.text();
  const items = /\.kml$/i.test(file.name) ? parseKml(text) : parseGeoJson(text);
  if (!items.length) throw new Error("ไม่พบรูปหลายเหลี่ยม (Polygon) ในไฟล์");

  let n = state.plots.reduce((m, p) => Math.max(m, Number(p.code.match(/(\d+)$/)?.[1] || 0)), 0);
  const rows = items.map((it) => {
    const code = h("input", { value: it.code || `P-${String(++n).padStart(3, "0")}` });
    const name = h("input", { value: it.name || "" });
    return { it, code, name, el: h("div", { class: "import-item" }, code, name) };
  });
  const ok = await ask({
    title: `นำเข้า ${items.length} แปลง`,
    body: [h("p", { class: "muted" }, "ตรวจรหัส (ซ้าย) และชื่อแปลง (ขวา) ก่อนนำเข้า"), ...rows.map((r) => r.el)],
    ok: "นำเข้าทั้งหมด",
  });
  if (!ok) return;
  const failed = [];
  for (const r of rows) {
    try {
      await q(sb.rpc("save_plot", {
        p_id: null, p_code: r.code.value.trim(), p_name: r.name.value.trim(), p_land_use: null, p_note: null,
        p_geojson: r.it.geometry, p_pin: null, p_is_active: true,
      }));
    } catch (err) {
      failed.push(`${r.code.value}: ${err.message}`);
    }
  }
  await loadPlots();
  if (state.plots.length) map.fitBounds(bboxOf({ type: "MultiPolygon", coordinates: state.plots.flatMap((p) => p.geojson.coordinates) }), { padding: 40 });
  if (failed.length) toast(`นำเข้าไม่ได้ ${failed.length} แปลง: ${failed.join(" | ")}`, true);
  else toast(`นำเข้าแล้ว ${rows.length} แปลง`);
});

const xy = (c) => [Number(c[0]), Number(c[1])];

function parseGeoJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("ไฟล์ไม่ใช่ GeoJSON"); }
  const features = data.type === "FeatureCollection" ? data.features : data.type === "Feature" ? [data] : [{ geometry: data, properties: {} }];
  return features.filter((f) => ["Polygon", "MultiPolygon"].includes(f.geometry?.type)).map((f) => {
    const g = f.geometry;
    const coordinates = g.type === "Polygon" ? g.coordinates.map((r) => r.map(xy)) : g.coordinates.map((p) => p.map((r) => r.map(xy)));
    const pr = f.properties || {};
    return { geometry: { type: g.type, coordinates }, code: pr.code || pr.CODE || "", name: pr.name || pr.Name || pr.NAME || pr.title || "" };
  });
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("ไฟล์ KML อ่านไม่ได้");
  const ring = (el) => el.textContent.trim().split(/\s+/).map((t) => xy(t.split(",")));
  return [...doc.getElementsByTagName("Placemark")].map((pm) => {
    const polys = [...pm.getElementsByTagName("Polygon")].map((poly) => {
      const outer = poly.getElementsByTagName("outerBoundaryIs")[0]?.getElementsByTagName("coordinates")[0];
      const inner = [...poly.getElementsByTagName("innerBoundaryIs")].map((b) => b.getElementsByTagName("coordinates")[0]).filter(Boolean);
      return outer ? [ring(outer), ...inner.map(ring)] : null;
    }).filter(Boolean);
    if (!polys.length) return null;
    const name = pm.getElementsByTagName("name")[0]?.textContent.trim() || "";
    return { geometry: polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys }, code: "", name };
  }).filter(Boolean);
}

// ---- ขอบเขตชุมชน ----

$("edit-area").onclick = action(async () => {
  const f = await ask({
    title: "ขอบเขตชุมชน",
    body: [h("p", { class: "muted" }, "หน้าเว็บสาธารณะจะแสดงเฉพาะแปลงและรูปที่อยู่ในขอบเขตนี้")],
    fields: [
      { name: "name", label: "ชื่อพื้นที่", value: state.area?.name || "", required: true },
      { name: "how", label: "เส้นขอบเขต", type: "select", value: "draw", options: [["draw", "วาดใหม่"], ...(state.area && editableRing(state.area.geojson) ? [["edit", "แก้เส้นเดิม"]] : []), ["plots", "ครอบทุกแปลงอัตโนมัติ"]] },
    ],
    ok: "ต่อไป",
  });
  if (!f) return;
  const slug = state.area && !/ตัวอย่าง/.test(state.area.name) ? state.area.slug : "community";
  const save = action(async (geojson) => {
    await q(sb.rpc("save_area", { p_slug: slug, p_name: f.name.trim(), p_geojson: geojson }));
    clearDraft();
    await loadPlots();
    toast("บันทึกขอบเขตชุมชนแล้ว");
  });
  if (f.how === "plots") {
    if (!state.plots.length) throw new Error("ยังไม่มีแปลง");
    const [[x1, y1], [x2, y2]] = bboxOf({ type: "MultiPolygon", coordinates: state.plots.flatMap((p) => p.geojson.coordinates) });
    const pad = 0.002;
    return save(polygonOf([[x1 - pad, y1 - pad], [x2 + pad, y1 - pad], [x2 + pad, y2 + pad], [x1 - pad, y2 + pad]]));
  }
  startDraw({
    mode: f.how === "edit" ? "edit" : "draw",
    coords: f.how === "edit" ? editableRing(state.area.geojson) : [],
    hint: "วาดขอบเขตชุมชน แล้วกด \"เสร็จ\"",
    onDone: (coords) => save(polygonOf(coords)),
  });
});

// ==========================================
// ชาวบ้าน
// ==========================================

$("villager-search").oninput = () => renderVillagers();
$("new-villager").onclick = () => openVillager(null);

function renderVillagers() {
  const term = $("villager-search").value.trim().toLowerCase();
  const rows = state.villagers.filter((v) => !term || `${v.full_name} ${v.nickname || ""} ${v.phone || ""}`.toLowerCase().includes(term));
  $("villager-rows").replaceChildren(
    ...rows.map((v) => h("tr", { onclick: () => openVillager(v.id) },
      h("td", {}, avatar(v.avatar_url, v.nickname || v.full_name)),
      h("td", {}, v.full_name),
      h("td", {}, v.nickname || ""),
      h("td", {}, v.phone || ""),
      h("td", {}, v.line_user_id ? h("span", { class: "pill ok" }, "ผูกแล้ว") : h("span", { class: "pill warn" }, "ยังไม่ผูก")),
      h("td", {}, plotsOfVillager(v.id).map((p) => p.code).join(", ")),
      h("td", {}, v.show_on_map ? "แสดง" : "ซ่อน"))),
    rows.length ? "" : h("tr", {}, h("td", { colspan: 7, class: "muted" }, state.villagers.length ? "ไม่พบ" : "ยังไม่มีชาวบ้าน"))
  );
}

function openVillager(id) {
  if ($("tab-villagers").hidden) showTab("villagers");
  const v = id ? state.villagers.find((x) => x.id === id) : { show_on_map: true };
  if (!v) return;
  const admin = can("admin");
  const ro = !admin;
  const form = h("form", {},
    h("div", { class: "row" },
      h("div", { class: "grow" }, field("ชื่อ-นามสกุล *", h("input", { name: "full_name", value: v.full_name || "", required: true, disabled: ro }))),
      h("div", { class: "grow" }, field("ชื่อเล่น", h("input", { name: "nickname", value: v.nickname || "", disabled: ro })))),
    field("เบอร์โทร (ไม่แสดงบนเว็บ)", h("input", { name: "phone", value: v.phone || "", disabled: ro })),
    field("หมายเหตุ", Object.assign(h("textarea", { name: "note", disabled: ro }), { value: v.note || "" })),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "show_on_map", checked: v.show_on_map, disabled: ro }), "แสดงชื่อและรูปโปรไฟล์บนแผนที่สาธารณะ"));

  const plots = id ? plotsOfVillager(id) : [];
  $("villager-panel").replaceChildren(h("div", { class: "panel" },
    h("div", { class: "row" },
      id && avatar(v.avatar_url, v.nickname || v.full_name, "avatar lg"),
      h("h3", { class: "grow" }, id ? villagerName(v) : "ชาวบ้านใหม่"),
      h("button", { class: "link", onclick: () => $("villager-panel").replaceChildren() }, "ปิด")),
    form,
    id && h("p", {},
      "LINE: ",
      v.line_user_id
        ? h("span", { class: "pill ok" }, `ผูกแล้ว${v.line_display_name ? ` (${v.line_display_name})` : ""} ${v.linked_at ? fmtDate(v.linked_at) : ""}`)
        : h("span", { class: "pill warn" }, "ยังไม่ผูก")),
    id && h("p", {}, "แปลง: ", plots.length
      ? plots.map((p) => h("button", { class: "link", style: "margin-right:8px", onclick: () => { showTab("plots"); selectPlot(p.id); } }, p.code))
      : h("span", { class: "muted" }, "ยังไม่มี (เพิ่มได้ที่หน้าแปลง)")),
    admin && h("div", { class: "row" },
      h("button", { onclick: action(() => saveVillager(id, form)) }, id ? "บันทึก" : "เพิ่มชาวบ้าน"),
      id && h("button", { class: "secondary", onclick: action(() => showLinkCode(v)) }, v.line_user_id ? "ออกโค้ดผูก LINE ใหม่" : "ออกโค้ดผูก LINE"),
      id && v.line_user_id && h("button", { class: "secondary", onclick: action(() => unlinkLine(v)) }, "ยกเลิกผูก LINE"),
      id && h("button", { class: "danger", onclick: action(() => deleteVillager(v)) }, "ลบ"))
  ));
  $("villager-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveVillager(id, form) {
  const f = Object.fromEntries(new FormData(form));
  const row = {
    full_name: f.full_name.trim(), nickname: f.nickname.trim() || null, phone: f.phone.trim() || null,
    note: f.note.trim() || null, show_on_map: form.show_on_map.checked,
  };
  if (!row.full_name) throw new Error("กรุณาใส่ชื่อ");
  let newId = id;
  if (id) await q(sb.from("villagers").update(row).eq("id", id));
  else newId = (await q(sb.from("villagers").insert(row).select("id").single())).id;
  await Promise.all([loadVillagers(), loadPlots()]);
  renderVillagers();
  openVillager(newId);
  toast("บันทึกแล้ว");
}

async function deleteVillager(v) {
  const ok = await ask({
    title: `ลบ ${v.full_name}?`,
    body: [h("p", {}, "ประวัติการใช้แปลงของคนนี้จะถูกลบ รูปที่เคยส่งยังอยู่แต่จะไม่มีชื่อผู้ส่ง")],
    ok: "ลบ", danger: true,
  });
  if (!ok) return;
  await q(sb.from("villagers").delete().eq("id", v.id));
  $("villager-panel").replaceChildren();
  await Promise.all([loadVillagers(), loadPlots()]);
  renderVillagers();
}

async function unlinkLine(v) {
  const ok = await ask({ title: "ยกเลิกผูก LINE?", body: [h("p", {}, "รูปที่ส่งมาหลังจากนี้จากบัญชี LINE เดิมจะไปรอในกล่องรอจับคู่")], ok: "ยกเลิกผูก", danger: true });
  if (!ok) return;
  await q(sb.rpc("unlink_line", { p_villager: v.id }));
  await loadVillagers();
  openVillager(v.id);
}

async function showLinkCode(v) {
  const code = await q(sb.rpc("create_link_code", { p_villager: v.id }));
  await ask({
    title: `โค้ดผูก LINE ของ ${villagerName(v)}`,
    body: [
      h("div", { class: "code-box" }, code),
      h("ol", {},
        h("li", {}, "เพิ่มเพื่อน LINE ของ RA-NAN"),
        h("li", {}, "พิมพ์ตัวเลข 6 หลักนี้ส่งในแชท"),
        h("li", {}, "ระบบจะตอบว่าผูกบัญชีสำเร็จ ต่อไปส่งรูปได้เลยไม่ต้องส่งตำแหน่ง")),
      h("p", { class: "muted" }, "โค้ดใช้ได้ครั้งเดียว ภายใน 7 วัน ออกโค้ดใหม่แล้วโค้ดเก่าจะใช้ไม่ได้"),
      h("button", { type: "button", class: "secondary no-print", onclick: () => window.print() }, "พิมพ์"),
    ],
    ok: "ปิด", cancel: null,
  });
}

// ==========================================
// รูปที่ส่งเข้ามา
// ==========================================

$("photo-filters").onclick = action(async (e) => {
  const btn = e.target.closest("button[data-status]");
  if (!btn) return;
  state.photoStatus = btn.dataset.status;
  document.querySelectorAll("#photo-filters button").forEach((b) => b.classList.toggle("active", b === btn));
  await loadPhotos();
});

async function refreshPendingBadge() {
  const n = await q(sb.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").not("image_url", "is", null));
  $("pending-badge").textContent = n;
  $("pending-badge").hidden = !n;
}

async function loadPhotos() {
  const rows = await q(
    sb.from("reports")
      .select("id,image_url,created_at,status,caption,user_id,plot_id,villager_id,location_source,address")
      .eq("status", state.photoStatus)
      .not("image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(60)
  );
  const grid = $("photo-grid");
  grid.replaceChildren(...rows.map(photoCard));
  if (!rows.length) grid.append(h("p", { class: "muted" }, "ไม่มีรูปในหมวดนี้"));
  refreshPendingBadge();
}

function photoCard(r) {
  const v = state.villagers.find((x) => x.id === r.villager_id);
  const plotSel = h("select", {},
    h("option", { value: "" }, "— ไม่ระบุแปลง —"),
    state.plots.map((p) => h("option", { value: p.id, selected: p.id === r.plot_id }, `${p.code} ${p.name}`)));
  const caption = Object.assign(h("textarea", { placeholder: "คำบรรยาย / เรื่องเล่า (แสดงบนเว็บ)" }), { value: r.caption || "" });

  const update = async (patch, msg) => {
    await q(sb.from("reports").update(patch).eq("id", r.id));
    toast(msg);
    await loadPhotos();
  };
  const fields = () => ({ plot_id: plotSel.value ? Number(plotSel.value) : null, caption: caption.value.trim() || null });

  let who;
  if (v) {
    who = h("div", { class: "who" }, avatar(v.avatar_url, v.nickname || v.full_name), villagerName(v));
  } else {
    const pick = h("select", {},
      h("option", { value: "" }, "— จับคู่กับชาวบ้าน —"),
      [...state.villagers].sort((a, b) => !!a.line_user_id - !!b.line_user_id)
        .map((x) => h("option", { value: x.id }, `${villagerName(x)}${x.line_user_id ? " (ผูก LINE อื่นอยู่)" : ""}`)));
    who = h("div", {},
      h("div", { class: "who" }, avatar(null, "?"), h("span", { class: "pill warn" }, "LINE ยังไม่ผูก"), h("span", { class: "muted" }, `…${r.user_id.slice(-6)}`)),
      can("admin") && h("div", { class: "row" }, pick,
        h("button", {
          class: "secondary",
          onclick: action(async () => {
            if (!pick.value) throw new Error("เลือกชาวบ้านก่อน");
            await q(sb.rpc("link_line_user", { p_villager: Number(pick.value), p_line_user_id: r.user_id }));
            await loadVillagers();
            toast("จับคู่แล้ว รูปทั้งหมดจาก LINE นี้ย้ายเข้าแปลงหลักของชาวบ้านคนนี้");
            await loadPhotos();
          }),
        }, "จับคู่")));
  }

  return h("div", { class: "photo" },
    h("a", { href: r.image_url, target: "_blank", rel: "noopener" }, h("img", { class: "main", src: r.image_url, alt: "", loading: "lazy" })),
    h("div", { class: "body" },
      h("div", { class: "muted" }, fmtDate(r.created_at), r.location_source === "line_location" ? " • ปักตามตำแหน่งที่ส่งมา" : ""),
      who,
      field("แปลง", plotSel),
      caption,
      h("div", { class: "row" },
        h("button", { class: "secondary", onclick: action(() => update(fields(), "บันทึกแล้ว")) }, "บันทึก"),
        r.status !== "published" && h("button", {
          onclick: action(() => {
            const f = fields();
            if (!f.plot_id && r.location_source !== "line_location") throw new Error("เลือกแปลงก่อน ไม่อย่างนั้นรูปจะไม่มีตำแหน่งบนแผนที่");
            return update({ ...f, status: "published" }, "เผยแพร่แล้ว");
          }),
        }, "เผยแพร่"),
        r.status !== "hidden" && h("button", { class: "secondary", onclick: action(() => update({ ...fields(), status: "hidden" }, "ซ่อนแล้ว")) }, "ซ่อน")))
  );
}

// ==========================================
// ทีมงาน (owner)
// ==========================================

async function loadTeam() {
  const [people, invites] = await Promise.all([
    q(sb.from("profiles").select("*").order("created_at")),
    q(sb.from("staff_invites").select("*").is("used_at", null).order("created_at", { ascending: false })),
  ]);
  const me = state.profile.id;
  $("team-rows").replaceChildren(...people.map((p) => {
    const editable = p.id !== me && p.role !== "owner";
    const role = h("select", { disabled: !editable },
      ["admin", "staff", ...(p.role === "owner" ? ["owner"] : [])].map((r) => h("option", { value: r, selected: r === p.role }, r)));
    const active = h("input", { type: "checkbox", checked: p.is_active, disabled: !editable });
    const save = action(async () => {
      await q(sb.rpc("set_staff", { p_id: p.id, p_role: role.value, p_active: active.checked }));
      toast("บันทึกสิทธิ์แล้ว");
      await loadTeam();
    });
    role.onchange = save;
    active.onchange = save;
    return h("tr", {},
      h("td", {}, p.display_name || "-", p.id === me ? " (คุณ)" : ""),
      h("td", {}, p.username),
      h("td", {}, role),
      h("td", {}, active),
      h("td", {}, editable && p.is_active && h("button", { class: "link", onclick: action(() => transferOwner(p)) }, "โอน owner ให้")));
  }));

  $("invite-list").replaceChildren(...invites.map((i) => h("li", {},
    h("div", { class: "grow" }, h("b", {}, i.username), ` • ${i.role}`,
      h("div", { class: "sub" }, `รหัสเชิญ ${i.token} • หมดอายุ ${fmtDate(i.expires_at)}`)),
    h("button", { class: "link", onclick: action(async () => { await q(sb.from("staff_invites").delete().eq("email", i.email)); await loadTeam(); }) }, "ยกเลิก"))));
}

$("invite-form").onsubmit = action(async (e) => {
  const f = Object.fromEntries(new FormData(e.target));
  const username = normUser(f.username);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error("ชื่อผู้ใช้ต้องยาว 3-32 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ -");
  const inv = await q(sb.from("staff_invites").insert({ email: toEmail(username), role: f.role }).select().single());
  const msg = `เข้า ${location.origin}/admin/ แล้วกด "สมัครที่นี่"\nชื่อผู้ใช้: ${inv.username}\nรหัสเชิญ: ${inv.token}\n(ใช้ได้ถึง ${fmtDate(inv.expires_at)})`;
  $("invite-result").replaceChildren(h("div", { class: "panel" },
    h("p", {}, "ส่งข้อความนี้ให้คนที่เชิญ:"),
    Object.assign(h("textarea", { readonly: true, rows: 4 }), { value: msg }),
    h("button", { class: "secondary", onclick: () => navigator.clipboard.writeText(msg).then(() => toast("คัดลอกแล้ว")) }, "คัดลอก")));
  e.target.reset();
  await loadTeam();
});

async function transferOwner(p) {
  const ok = await ask({
    title: `โอน owner ให้ ${p.display_name || p.username}?`,
    body: [h("p", {}, "คุณจะกลายเป็น admin และจัดการทีมงานไม่ได้อีก จนกว่า owner คนใหม่จะโอนคืน")],
    ok: "โอน owner", danger: true,
  });
  if (!ok) return;
  await q(sb.rpc("transfer_ownership", { p_new_owner: p.id }));
  location.reload();
}

// ==========================================
// ประวัติ
// ==========================================

const TABLE_TH = { plots: "แปลง", villagers: "ชาวบ้าน", plot_assignments: "ผู้ใช้แปลง", reports: "รูป", profiles: "ทีมงาน", staff_invites: "คำเชิญ", areas: "ขอบเขตชุมชน" };
const ACTION_TH = { INSERT: "เพิ่ม", UPDATE: "แก้", DELETE: "ลบ" };

async function loadLog() {
  const [rows, people] = await Promise.all([
    q(sb.from("audit_log").select("*").order("at", { ascending: false }).limit(100)),
    q(sb.from("profiles").select("id,display_name,username")),
  ]);
  const name = (id) => { const p = people.find((x) => x.id === id); return p ? p.display_name || p.username : id ? "?" : "ระบบ/LINE"; };
  $("log-rows").replaceChildren(...rows.map((r) => {
    const obj = r.after || r.before || {};
    const label = obj.code || obj.full_name || obj.username || obj.email || obj.name || `#${r.row_id}`;
    let detail = label;
    if (r.action === "UPDATE") {
      const keys = Object.keys(r.after).filter((k) => !["updated_at", "area_rai"].includes(k) && JSON.stringify(r.after[k]) !== JSON.stringify(r.before[k]));
      detail = `${label}: ${keys.join(", ") || "เส้นแปลง/หมุด"}`;
    }
    return h("tr", {},
      h("td", {}, fmtDate(r.at)), h("td", {}, name(r.actor)), h("td", {}, TABLE_TH[r.table_name] || r.table_name),
      h("td", {}, ACTION_TH[r.action] || r.action), h("td", {}, detail));
  }));
}

// ==========================================
// เริ่มต้น
// ==========================================

(async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  try {
    await enterApp(data.session.user);
  } catch (err) {
    console.error(err);
    toast(err.message, true);
    showLogin();
  }
})();
