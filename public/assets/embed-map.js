// หน้า /embed-map (embed-map.html): แผนที่ 3 มิติหมุนรอบหมู่บ้านเต็มจอ + รูปจากชาวบ้านสุ่มขึ้นทีละรูป
//   หน้าตาและจังหวะเดียวกับฉากเปิดหน้าแรก (home.js: heroMap / heroPins) แต่ไม่มีเมนู ชื่อหมู่บ้าน หรือการเลื่อนหน้า
//   ดึงข้อมูลใหม่ทุก REFRESH_MS: รูปที่เพิ่งส่งมาขึ้นเองโดยไม่ต้องรีเฟรชหน้า และได้ขึ้นจอก่อนรูปเก่า
RN.ready.then(() => {
  const { t, el, cfg, loadAll, landUseColor, plotTitle, peopleLabel } = RN;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // กล้อง ความเร็วหมุน ความสูงภูเขา เท่าฉากเปิดหน้าแรก
  const VIEW = { zoom: 13.6, pitch: 60, bearing: -20 };
  const SPIN = 0.003;      // องศาต่อมิลลิวินาที
  const TERRAIN = 1.6;     // ความสูงภูเขา (เท่าของจริง)
  const MAP_FPS = 30;      // วาดแผนที่ใหม่ไม่เกินกี่ครั้งต่อวินาที (หมุนช้ามาก ตาแยกไม่ออกจาก 60 แต่เครื่องทำงานครึ่งเดียว)
  // รูปบนแผนที่: ขึ้นรูปใหม่ทุก PIN_EVERY ms อยู่รูปละ PIN_LIFE ms มีรูปบนจออย่างน้อยหนึ่งรูปตลอด (จอว่างลองใหม่ทุก PIN_RETRY ms)
  //   สุ่มจากรูปล่าสุดไม่เกิน PIN_POOL รูป โหลดรอไว้ PIN_PRELOAD รูป รูปที่เพิ่งขึ้นไม่ซ้ำภายใน PIN_RECENT ครั้ง
  const PIN_EVERY = 1000, PIN_LIFE = 3000, PIN_RETRY = 200, PIN_POOL = 80, PIN_PRELOAD = 3, PIN_RECENT = 8;
  const PIN_TOP = 12, PIN_BOTTOM = 30;   // เว้นขอบบน / ขอบล่าง (บรรทัดเครดิต) ไม่ให้การ์ดทับ (px)
  const REFRESH_MS = 2 * 60 * 1000;      // ดึงรูปใหม่จากฐานข้อมูลทุกกี่ ms

  const num = (v) => (v == null || v === "" ? NaN : +v);
  const okLL = (a) => a && Number.isFinite(a[0]) && Number.isFinite(a[1]);
  const hit = (a, b, m) => a.l < b.r + m && a.r > b.l - m && a.t < b.b + m && a.b > b.t - m;
  const decoded = (im) => (im.decode ? im.decode() : Promise.resolve()).catch(() => {});
  // รูปย่อ (ถ้าเว็บมีระบบรูปย่อแล้ว) ไม่มีก็ใช้รูปเต็ม
  const thumb = RN.thumbUrl || ((u) => u);
  const landUseOf = (p) => (p.land_use && RN.LAND_USE[p.land_use] ? p.land_use : p.land_use ? "อื่น ๆ" : "ไม่ระบุ");
  const plotsGeo = (plots) => ({
    type: "FeatureCollection",
    features: plots.map((p) => ({ type: "Feature", geometry: p.geojson, properties: { id: p.id, color: landUseColor(p.landUse) } })),
  });

  // ข้อมูลล่าสุด (แปลง + รูป) ตรงจากฐานข้อมูล ไม่ผ่านแคชของ loadAll ที่โหลดครั้งเดียวตอนเปิดหน้า
  async function fetchLatest() {
    const get = async (view, query) => {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${view}?${query}`, { headers: { apikey: cfg.supabaseKey }, cache: "no-store" });
      if (!res.ok) throw new Error(`${view}: HTTP ${res.status}`);
      return res.json();
    };
    const [plots, reports] = await Promise.all([
      get("public_plots", "select=id,code,name,land_use,area_rai,geojson,pin_lng,pin_lat,villagers"),
      get("public_reports", `select=id,image_url,caption,latitude,longitude,created_at,plot_id,own_location&order=created_at.desc&limit=${PIN_POOL * 2}`),
    ]);
    for (const p of plots) p.landUse = landUseOf(p);
    return { plots, reports };
  }

  // ---------- รูปจากชาวบ้านบนแผนที่ (เหมือน heroPins ใน home.js ตัดส่วนที่หลบชื่อหมู่บ้าน/แถบเมนูออก) ----------
  function photoPins(map, layer) {
    const box = el("div", "hero-pins");
    box.setAttribute("aria-hidden", "true");
    layer.append(box);   // อยู่ในชั้นแผนที่: พิกัดจาก map.project ตรงกันพอดี

    // รูปที่โหลดเสร็จรอขึ้น (ready), กำลังโหลด (pending), อยู่บนจอ (live), เพิ่งขึ้น (recent)
    //   priority: รูปที่เพิ่งส่งเข้ามาหลังเปิดหน้า ขึ้นจอก่อนรูปอื่น / broken: รูปเสีย ไม่สุ่มอีก
    let pool = [], priority = [], started = false, dims = null;
    const ready = [], live = [], recent = [], pending = new Set(), broken = new Set(), seen = new Set();

    // ข้อมูลชุดใหม่ (ตอนเปิดหน้า + ทุกครั้งที่ดึงใหม่): สร้างรายการรูปที่สุ่มได้
    const setData = ({ plots, reports }) => {
      const plotById = new Map(plots.map((p) => [p.id, p]));
      const next = [];
      for (const r of reports) {
        if (!r.image_url || broken.has(r.id)) continue;
        const plot = plotById.get(r.plot_id);
        const own = [num(r.longitude), num(r.latitude)];
        // ตำแหน่งเดียวกับหน้าแผนที่: รูปที่ปักเอง/ไม่มีแปลง = พิกัดของรูป, นอกนั้น = หมุดของแปลง
        let ll = !plot || r.own_location ? own : [num(plot.pin_lng), num(plot.pin_lat)];
        if (!okLL(ll) && plot) ll = okLL(own) ? own : RN.centerOf(plot.geojson);
        if (!okLL(ll)) continue;
        next.push({
          id: r.id, src: thumb(r.image_url), full: r.image_url, ll,
          name: plot ? peopleLabel(plot) || plotTitle(plot) : r.caption || "",
          sub: plot ? plot.landUse : "",
          color: plot ? landUseColor(plot.landUse) : "#ffe900",
        });
        if (next.length >= PIN_POOL) break;
      }
      if (seen.size) for (const it of next) if (!seen.has(it.id)) priority.push(it.id);
      next.forEach((it) => seen.add(it.id));
      pool = next;
      const ids = new Set(pool.map((it) => it.id));
      priority = priority.filter((id) => ids.has(id));
      // รูปที่ถูกซ่อน/ลบจากหน้า admin: ไม่ขึ้นแล้ว (ที่อยู่บนจอจางไปตามเวลา)
      for (let i = ready.length - 1; i >= 0; i--) if (!ids.has(ready[i].it.id)) ready.splice(i, 1);
      if (priority.length) ready.sort((a, b) => priority.includes(b.it.id) - priority.includes(a.it.id));
      kick();
    };

    // สุ่มรูปถัดไป: รูปใหม่ก่อน แล้วรูปที่จุดของมันอยู่ตรงที่วางการ์ดได้ตอนนี้ (ok) ไม่มีค่อยเอารูปไหนก็ได้ / รูปน้อย: ยอมซ้ำ
    const pick = (ok) => {
      const busy = new Set([...pending, ...ready.map((x) => x.it.id), ...live.map((p) => p.it.id)]);
      const free = pool.filter((it) => !busy.has(it.id));
      const fresh = free.filter((it) => !recent.includes(it.id));
      const first = free.filter((it) => priority.includes(it.id));
      for (const c of ok ? [first.filter(ok), fresh.filter(ok), free.filter(ok), fresh, free] : [first, fresh, free])
        if (c.length) return c[(Math.random() * c.length) | 0];
    };
    const topUp = (ok) => {
      for (let it; ready.length + pending.size < Math.min(PIN_PRELOAD, pool.length) && (it = pick(ok)); ) {
        pending.add(it.id);
        const im = new Image();
        im.decoding = "async";
        im.alt = "";
        im.src = it.src;
        // ยังไม่มีรูปย่อ: ลองรูปเต็มอีกครั้งก่อนถือว่ารูปเสีย
        decoded(im).then(() => (im.naturalWidth || it.full === it.src ? null : ((im.src = it.full), decoded(im)))).then(() => {
          pending.delete(it.id);
          if (im.naturalWidth) ready.push({ it, im });
          else {
            broken.add(it.id);
            pool = pool.filter((x) => x !== it);
          }
          kick();
        });
      }
    };

    const NS = "http://www.w3.org/2000/svg";
    const build = ({ it, im }) => {
      const node = el("div", "hp");
      node.style.setProperty("--c", it.color);
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "hp-line");
      const line = document.createElementNS(NS, "line");
      line.setAttribute("pathLength", "1");   // ให้ CSS วาดเส้นจากจุดไปหาการ์ดด้วย stroke-dashoffset 1 -> 0
      svg.append(line);
      const card = el("figure", "hp-card");
      card.append(im);
      if (it.name || it.sub) {
        const cap = el("figcaption");
        if (it.name) cap.append(el("strong", null, it.name));
        if (it.sub) cap.append(el("span", null, it.sub));
        card.append(cap);
      }
      node.append(svg, el("span", "hp-dot"), card);
      return { node, line, card };
    };

    const show = (r, { node, line, card }, s, at) => {
      line.setAttribute("x2", s.dx.toFixed(1));
      line.setAttribute("y2", s.dy.toFixed(1));
      card.style.left = `${s.left}px`;
      card.style.top = `${s.top}px`;
      node.classList.toggle("below", !s.above);
      node.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
      const p = { it: r.it, node, x: at.x, y: at.y, left: s.left, top: s.top, w: s.w, h: s.h, leaving: false };
      live.push(p);
      recent.push(r.it.id);
      if (recent.length > PIN_RECENT) recent.shift();
      priority = priority.filter((id) => id !== r.it.id);
      void node.offsetWidth;   // เริ่ม transition จากสถานะซ่อน
      node.classList.add("on");
      // รูปที่หมดเวลาแล้วแต่ค้างไว้ (เพราะเป็นรูปสุดท้ายบนจอ) ไปได้แล้ว มีรูปใหม่ขึ้นแทน
      for (const q of live) if (q !== p && q.expired) retire(q);
      p.timer = setTimeout(() => expire(p), PIN_LIFE);
    };
    // รูปที่ยังอยู่บนจอและยังไม่หมดเวลา
    const fresh = () => live.some((p) => !p.leaving && !p.expired);
    // หมดเวลา: จางไป ยกเว้นเป็นรูปสุดท้ายบนจอ ให้อยู่ต่อจนรูปใหม่ขึ้นแทน จอจะได้ไม่ว่าง
    const expire = (p) => {
      p.expired = true;
      if (live.some((q) => q !== p && !q.leaving)) retire(p);
      else kick();
    };
    const retire = (p) => {
      if (p.leaving) return;
      p.leaving = true;
      clearTimeout(p.timer);
      p.node.classList.replace("on", "off");
      setTimeout(() => {
        p.node.remove();
        live.splice(live.indexOf(p), 1);
      }, 650);
      setTimeout(kick);   // หลุดจอก่อนเวลาแล้วจอว่าง: หารูปใหม่ทันที
    };

    // วางการ์ด: ปกติอยู่เหนือจุด เอียงเข้าหากลางจอ ถ้าไม่พอที่ค่อยลองฝั่งตรงข้าม / ใต้จุด
    //   ไม่ล้นขอบจอ ไม่ทับการ์ดที่ขึ้นอยู่แล้ว วางไม่ได้ก็ข้ามรอบนี้ไป
    const canShow = () => started && !document.hidden;
    const spawn = () => {
      if (!canShow()) return false;
      const W = layer.clientWidth, H = layer.clientHeight;
      if (!W || !H) return false;
      dims = { W, H };
      const dotOk = (at) => at.x >= 20 && at.x <= W - 20 && at.y >= PIN_TOP + 20 && at.y <= H - PIN_BOTTOM;
      const okIds = new Set(pool.filter((it) => dotOk(map.project(it.ll))).map((it) => it.id));
      const ok = (it) => okIds.has(it.id);
      // รูปที่รออยู่แต่จุดของมันหมุนไปอยู่ตรงที่ใช้ไม่ได้แล้ว: ทิ้ง ให้รูปที่วางได้มารอแทน (อยู่ในแคชแล้ว โหลดซ้ำเร็ว)
      if (okIds.size) for (let i = ready.length - 1; i >= 0; i--) if (!ok(ready[i].it)) ready.splice(i, 1);
      topUp(ok);
      const others = live.map((p) => ({ l: p.x + p.left, t: p.y + p.top, r: p.x + p.left + p.w, b: p.y + p.top + p.h }));
      // รูปใหม่ลองก่อน ที่เหลือสุ่มลำดับ
      const order = ready.map((_, i) => i).sort(() => Math.random() - 0.5)
        .sort((a, b) => priority.includes(ready[b].it.id) - priority.includes(ready[a].it.id));
      for (const i of order) {
        const r = ready[i];
        if (!ok(r.it)) continue;
        const at = map.project(r.it.ll);
        const parts = build(r);
        box.append(parts.node);
        const w = parts.card.offsetWidth, h = parts.card.offsetHeight;
        const toward = at.x < W / 2 ? 1 : -1;
        const k = Math.min(1, Math.max(0.4, H / 720));   // กรอบเตี้ย: เส้นสั้นลงตามส่วน
        // ลองเหนือจุดก่อน (เส้นสั้นแล้วเส้นยาว) ฝั่งที่เอียงเข้ากลางจอก่อนฝั่งตรงข้าม แล้วใต้จุด
        //   สุดท้ายข้างจุด (การ์ดอยู่ระดับเดียวกับจุด): กรอบเตี้ย ๆ ที่วางเหนือ/ใต้ไม่พอ
        const tries = [];
        for (const above of [true, false]) for (const far of [false, true]) for (const side of [toward, -toward]) tries.push({ above, far, side });
        for (const side of [toward, -toward]) tries.push({ beside: true, side });
        let spot = null;
        for (const { above, far, side, beside } of tries) {
          let left, top, dx, dy;
          if (beside) {
            const reach = (36 + Math.random() * 40) * k;
            left = side > 0 ? at.x + reach : at.x - reach - w;
            top = Math.min(Math.max(at.y - h / 2, PIN_TOP), H - PIN_BOTTOM - h);
            dx = side > 0 ? left - at.x : left + w - at.x;
            dy = Math.min(Math.max(at.y, top + 14), top + h - 14) - at.y;
            if (left < 12 || left + w > W - 12) continue;
          } else {
            const reach = k * (above ? (far ? 130 + Math.random() * 80 : 56 + Math.random() * 64) : far ? 100 + Math.random() * 60 : 48 + Math.random() * 44);
            dy = above ? -reach : reach;
            left = Math.min(Math.max(at.x + side * ((far ? 60 : 16) + Math.random() * 64) * k - w / 2, 12), W - 12 - w);
            top = above ? at.y + dy - h : at.y + dy;
            dx = left + w / 2 - at.x;
          }
          const rect = { l: left, t: top, r: left + w, b: top + h };
          if (rect.t < PIN_TOP || rect.b > H - PIN_BOTTOM || others.some((o) => hit(rect, o, 12))) continue;
          spot = { above: above || beside, dy, dx, left: left - at.x, top: top - at.y, w, h };
          break;
        }
        if (!spot) {
          parts.node.remove();
          continue;
        }
        ready.splice(i, 1);
        show(r, parts, spot, at);
        topUp(ok);
        return true;
      }
      return false;
    };
    // ไม่มีรูปใหม่บนจอ: ลองขึ้นรูปถี่ ๆ ทุก PIN_RETRY ms จนได้
    let kickT = 0;
    function kick() {
      clearTimeout(kickT);
      if (fresh() || !canShow()) return;
      if (!spawn()) kickT = setTimeout(kick, PIN_RETRY);
    }

    // ขยับตามแผนที่ทุกครั้งที่แผนที่วาดใหม่ (หมุน) หลุดจอแล้วจางออกก่อนเวลา แล้วหารูปใหม่
    map.on("render", () => {
      for (const p of live) {
        const at = map.project(p.it.ll);
        p.x = at.x;
        p.y = at.y;
        p.node.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
        if (p.leaving || !dims) continue;
        const rect = { l: at.x + p.left, t: at.y + p.top, r: at.x + p.left + p.w, b: at.y + p.top + p.h };
        if (rect.r < 0 || rect.l > dims.W || rect.b < 0 || rect.t > dims.H) retire(p);
      }
    });
    document.addEventListener("visibilitychange", () => document.hidden || kick());

    return {
      setData,
      // เริ่มขึ้นรูปหลังแผนที่ปรากฏ แล้วขึ้นรูปใหม่ทุก PIN_EVERY ms และคอยดูไม่ให้จอว่าง
      start() {
        if (started) return;
        started = true;
        kick();
        setInterval(() => {
          spawn();
          kick();
        }, PIN_EVERY);
      },
    };
  }

  // ---------- แผนที่ ----------
  function embedMap(data) {
    const layer = document.getElementById("embed-map");
    const center = RN.centerOf(data.area.geojson);
    const map = new maplibregl.Map({
      container: layer,
      style: RN.mapStyle({ terrain: true }),
      center,
      ...VIEW,
      maxPitch: 75,
      interactive: false,
      attributionControl: false,   // เครดิตอยู่ที่ #embed-credit
      fadeDuration: 0,
      // ความละเอียดที่วาด: จอคอมไม่เกิน 2 เท่า มือถือ 1.25 เท่า (เท่าหน้าแรก)
      pixelRatio: Math.min(devicePixelRatio || 1, matchMedia("(pointer: coarse) and (max-width: 820px)").matches ? 1.25 : 2),
    });
    RN.keepPainted(map);   // กลับมาจากแอป/แท็บอื่น: กันภาพหายบน iPhone
    map.once("style.load", () => {
      map.setTerrain({ source: "dem", exaggeration: TERRAIN });
      map.addSource("area", { type: "geojson", data: data.area.geojson });
      map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffe900", "line-width": 2, "line-dasharray": [3, 2] } });
      map.addSource("plots", { type: "geojson", data: plotsGeo(data.plots) });
      map.addLayer({ id: "plots-fill", type: "fill", source: "plots", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 } });
      map.addLayer({ id: "plots-line", type: "line", source: "plots", paint: { "line-color": ["get", "color"], "line-width": 1.6 } });
    });

    const pins = photoPins(map, layer);
    pins.setData(data);
    // แผนที่ค่อย ๆ ปรากฏเมื่อภาพดาวเทียมชุดแรกโหลดเสร็จ (ช้าเกิน 4 วินาทีก็แสดงอยู่ดี) แล้วรูปเริ่มขึ้น
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      layer.classList.add("ready");
      setTimeout(pins.start, 600);
    };
    map.once("idle", show);
    setTimeout(show, 4000);

    // หมุนรอบหมู่บ้าน (ซ่อนแท็บอยู่ / ตั้งค่าลดการเคลื่อนไหว: หยุด)
    let spin = VIEW.bearing, last = performance.now(), drawnAt = -1e9;
    const frame = (now) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (!document.hidden && !reduceMotion) {
        spin = ((spin + dt * SPIN + 180) % 360) - 180;
        if (now - drawnAt >= 1000 / MAP_FPS - 4) {
          drawnAt = now;
          map.setBearing(spin);
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // ดึงรูปใหม่เป็นระยะ (ข้อมูลตัวอย่าง ?sample ไม่ต้อง) ซ่อนแท็บอยู่ไม่ดึง กลับมาแล้วดึงทันทีถ้าถึงรอบแล้ว
    if (!cfg.useSampleData) {
      let fetchedAt = Date.now(), busy = false;
      const refresh = async () => {
        if (busy || document.hidden) return;
        busy = true;
        try {
          const latest = await fetchLatest();
          fetchedAt = Date.now();
          pins.setData(latest);
          map.getSource("plots")?.setData(plotsGeo(latest.plots));
        } catch (err) {
          console.warn("ดึงรูปใหม่ไม่สำเร็จ จะลองใหม่รอบหน้า", err);
        } finally {
          busy = false;
        }
      };
      setInterval(refresh, REFRESH_MS);
      document.addEventListener("visibilitychange", () => !document.hidden && Date.now() - fetchedAt > REFRESH_MS && refresh());
    }
  }

  loadAll()
    .then((data) => {
      // โหลด content/text.txt ไม่สำเร็จ (t คืนชื่อคีย์กลับมา): ใช้ข้อความสำรองใน HTML
      const text = (key, vars) => { const s = t(key, vars); return s === key ? "" : s; };
      const name = data.areaTitle.replace(/^ชุมชน/, "");
      const title = text("embed.page_title", { name });
      if (title) document.title = title;
      const credit = text("site.credits");
      if (credit) document.getElementById("embed-credit").textContent = credit.replace(/\s*(\n|\\n)\s*/g, " · ");
      embedMap(data);
    })
    .catch((err) => {
      console.error(err);
      RN.showError(err);
    });
});
