// หน้าแรก (landing): ฉากแผนที่ 3 มิติหมุนรอบหมู่บ้าน, ภาพดาวเทียมในกรอบ + ตัวเลข, สัดส่วนการใช้ที่ดิน,
// สไลด์แปลงเด่น, แถวเรื่องเล่าล่าสุด, ผู้คน
(() => {
  const { el, img, link, loadAll, formatNum, formatDay, timeAgo, landUseColor, avatarEl, displayName, plotTitle, peopleLabel, openLightbox } = RN;
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

  function addOverlays(map, data) {
    map.addSource("area", { type: "geojson", data: data.area.geojson });
    map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffe900", "line-width": 2, "line-dasharray": [3, 2] } });
    map.addSource("plots", { type: "geojson", data: plotsGeo(data.plots) });
    map.addLayer({ id: "plots-fill", type: "fill", source: "plots", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 } });
    map.addLayer({ id: "plots-line", type: "line", source: "plots", paint: { "line-color": ["get", "color"], "line-width": 1.6 } });
  }

  function heroMap(data) {
    const hero = document.querySelector(".hero");
    const map = new maplibregl.Map({
      container: "hero-map",
      style: RN.mapStyle({ terrain: true }),
      center: RN.centerOf(data.area.geojson),
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
    map.once("idle", () => hero.classList.add("map-ready"));
    // กันกรณีโหลดภาพช้า: แสดงแผนที่หลังผ่านไป 4 วินาทีอยู่ดี
    setTimeout(() => hero.classList.add("map-ready"), 4000);

    if (reduceMotion) return;
    let visible = true;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(hero);
    let last = performance.now();
    const spin = (t) => {
      const dt = Math.min(t - last, 100);
      last = t;
      if (visible && !document.hidden) map.setBearing(map.getBearing() + dt * 0.003);
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  }

  // ภาพนิ่งจาก Esri export (ไม่ต้องใช้ WebGL) ใช้กับกรอบภาพดาวเทียม สไลด์แปลง และฉากท้ายหน้า
  const R = 6378137;
  const merc = ([lng, lat]) => [(lng * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
  function staticView(geojson, w, h, pad = 1.25) {
    const [[a, b], [c, d]] = RN.bboxOf(geojson);
    const [x0, y0] = merc([a, b]);
    const [x1, y1] = merc([c, d]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let hw = Math.max(((x1 - x0) / 2) * pad, 60), hh = Math.max(((y1 - y0) / 2) * pad, 60);
    if (hw / hh > w / h) hh = (hw * h) / w; else hw = (hh * w) / h;
    const ext = [cx - hw, cy - hh, cx + hw, cy + hh];
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${ext.join(",")}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=jpg&f=image`;
    const project = (pt) => {
      const [x, y] = merc(pt);
      return [((x - ext[0]) / (ext[2] - ext[0])) * w, ((ext[3] - y) / (ext[3] - ext[1])) * h];
    };
    return { url, project };
  }

  const ns = "http://www.w3.org/2000/svg";
  function svgPath(geom, project) {
    const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
    return polys
      .flatMap((poly) => poly.map((ring) => "M" + ring.map((pt) => project(pt).map((n) => n.toFixed(1)).join(",")).join("L") + "Z"))
      .join("");
  }
  function svgLayer(w, h, shapes) {
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    for (const [d, cls, color, i] of shapes) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", cls);
      if (color) path.style.setProperty("--c", color);
      if (i != null) path.style.setProperty("--i", i);
      svg.append(path);
    }
    return svg;
  }

  function miniMap(data) {
    const W = 1200, H = 760;
    const { url, project } = staticView(data.area.geojson, W, H, 1.15);
    const box = document.getElementById("mini-map");
    box.append(img(url, "ภาพดาวเทียมหมู่บ้าน", "mini-sat"));
    box.append(svgLayer(W, H, [
      [svgPath(data.area.geojson, project), "mm-area"],
      ...data.plots.map((p, i) => [svgPath(p.geojson, project), "mm-plot", landUseColor(p.landUse), i]),
    ]));

    const cta = staticView(data.area.geojson, 1600, 800, 3.2);
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
    const nodes = document.querySelectorAll("[data-count]");
    new IntersectionObserver(([e], o) => {
      if (!e.isIntersecting) return;
      o.disconnect();
      nodes.forEach((b) => countUp(b, values[b.dataset.count], b.dataset.count === "rai" ? 1 : 0));
    }, { threshold: 0.4 }).observe(document.getElementById("hero-stats"));
  }

  // ---------- การใช้ที่ดิน ----------
  function breakdown(data) {
    const box = document.getElementById("land-breakdown");
    if (!data.plots.length) {
      box.append(el("p", "empty-note", "ทีมงานกำลังสำรวจและวาดแปลงของหมู่บ้าน เมื่อแปลงแรกขึ้นแผนที่ สัดส่วนนา สวน ไร่ และบ่อปลา จะแสดงตรงนี้"));
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
      li.append(el("span", "bd-pct", `${Math.round((g.rai / total) * 100)}%`), el("span", "bd-name", name), el("span", "bd-val", `${formatNum(g.rai, 1)} ไร่ · ${g.n} แปลง`));
      list.append(li);
    }
    box.append(bar, list);
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { bar.classList.add("in"); o.disconnect(); } }).observe(bar);
  }

  // ---------- สไลด์แปลงเด่น (ภาพครึ่งซ้าย ข้อความครึ่งขวา) ----------
  function plotsSlider(data) {
    const plots = [...data.plots]
      .sort((a, b) => b.photos.length - a.photos.length || (b.lastPhotoAt || "").localeCompare(a.lastPhotoAt || ""))
      .slice(0, 6);
    if (!plots.length) return;
    const section = document.getElementById("plots-slider");
    section.hidden = false;
    const media = document.getElementById("ps-media");
    const text = document.getElementById("ps-text");
    const count = document.getElementById("ps-count");
    let i = 0;

    const slides = plots.map((p) => {
      const fig = el("figure", "ps-slide");
      if (p.photos[0]) {
        fig.append(img(p.photos[0].image_url, p.photos[0].caption || plotTitle(p)));
        fig.classList.add("is-photo");
        fig.onclick = () => openLightbox(p.photos, 0, plotTitle(p));
      } else {
        const W = 900, H = 900;
        const v = staticView(p.geojson, W, H, 2.4);
        fig.append(img(v.url, `ภาพดาวเทียม${plotTitle(p)}`), svgLayer(W, H, [[svgPath(p.geojson, v.project), "ps-outline", landUseColor(p.landUse)]]));
      }
      media.append(fig);
      return fig;
    });

    const show = (n) => {
      i = (n + plots.length) % plots.length;
      const p = plots[i];
      slides.forEach((s, k) => s.classList.toggle("on", k === i));
      count.textContent = `${String(i + 1).padStart(2, "0")} / ${String(plots.length).padStart(2, "0")}`;
      const tag = el("span", "use-tag", p.landUse);
      tag.style.setProperty("--c", landUseColor(p.landUse));
      const facts = [p.area_rai != null ? `${formatNum(p.area_rai, 1)} ไร่` : null, `${formatNum(p.photos.length)} รูป`, p.code].filter(Boolean);
      const body = [
        tag,
        el("h3", "ps-title", plotTitle(p)),
        el("p", "ps-people", p.villagers.length ? `ดูแลโดย ${peopleLabel(p)}` : "ยังไม่มีผู้ดูแลในระบบ"),
        el("p", "ps-facts", facts.join("  ·  ")),
      ];
      const cap = p.stacks[0]?.caption;
      if (cap) body.push(el("blockquote", "ps-quote", cap));
      const go = el("a", "btn btn-line", "ดูแปลงนี้บนแผนที่");
      go.href = link(`map.html#plot=${encodeURIComponent(p.code)}`);
      body.push(go);
      text.replaceChildren(...body);
    };
    document.getElementById("ps-prev").onclick = () => show(i - 1);
    document.getElementById("ps-next").onclick = () => show(i + 1);
    if (plots.length < 2) section.classList.add("single");
    show(0);
  }

  // ---------- เรื่องเล่าล่าสุด ----------
  function railCard(s) {
    const card = el("article", "rail-card");
    const cover = el("button", "rc-cover");
    cover.setAttribute("aria-label", "ดูรูปเต็มจอ");
    cover.append(img(s.photos[0].image_url, s.caption || "รูปจากชาวบ้าน"));
    if (s.photos.length > 1) cover.append(el("span", "rc-count", `${s.photos.length} รูป`));
    cover.onclick = () => openLightbox(s.photos, 0, plotTitle(s.plot));
    const tag = el("span", "use-tag", s.plot.landUse);
    tag.style.setProperty("--c", landUseColor(s.plot.landUse));
    cover.append(tag);

    const body = el("div", "rc-body");
    body.append(el("time", "rc-date", `${formatDay(s.started)} · ${timeAgo(s.latest)}`));
    body.append(el("p", s.caption ? "rc-caption" : "rc-caption muted", s.caption || `${s.photos.length} รูปจากแปลงนี้`));
    const who = el("a", "rc-who");
    who.href = link(`map.html#plot=${encodeURIComponent(s.plot.code)}`);
    if (s.plot.villagers[0]) who.append(avatarEl(s.plot.villagers[0]));
    const t = el("span");
    t.append(el("strong", null, peopleLabel(s.plot) || plotTitle(s.plot)), el("small", null, plotTitle(s.plot)));
    who.append(t);
    body.append(who);
    card.append(cover, body);
    return card;
  }

  function latest(data) {
    const box = document.getElementById("latest-stories");
    const stacks = data.stacks.filter((s) => s.plot).slice(0, 8);
    if (!stacks.length) {
      box.classList.add("is-empty");
      const empty = el("div", "empty-block");
      empty.append(
        el("h3", null, "เรื่องแรกกำลังจะมา"),
        el("p", null, "เมื่อชาวบ้านส่งรูปแรกผ่าน LINE ภาพและคำเล่าจะขึ้นตรงนี้ พร้อมปักบนแผนที่ที่แปลงของคนส่ง"),
      );
      box.append(empty);
      return;
    }
    stacks.forEach((s) => box.append(railCard(s)));
    if (stacks.length < 3) box.classList.add("few");
  }

  // ---------- ผู้คน ----------
  function people(data) {
    const box = document.getElementById("people");
    if (!data.villagers.length) {
      document.getElementById("people-section").hidden = true;
      return;
    }
    for (const v of data.villagers) {
      const a = el("a", "person");
      a.href = link(`map.html#plot=${encodeURIComponent(v.plots[0].code)}`);
      const photo = el("span", "person-photo");
      photo.append(avatarEl(v, "person-img"));
      const n = v.plots.reduce((s, p) => s + p.photos.length, 0);
      a.append(
        photo,
        el("strong", null, displayName(v)),
        el("span", "person-meta", `${[...new Set(v.plots.map((p) => p.landUse))].join(" · ")}${n ? ` — ${formatNum(n)} รูป` : ""}`),
      );
      box.append(a);
    }
    if (data.villagers.length < 4) box.classList.add("few");
  }

  // ---------- เริ่ม ----------
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.12 });
  document.querySelectorAll(".welcome, .land, .plots-slider, .stories-row, .how, .people, .final-cta").forEach((s) => io.observe(s));

  loadAll()
    .then((data) => {
      const name = data.areaTitle.replace(/^ชุมชน/, "");
      document.getElementById("hero-name").textContent = name;
      document.querySelectorAll(".ghost-word, .footer-mark").forEach((n) => (n.textContent = name.replace(/^บ้าน/, "")));
      if (data.areaSub) document.getElementById("hero-place").textContent = data.areaSub;
      document.getElementById("footer-name").textContent = data.areaTitle;
      document.getElementById("footer-sub").textContent = data.areaSub;
      const [lng, lat] = RN.centerOf(data.area.geojson);
      document.getElementById("hero-coord").textContent = `${lat.toFixed(4)}° N   ${lng.toFixed(4)}° E`;
      document.title = `${name} · แผนที่เรื่องเล่าของชุมชน`;
      stats(data);
      breakdown(data);
      plotsSlider(data);
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
