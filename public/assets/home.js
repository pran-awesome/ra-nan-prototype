// หน้าแรก (landing): ฉากแผนที่ 3 มิติหมุนรอบหมู่บ้าน, ตัวเลขสด, สัดส่วนการใช้ที่ดิน, เรื่องเล่าล่าสุด, ผู้คน
(() => {
  const { el, img, link, loadAll, formatNum, landUseColor, landUseIcon, storyCard, avatarEl, displayName } = RN;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  RN.renderNav("home");
  document.querySelectorAll("[data-link]").forEach((a) => (a.href = link(a.dataset.link)));

  // ---------- แผนที่ฉากหลัง ----------
  function plotsGeo(plots) {
    return {
      type: "FeatureCollection",
      features: plots.map((p) => ({ type: "Feature", geometry: p.geojson, properties: { id: p.id, color: landUseColor(p.landUse) } })),
    };
  }

  function addOverlays(map, data, { glow = true } = {}) {
    map.addSource("area", { type: "geojson", data: data.area.geojson });
    if (glow) map.addLayer({ id: "area-glow", type: "line", source: "area", paint: { "line-color": "#ffe08a", "line-width": 14, "line-blur": 12, "line-opacity": 0.55 } });
    map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffe08a", "line-width": 2, "line-dasharray": [3, 2] } });
    map.addSource("plots", { type: "geojson", data: plotsGeo(data.plots) });
    map.addLayer({ id: "plots-fill", type: "fill", source: "plots", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.38 } });
    map.addLayer({ id: "plots-line", type: "line", source: "plots", paint: { "line-color": ["get", "color"], "line-width": 2 } });
  }

  function heroMap(data) {
    const center = RN.centerOf(data.area.geojson);
    const map = new maplibregl.Map({
      container: "hero-map",
      style: RN.mapStyle({ terrain: true }),
      center,
      zoom: 14.7,
      pitch: 64,
      bearing: -20,
      maxPitch: 75,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    map.once("style.load", () => {
      map.setTerrain({ source: "dem", exaggeration: 1.6 });
      addOverlays(map, data);
    });
    map.once("idle", () => document.querySelector(".hero").classList.add("map-ready"));
    // กันกรณีโหลดภาพช้า: แสดงแผนที่หลังผ่านไป 4 วินาทีอยู่ดี
    setTimeout(() => document.querySelector(".hero").classList.add("map-ready"), 4000);

    if (reduceMotion) return;
    let visible = true;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(document.querySelector(".hero"));
    let last = performance.now();
    const spin = (t) => {
      const dt = Math.min(t - last, 100);
      last = t;
      if (visible && !document.hidden) map.setBearing(map.getBearing() + dt * 0.0035);
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  }

  // ภาพนิ่งจาก Esri export (ไม่ต้องใช้ WebGL) ใช้กับการ์ดแผนที่เล็กและฉากท้ายหน้า
  const R = 6378137;
  const merc = ([lng, lat]) => [(lng * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
  function staticView(data, w, h, pad = 1.25) {
    const [[a, b], [c, d]] = RN.bboxOf(data.area.geojson);
    const [x0, y0] = merc([a, b]);
    const [x1, y1] = merc([c, d]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let hw = ((x1 - x0) / 2) * pad, hh = ((y1 - y0) / 2) * pad;
    if (hw / hh > w / h) hh = (hw * h) / w; else hw = (hh * w) / h;
    const ext = [cx - hw, cy - hh, cx + hw, cy + hh];
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${ext.join(",")}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=jpg&f=image`;
    const project = (pt) => {
      const [x, y] = merc(pt);
      return [((x - ext[0]) / (ext[2] - ext[0])) * w, ((ext[3] - y) / (ext[3] - ext[1])) * h];
    };
    return { url, project };
  }

  function svgPath(geom, project) {
    const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
    return polys
      .flatMap((poly) => poly.map((ring) => "M" + ring.map((pt) => project(pt).map((n) => n.toFixed(1)).join(",")).join("L") + "Z"))
      .join("");
  }

  function miniMap(data) {
    const W = 900, H = 900;
    const { url, project } = staticView(data, W, H);
    const box = document.getElementById("mini-map");
    box.append(img(url, "ภาพดาวเทียมหมู่บ้าน", "mini-sat"));
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const area = document.createElementNS(ns, "path");
    area.setAttribute("d", svgPath(data.area.geojson, project));
    area.setAttribute("class", "mm-area");
    svg.append(area);
    data.plots.forEach((p, i) => {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", svgPath(p.geojson, project));
      path.setAttribute("class", "mm-plot");
      path.style.setProperty("--c", landUseColor(p.landUse));
      path.style.setProperty("--i", i);
      svg.append(path);
    });
    box.append(svg);
    if (!data.plots.length) box.append(el("span", "mini-empty", "กำลังวาดแปลงแรก"));

    const cta = staticView(data, 1600, 800, 3.2);
    document.getElementById("cta-map").style.backgroundImage = `url("${cta.url}")`;
  }

  // ---------- ตัวเลข ----------
  function countUp(node, value, digits = 0) {
    if (reduceMotion || !value) return (node.textContent = formatNum(value, digits));
    const start = performance.now(), dur = 1400;
    const tick = (t) => {
      const k = Math.min((t - start) / dur, 1);
      node.textContent = formatNum(value * (1 - Math.pow(1 - k, 3)), k < 1 ? 0 : digits);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function stats(data) {
    const values = { plots: data.plots.length, rai: data.totalRai, people: data.villagers.length, photos: data.reports.length };
    document.querySelectorAll("[data-count]").forEach((b) => countUp(b, values[b.dataset.count], b.dataset.count === "rai" ? 1 : 0));
  }

  // ---------- การใช้ที่ดิน ----------
  function breakdown(data) {
    const box = document.getElementById("land-breakdown");
    if (!data.plots.length) {
      box.append(el("p", "empty-note", "ทีมงานกำลังสำรวจและวาดแปลงของบ้านสบปืน เมื่อแปลงแรกขึ้นแผนที่ สัดส่วนนา สวน ไร่ และบ่อปลา จะแสดงตรงนี้"));
      return;
    }
    const groups = new Map();
    for (const p of data.plots) {
      const g = groups.get(p.landUse) || { rai: 0, n: 0 };
      g.rai += +p.area_rai || 0;
      g.n += 1;
      groups.set(p.landUse, g);
    }
    const total = data.totalRai || 1;
    const rows = [...groups.entries()].sort((a, b) => b[1].rai - a[1].rai);
    const bar = el("div", "bd-bar");
    const list = el("ul", "bd-list");
    for (const [name, g] of rows) {
      const seg = el("span", "bd-seg");
      seg.style.setProperty("--w", `${(g.rai / total) * 100}%`);
      seg.style.setProperty("--c", landUseColor(name));
      seg.title = name;
      bar.append(seg);
      const li = el("li");
      li.style.setProperty("--c", landUseColor(name));
      li.append(el("span", "bd-dot"), el("span", "bd-name", `${landUseIcon(name)} ${name}`), el("span", "bd-val", `${formatNum(g.rai, 1)} ไร่ · ${g.n} แปลง`));
      list.append(li);
    }
    box.append(bar, list);
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { bar.classList.add("in"); o.disconnect(); } }).observe(bar);
  }

  // ---------- เรื่องเล่าล่าสุด ----------
  function latest(data) {
    const box = document.getElementById("latest-stories");
    const stacks = data.stacks.filter((s) => s.plot).slice(0, 5);
    if (!stacks.length) {
      const empty = el("div", "empty-hero");
      empty.append(
        el("span", "empty-icon", "📷"),
        el("h3", null, "เรื่องแรกกำลังจะมา"),
        el("p", null, "เมื่อชาวบ้านส่งรูปแรกผ่าน LINE ภาพและคำเล่าจะขึ้นตรงนี้ทันที พร้อมปักบนแผนที่ที่แปลงของคนส่ง"),
      );
      box.classList.add("is-empty");
      box.append(empty);
      return;
    }
    stacks.forEach((s, i) => box.append(storyCard(s, { large: i === 0 })));
  }

  // ---------- ผู้คน ----------
  function people(data) {
    const box = document.getElementById("people");
    if (!data.villagers.length) {
      document.getElementById("people-section").hidden = true;
      return;
    }
    for (const v of data.villagers) {
      const a = el("a", "person-chip");
      a.href = link(`map.html#plot=${encodeURIComponent(v.plots[0].code)}`);
      const t = el("span", "pc-text");
      t.append(el("strong", null, displayName(v)), el("small", null, v.plots.map((p) => `${landUseIcon(p.landUse)} ${p.landUse}`).join(" · ")));
      a.append(avatarEl(v), t);
      box.append(a);
    }
  }

  // ---------- เริ่ม ----------
  // ตัวเลื่อนปรากฏ (reveal) ของ section ต่าง ๆ
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.15 });
  document.querySelectorAll(".section, .final-cta").forEach((s) => io.observe(s));

  loadAll()
    .then((data) => {
      document.getElementById("hero-name").textContent = data.areaTitle.replace(/^ชุมชน/, "");
      if (data.areaSub) document.getElementById("hero-place").textContent = data.areaSub;
      document.getElementById("footer-name").textContent = data.areaTitle;
      document.getElementById("footer-sub").textContent = data.areaSub;
      const [lng, lat] = RN.centerOf(data.area.geojson);
      document.getElementById("hero-coord").textContent = `${lat.toFixed(4)}°N  ${lng.toFixed(4)}°E`;
      document.title = `${data.areaTitle.replace(/^ชุมชน/, "")} · แผนที่เรื่องเล่าของชุมชน`;
      stats(data);
      breakdown(data);
      latest(data);
      people(data);
      miniMap(data);
      heroMap(data);
    })
    .catch((err) => {
      console.error(err);
      document.querySelector(".hero").classList.add("map-ready");
      RN.showError(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
    });
})();
