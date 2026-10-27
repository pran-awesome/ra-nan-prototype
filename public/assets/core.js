// โค้ดที่ทุกหน้าสาธารณะใช้ร่วมกัน: โหลดข้อมูลจาก view สาธารณะ, จัดกลุ่มรูปเป็นชุด, ตัวช่วยสร้าง DOM, แถบเมนู, lightbox
// หน้าเว็บอ่านได้แค่ public_areas / public_plots / public_reports (ดู FRONTEND_HANDOFF.md ข้อ 3)
(() => {
  const cfg = window.RANAN_CONFIG;

  const LAND_USE = {
    "นา": { color: "#e8c547", icon: "🌾" },
    "สวน": { color: "#7cc95a", icon: "🌳" },
    "ไร่": { color: "#d4904a", icon: "🌽" },
    "บ่อปลา": { color: "#4fb3e0", icon: "🐟" },
    "ที่อยู่อาศัย": { color: "#ef8a6b", icon: "🏡" },
    "ป่า": { color: "#2f9e62", icon: "🌲" },
    "อื่น ๆ": { color: "#b9b2a5", icon: "📍" },
  };
  const landUseOf = (p) => (p.land_use && LAND_USE[p.land_use] ? p.land_use : p.land_use ? "อื่น ๆ" : "ไม่ระบุ");
  const landUseColor = (name) => (LAND_USE[name] || { color: "#cfc9bd" }).color;
  const landUseIcon = (name) => (LAND_USE[name] || { icon: "📍" }).icon;

  async function fetchView(view, query) {
    if (cfg.useSampleData) {
      const sample = await (await fetch("sample/sample-data.json")).json();
      return sample[view];
    }
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${view}?${query}`, { headers: { apikey: cfg.supabaseKey } });
    if (!res.ok) throw new Error(`${view}: HTTP ${res.status}`);
    return res.json();
  }

  // รูปที่ส่งในชุดเดียวกัน (stack_started_at เท่ากัน, ดู sql/005_photo_stacks.sql) รวมเป็น "เรื่อง" เดียว
  function buildStacks(reports, plotById) {
    const groups = new Map();
    for (const r of reports) {
      const key = `${r.plot_id ?? "x"}|${r.stack_started_at || r.created_at}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return [...groups.entries()]
      .map(([key, photos]) => {
        photos.sort((a, b) => a.created_at.localeCompare(b.created_at));
        const plot = plotById.get(photos[0].plot_id) || null;
        return {
          key,
          plot,
          photos,
          started: photos[0].stack_started_at || photos[0].created_at,
          latest: photos[photos.length - 1].created_at,
          caption: photos.find((p) => p.caption)?.caption || "",
        };
      })
      .sort((a, b) => b.latest.localeCompare(a.latest));
  }

  let cache;
  function loadAll() {
    cache ||= (async () => {
      const [areas, plots, reports] = await Promise.all([
        fetchView("public_areas", "select=slug,name,geojson"),
        fetchView("public_plots", "select=id,code,name,land_use,area_rai,geojson,pin_lng,pin_lat,villagers"),
        fetchView("public_reports", "select=id,image_url,caption,address,latitude,longitude,created_at,plot_id,own_location,stack_started_at&order=created_at.desc"),
      ]);
      const area = areas[0];
      if (!area) throw new Error("ยังไม่มีพื้นที่ที่เปิดใช้งาน");
      const plotById = new Map(plots.map((p) => [p.id, p]));
      const byPlot = new Map(plots.map((p) => [p.id, []]));
      for (const r of reports) if (byPlot.has(r.plot_id)) byPlot.get(r.plot_id).push(r);
      for (const p of plots) {
        p.photos = byPlot.get(p.id);
        p.lastPhotoAt = p.photos[0]?.created_at || null;
        p.landUse = landUseOf(p);
      }
      const stacks = buildStacks(reports, plotById);
      for (const p of plots) p.stacks = stacks.filter((s) => s.plot === p);

      // ชาวบ้านไม่มี id บน view สาธารณะ ใช้ชื่อ+รูปเป็นตัวระบุ
      const people = new Map();
      for (const p of plots)
        for (const v of p.villagers) {
          const k = `${v.name}|${v.avatar_url || ""}`;
          if (!people.has(k)) people.set(k, { ...v, plots: [] });
          people.get(k).plots.push(p);
        }

      const [title, ...rest] = area.name.split(" ");
      return {
        area,
        areaTitle: title,
        areaSub: rest.join(" "),
        plots,
        reports,
        stacks,
        villagers: [...people.values()],
        totalRai: plots.reduce((s, p) => s + (+p.area_rai || 0), 0),
      };
    })();
    return cache;
  }

  // สร้าง DOM ด้วย textContent เสมอ (ชื่อ/คำบรรยายมาจากคนพิมพ์ กัน XSS)
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function img(src, alt, className) {
    const i = el("img", className);
    i.src = src;
    i.alt = alt || "";
    i.loading = "lazy";
    i.decoding = "async";
    return i;
  }

  const displayName = (v) => v.nickname || v.name;

  function avatarEl(person, className = "avatar") {
    if (person?.avatar_url) return img(person.avatar_url, "", className);
    return el("span", className, (displayName(person || {}) || "?").trim().charAt(0));
  }

  function facesEl(people, max = 3) {
    const f = el("span", "faces");
    people.slice(0, max).forEach((v) => f.append(avatarEl(v)));
    if (people.length > max) f.append(el("span", "avatar more", `+${people.length - max}`));
    return f;
  }

  const TZ = "Asia/Bangkok";
  const formatDate = (s, opts = { dateStyle: "medium", timeStyle: "short" }) =>
    new Date(s).toLocaleString("th-TH", { ...opts, timeZone: TZ });
  const formatDay = (s) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });

  const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
  function timeAgo(s) {
    const sec = (new Date(s) - Date.now()) / 1000;
    const steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.345, "week"], [12, "month"], [Infinity, "year"]];
    let v = sec;
    for (const [n, unit] of steps) {
      if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
      v /= n;
    }
  }

  const formatNum = (n, digits = 0) => Number(n).toLocaleString("th-TH", { maximumFractionDigits: digits });

  const plotTitle = (p) => p.name || (p.villagers.length ? `แปลงของ${displayName(p.villagers[0])}` : `แปลง ${p.code}`);
  const peopleLabel = (p) => p.villagers.map(displayName).join(", ");

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
  const centerOf = (g) => {
    const [[a, b], [c, d]] = bboxOf(g);
    return [(a + c) / 2, (b + d) / 2];
  };

  // ภาพดาวเทียม Esri + ความสูงภูมิประเทศ (AWS Terrain Tiles, ไม่ต้องใช้ key) สำหรับมุมมอง 3 มิติ
  function mapStyle({ terrain = false } = {}) {
    const style = {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Terrain © Mapzen/AWS",
        },
      },
      layers: [{ id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": 0.08, "raster-contrast": 0.06 } }],
    };
    if (terrain) {
      style.sources.dem = {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 14,
        encoding: "terrarium",
      };
      style.sky = {
        "sky-color": "#9cc6e8",
        "horizon-color": "#f3e3c3",
        "fog-color": "#e9e2d0",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.85,
      };
    }
    return style;
  }

  // แถบเมนูบนสุด (ทุกหน้า)
  function renderNav(active) {
    const nav = document.querySelector(".site-nav");
    if (!nav) return;
    const links = [
      ["index.html", "หน้าแรก", "home"],
      ["map.html", "แผนที่ชุมชน", "map"],
      ["stories.html", "เรื่องเล่า", "stories"],
    ];
    const brand = el("a", "brand");
    brand.href = "index.html";
    brand.append(el("span", "brand-mark", "ส"), el("span", "brand-text", "สบปืน"));
    const ul = el("nav", "nav-links");
    for (const [href, label, key] of links) {
      const a = el("a", key === active ? "active" : null, label);
      a.href = href + (cfg.useSampleData ? "?sample" : "");
      ul.append(a);
    }
    brand.href += cfg.useSampleData ? "?sample" : "";
    nav.replaceChildren(brand, ul);
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ลิงก์ภายในเว็บต้องพก ?sample ไปด้วย (ตอนทำ UI ด้วยข้อมูลตัวอย่าง)
  const link = (href) => {
    if (!cfg.useSampleData) return href;
    const [path, hash] = href.split("#");
    return `${path}?sample${hash ? `#${hash}` : ""}`;
  };

  // ดูรูปเต็มจอ: ปัดซ้ายขวา / ปุ่มลูกศร / Esc
  function openLightbox(photos, index = 0, context = "") {
    let i = index;
    const box = el("div", "lightbox");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const stage = el("div", "lb-stage");
    const picture = el("img", "lb-img");
    const meta = el("div", "lb-meta");
    const close = el("button", "lb-close", "×");
    close.setAttribute("aria-label", "ปิด");
    const prev = el("button", "lb-nav prev", "‹");
    const next = el("button", "lb-nav next", "›");
    prev.setAttribute("aria-label", "รูปก่อนหน้า");
    next.setAttribute("aria-label", "รูปถัดไป");
    stage.append(picture);
    box.append(stage, meta, close);
    if (photos.length > 1) box.append(prev, next);

    const show = () => {
      const p = photos[i];
      picture.src = p.image_url;
      picture.alt = p.caption || "รูปจากชาวบ้าน";
      meta.replaceChildren();
      if (p.caption) meta.append(el("p", "lb-caption", p.caption));
      const line = [context, formatDate(p.created_at), photos.length > 1 ? `${i + 1} / ${photos.length}` : null].filter(Boolean).join(" · ");
      meta.append(el("p", "lb-sub", line));
    };
    const go = (d) => { i = (i + d + photos.length) % photos.length; show(); };
    const shut = () => { box.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); };
    const onKey = (e) => {
      if (e.key === "Escape") shut();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    prev.onclick = (e) => { e.stopPropagation(); go(-1); };
    next.onclick = (e) => { e.stopPropagation(); go(1); };
    close.onclick = shut;
    box.onclick = (e) => { if (e.target === box || e.target === stage) shut(); };
    let x0 = null;
    box.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    box.addEventListener("touchend", (e) => {
      if (x0 == null || photos.length < 2) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) go(dx > 0 ? -1 : 1);
      x0 = null;
    });
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    document.body.append(box);
    show();
    close.focus();
  }

  // การ์ดเรื่องเล่า 1 ชุดรูป ใช้ทั้งหน้าแรกและหน้าเรื่องเล่า
  function storyCard(s, { large = false } = {}) {
    const card = el("article", `story-card${large ? " large" : ""}`);
    const media = el("button", `story-media n${Math.min(s.photos.length, 4)}`);
    media.setAttribute("aria-label", "ดูรูปเต็มจอ");
    s.photos.slice(0, 4).forEach((p, idx) => {
      const im = img(p.image_url, p.caption || "รูปจากชาวบ้าน");
      im.onclick = (e) => { e.stopPropagation(); openLightbox(s.photos, idx, s.plot ? plotTitle(s.plot) : ""); };
      media.append(im);
    });
    if (s.photos.length > 4) media.append(el("span", "more-photos", `+${s.photos.length - 4}`));
    media.onclick = () => openLightbox(s.photos, 0, s.plot ? plotTitle(s.plot) : "");
    if (s.plot) {
      const tag = el("span", "use-tag", `${landUseIcon(s.plot.landUse)} ${s.plot.landUse}`);
      tag.style.setProperty("--c", landUseColor(s.plot.landUse));
      media.append(tag);
    }

    const body = el("div", "story-body");
    body.append(el("time", "story-date", `${formatDay(s.started)} · ${timeAgo(s.latest)}`));
    body.append(el("p", s.caption ? "story-caption" : "story-caption muted", s.caption || `${s.photos.length} รูปจากแปลงนี้`));
    if (s.plot) {
      const who = el("a", "story-who");
      who.href = link(`map.html#plot=${encodeURIComponent(s.plot.code)}`);
      if (s.plot.villagers.length) who.append(facesEl(s.plot.villagers, 2));
      const t = el("span", "who-text");
      t.append(el("strong", null, peopleLabel(s.plot) || plotTitle(s.plot)), el("span", null, `${plotTitle(s.plot)} · ดูบนแผนที่ →`));
      who.append(t);
      body.append(who);
    }
    card.append(media, body);
    return card;
  }

  function showError(msg) {
    const e = el("div", "toast-error", msg);
    document.body.append(e);
  }

  window.RN = {
    cfg, LAND_USE, landUseColor, landUseIcon, loadAll, el, img, avatarEl, facesEl, displayName,
    formatDate, formatDay, timeAgo, formatNum, plotTitle, peopleLabel, bboxOf, centerOf, mapStyle,
    renderNav, link, openLightbox, storyCard, showError,
  };
})();
