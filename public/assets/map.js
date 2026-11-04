// หน้าแผนที่ชุมชน: รายการแปลง (ค้นหา/กรอง/เรียง) + แผนที่ดาวเทียม + แผงรายละเอียดแปลงพร้อมเรื่องเล่าตามเวลา
(() => {
  const { el, img, loadAll, landUseColor, landUseIcon, formatNum, formatDate, formatDay, timeAgo, plotTitle, peopleLabel, avatarEl, facesEl, displayName, openLightbox } = RN;

  RN.renderNav("map");

  const $ = (id) => document.getElementById(id);
  const panel = $("panel");
  const isMobile = () => matchMedia("(max-width: 860px)").matches;
  const state = { use: "all", q: "", sort: "recent", selected: null };
  let data, map;
  const markers = new Map();

  // ---------- แผงด้านข้าง / bottom sheet บนมือถือ ----------
  const PANEL_STATES = ["peek", "half", "full"];
  $("panel-grip").onclick = () => {
    const i = PANEL_STATES.indexOf(panel.dataset.state);
    panel.dataset.state = PANEL_STATES[(i + 1) % PANEL_STATES.length];
  };
  let dragY = null;
  $("panel-grip").addEventListener("touchstart", (e) => (dragY = e.touches[0].clientY), { passive: true });
  $("panel-grip").addEventListener("touchend", (e) => {
    if (dragY == null) return;
    const dy = e.changedTouches[0].clientY - dragY;
    const i = PANEL_STATES.indexOf(panel.dataset.state);
    if (Math.abs(dy) > 30) panel.dataset.state = PANEL_STATES[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))];
    dragY = null;
  });

  // ---------- รายการ ----------
  function matches(p) {
    if (state.use !== "all" && p.landUse !== state.use) return false;
    if (!state.q) return true;
    const hay = [p.code, p.name, p.land_use, ...p.villagers.flatMap((v) => [v.name, v.nickname])].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(state.q.toLowerCase());
  }

  const sorters = {
    recent: (a, b) => (b.lastPhotoAt || "").localeCompare(a.lastPhotoAt || "") || a.code.localeCompare(b.code, "th"),
    photos: (a, b) => b.photos.length - a.photos.length,
    size: (a, b) => (+b.area_rai || 0) - (+a.area_rai || 0),
    name: (a, b) => plotTitle(a).localeCompare(plotTitle(b), "th"),
  };

  function renderChips() {
    const counts = new Map();
    for (const p of data.plots) counts.set(p.landUse, (counts.get(p.landUse) || 0) + 1);
    const box = $("use-chips");
    box.replaceChildren();
    const chip = (key, label, color) => {
      const b = el("button", "chip", label);
      b.setAttribute("aria-pressed", String(state.use === key));
      if (color) b.style.setProperty("--c", color);
      b.onclick = () => { state.use = state.use === key && key !== "all" ? "all" : key; renderChips(); applyFilter(); };
      box.append(b);
    };
    chip("all", `ทั้งหมด ${data.plots.length}`);
    for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) chip(k, `${k} ${n}`, landUseColor(k));
    box.hidden = counts.size < 2;
  }

  function plotItem(p) {
    const li = el("li");
    const b = el("button", "plot-item");
    b.style.setProperty("--c", landUseColor(p.landUse));
    const thumb = el("span", "pi-thumb");
    if (p.photos[0]) thumb.append(img(p.photos[0].image_url, ""));
    else thumb.append(el("span", "pi-icon", landUseIcon(p.landUse)));
    if (p.photos.length) thumb.append(el("span", "pi-count", String(p.photos.length)));
    const text = el("span", "pi-text");
    text.append(el("strong", null, plotTitle(p)));
    if (p.villagers.length) {
      const who = el("span", "pi-who");
      who.append(facesEl(p.villagers, 3), el("span", null, peopleLabel(p)));
      text.append(who);
    }
    const meta = [p.landUse, p.area_rai != null ? `${formatNum(p.area_rai, 1)} ไร่` : null, p.lastPhotoAt ? `อัปเดต${timeAgo(p.lastPhotoAt)}` : "ยังไม่มีรูป"].filter(Boolean);
    text.append(el("span", "pi-meta", meta.join(" · ")));
    b.append(thumb, text);
    b.onclick = () => select(p.id);
    b.onmouseenter = () => hover(p.id, true);
    b.onmouseleave = () => hover(p.id, false);
    li.append(b);
    return li;
  }

  function applyFilter() {
    const list = $("plot-list");
    const shown = data.plots.filter(matches).sort(sorters[state.sort]);
    list.replaceChildren(...shown.map(plotItem));
    $("result-count").textContent = data.plots.length ? `พบ ${shown.length} แปลง` : "";
    if (!data.plots.length) {
      const li = el("li", "list-empty");
      li.append(el("strong", null, "ยังไม่มีแปลงบนแผนที่"), el("p", null, "ทีมงานชุมชนกำลังวาดขอบแปลงจากภาพดาวเทียม เส้นประสีเหลืองคือขอบเขตของหมู่บ้าน"));
      list.append(li);
    } else if (!shown.length) {
      list.append(el("li", "list-empty", "ไม่พบแปลงที่ตรงกับคำค้น"));
    }
    const ids = new Set(shown.map((p) => p.id));
    if (map?.getSource("plots")) for (const p of data.plots) map.setFeatureState({ source: "plots", id: p.id }, { dim: !ids.has(p.id) });
    for (const [id, m] of markers) m.getElement().classList.toggle("dim", !ids.has(id));
  }

  $("q").addEventListener("input", (e) => { state.q = e.target.value.trim(); applyFilter(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; applyFilter(); });

  // ---------- รายละเอียดแปลง ----------
  function renderDetail(p) {
    const box = $("detail");
    box.replaceChildren();
    box.style.setProperty("--c", landUseColor(p.landUse));

    const cover = el("div", "d-cover");
    if (p.photos[0]) {
      const im = img(p.photos[0].image_url, p.photos[0].caption || "รูปล่าสุดจากแปลงนี้");
      cover.append(im);
      cover.onclick = () => openLightbox([...p.photos], 0, plotTitle(p));
      cover.classList.add("has-photo");
    } else cover.append(el("span", "d-cover-icon", landUseIcon(p.landUse)));
    const tag = el("span", "use-tag", p.landUse);
    tag.style.setProperty("--c", landUseColor(p.landUse));
    cover.append(tag);
    box.append(cover);

    box.append(el("h2", "d-title", plotTitle(p)));
    const facts = el("div", "d-facts");
    const fact = (v, k) => { const f = el("div", "fact"); f.append(el("b", null, v), el("span", null, k)); facts.append(f); };
    fact(p.area_rai != null ? formatNum(p.area_rai, 1) : "–", "ไร่");
    fact(formatNum(p.photos.length), "รูป");
    fact(formatNum(p.stacks.length), "เรื่องเล่า");
    fact(p.code, "รหัสแปลง");
    box.append(facts);

    if (p.villagers.length) {
      const people = el("div", "d-people");
      people.append(el("p", "d-label", "ผู้ดูแลแปลง"));
      for (const v of p.villagers) {
        const row = el("div", "d-person");
        const t = el("span");
        t.append(el("strong", null, displayName(v)));
        if (v.nickname && v.nickname !== v.name) t.append(el("small", null, v.name));
        row.append(avatarEl(v), t);
        people.append(row);
      }
      box.append(people);
    }

    const tl = el("div", "timeline");
    tl.append(el("p", "d-label", p.stacks.length ? "เรื่องเล่าจากแปลงนี้" : "เรื่องเล่า"));
    if (!p.stacks.length) {
      tl.append(el("p", "empty-note", "ยังไม่มีรูปจากแปลงนี้ เมื่อผู้ดูแลแปลงส่งรูปผ่าน LINE จะขึ้นที่นี่ทันที"));
    }
    for (const s of p.stacks) {
      const item = el("article", "tl-item");
      const head = el("div", "tl-head");
      head.append(el("time", null, formatDay(s.started)), el("span", null, `${timeAgo(s.latest)} · ${s.photos.length} รูป`));
      item.append(head);
      if (s.caption) item.append(el("p", "tl-caption", s.caption));
      const grid = el("div", `tl-grid n${Math.min(s.photos.length, 4)}`);
      s.photos.forEach((ph, i) => {
        const btn = el("button", "tl-photo");
        btn.setAttribute("aria-label", ph.caption || `รูปที่ ${i + 1}`);
        btn.append(img(ph.image_url, ph.caption || ""));
        if (ph.caption && ph.caption !== s.caption) btn.append(el("span", "tl-pcap", ph.caption));
        btn.onclick = () => openLightbox(s.photos, i, plotTitle(p));
        grid.append(btn);
      });
      item.append(grid);
      tl.append(item);
    }
    box.append(tl);
  }

  function select(id, { fly = true, push = true } = {}) {
    const p = data.plots.find((x) => x.id === id);
    if (!p) return;
    if (state.selected != null && map.getSource("plots")) map.setFeatureState({ source: "plots", id: state.selected }, { selected: false });
    state.selected = id;
    map.setFeatureState({ source: "plots", id }, { selected: true });
    for (const [mid, m] of markers) m.getElement().classList.toggle("selected", mid === id);
    renderDetail(p);
    $("list-view").hidden = true;
    $("detail-view").hidden = false;
    panel.scrollTop = 0;
    $("detail-view").scrollTop = 0;
    if (isMobile()) panel.dataset.state = "half";
    if (push) history.replaceState(null, "", `#plot=${encodeURIComponent(p.code)}`);
    if (fly) {
      const mobile = isMobile();
      map.fitBounds(RN.bboxOf(p.geojson), {
        padding: mobile ? { top: 90, bottom: window.innerHeight * 0.55, left: 50, right: 70 } : { top: 140, bottom: 140, left: 160, right: 160 },
        maxZoom: 17.4,
        duration: 1400,
        pitch: map.getPitch(),
      });
    }
  }

  function deselect() {
    if (state.selected != null) map.setFeatureState({ source: "plots", id: state.selected }, { selected: false });
    for (const m of markers.values()) m.getElement().classList.remove("selected");
    state.selected = null;
    $("detail-view").hidden = true;
    $("list-view").hidden = false;
    history.replaceState(null, "", location.pathname + location.search);
  }
  $("back").onclick = deselect;

  function hover(id, on) {
    if (map?.getSource("plots")) map.setFeatureState({ source: "plots", id }, { hover: on });
    markers.get(id)?.getElement().classList.toggle("hover", on);
  }

  function fromHash() {
    const m = location.hash.match(/plot=([^&]+)/);
    if (!m) return false;
    const code = decodeURIComponent(m[1]);
    const p = data.plots.find((x) => x.code === code);
    if (p) select(p.id, { push: false });
    return !!p;
  }
  window.addEventListener("hashchange", fromHash);

  // ---------- แผนที่ ----------
  function plotPin(p) {
    const pin = el("button", "plot-pin");
    pin.style.setProperty("--c", landUseColor(p.landUse));
    pin.setAttribute("aria-label", plotTitle(p));
    const bubble = el("span", "pin-bubble");
    if (p.villagers.length) bubble.append(facesEl(p.villagers, 3));
    else bubble.append(el("span", "avatar pin-icon", landUseIcon(p.landUse)));
    if (p.photos.length) bubble.append(el("span", "pin-count", String(p.photos.length)));
    pin.append(bubble, el("span", "pin-name", p.villagers.length ? peopleLabel(p) : plotTitle(p)));
    pin.onclick = (e) => { e.stopPropagation(); select(p.id); };
    pin.onmouseenter = () => hover(p.id, true);
    pin.onmouseleave = () => hover(p.id, false);
    return pin;
  }

  function legend() {
    const box = $("legend");
    const toggle = el("button", "lg-toggle", "สัญลักษณ์");
    toggle.setAttribute("aria-expanded", String(!isMobile()));
    box.classList.toggle("collapsed", isMobile());
    toggle.onclick = () => {
      const open = box.classList.toggle("collapsed") === false;
      toggle.setAttribute("aria-expanded", String(open));
    };
    box.append(toggle);
    const uses = [...new Set(data.plots.map((p) => p.landUse))];
    const row = (cls, label, color) => {
      const r = el("div", "lg-row");
      const sw = el("span", `lg-sw ${cls}`);
      if (color) sw.style.setProperty("--c", color);
      r.append(sw, el("span", null, label));
      box.append(r);
    };
    row("area", "ขอบเขตชุมชน");
    uses.forEach((u) => row("plot", u, landUseColor(u)));
    if (data.reports.some((r) => r.own_location || r.plot_id == null)) row("dot", "รูปที่ปักตำแหน่งเอง");
  }

  let terrainOn = false;
  function set3d(on) {
    terrainOn = on;
    $("toggle-3d").setAttribute("aria-pressed", String(on));
    map.setTerrain(on ? { source: "dem", exaggeration: 1.5 } : null);
    map.easeTo({ pitch: on ? 62 : 0, bearing: on ? map.getBearing() || -18 : 0, duration: 1200 });
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: RN.mapStyle({ terrain: true }),
      bounds: RN.bboxOf(data.area.geojson),
      fitBoundsOptions: { padding: isMobile() ? { top: 60, bottom: window.innerHeight * 0.3, left: 20, right: 20 } : 60 },
      maxZoom: 19,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "bottom-right");
    $("toggle-3d").onclick = () => set3d(!terrainOn);
    $("fit-area").onclick = () => map.fitBounds(RN.bboxOf(data.area.geojson), { padding: 60, duration: 1200 });

    // ใช้ style.load ไม่ใช่ load: event "load" รอภาพดาวเทียมครบก่อน ถ้าโหลด tile ไม่ได้ หมุดจะไม่ขึ้นเลย
    map.once("style.load", () => {
      map.addSource("area", { type: "geojson", data: data.area.geojson });
      map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffe900", "line-width": 2, "line-dasharray": [3, 2] } });

      map.addSource("plots", {
        type: "geojson",
        promoteId: "id",
        data: {
          type: "FeatureCollection",
          features: data.plots.map((p) => ({ type: "Feature", geometry: p.geojson, properties: { id: p.id, color: landUseColor(p.landUse) } })),
        },
      });
      const fs = (k) => ["boolean", ["feature-state", k], false];
      map.addLayer({
        id: "plots-fill", type: "fill", source: "plots",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", fs("selected"), 0.5, fs("dim"), 0.06, fs("hover"), 0.45, 0.28],
        },
      });
      map.addLayer({
        id: "plots-line", type: "line", source: "plots",
        paint: {
          "line-color": ["case", fs("selected"), "#ffffff", ["get", "color"]],
          "line-width": ["case", fs("selected"), 3.5, fs("hover"), 3, 1.8],
          "line-opacity": ["case", fs("dim"), 0.25, 1],
        },
      });

      for (const p of data.plots) {
        const m = new maplibregl.Marker({ element: plotPin(p), anchor: "bottom" }).setLngLat([p.pin_lng, p.pin_lat]).addTo(map);
        markers.set(p.id, m);
      }
      map.on("click", "plots-fill", (e) => select(e.features[0].properties.id));
      map.on("mousemove", "plots-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "plots-fill", () => (map.getCanvas().style.cursor = ""));

      // รูปที่ปักตำแหน่งเอง หรือไม่มีแปลง แสดงเป็นจุดแยก
      const loose = data.reports.filter((r) => r.own_location || !data.plots.some((p) => p.id === r.plot_id));
      map.addSource("loose", {
        type: "geojson",
        data: { type: "FeatureCollection", features: loose.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.longitude, r.latitude] }, properties: { id: r.id } })) },
      });
      map.addLayer({
        id: "loose", type: "circle", source: "loose",
        paint: { "circle-radius": 7, "circle-color": "#ffe900", "circle-stroke-color": "#1d1d1b", "circle-stroke-width": 2.5 },
      });
      map.on("click", "loose", (e) => {
        const r = loose.find((x) => x.id === e.features[0].properties.id);
        if (r) openLightbox([r], 0, r.address || "");
      });
      map.on("mouseenter", "loose", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "loose", () => (map.getCanvas().style.cursor = ""));

      applyFilter();
      fromHash();
    });
  }

  loadAll()
    .then((d) => {
      data = d;
      $("area-name").textContent = data.area.name;
      const people = data.villagers.length;
      $("summary").textContent = data.plots.length
        ? `${formatNum(data.plots.length)} แปลง · ${formatNum(data.totalRai, 1)} ไร่ · ${formatNum(people)} คน · ${formatNum(data.reports.length)} รูป`
        : "ขอบเขตหมู่บ้านพร้อมแล้ว รอแปลงแรก";
      document.title = `แผนที่ชุมชน · ${data.areaTitle.replace(/^ชุมชน/, "")}`;
      renderChips();
      legend();
      applyFilter();
      initMap();
    })
    .catch((err) => {
      console.error(err);
      RN.showError(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
    });
})();
