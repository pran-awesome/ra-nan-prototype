// หน้าแรก (landing): หน้าโหลด, แผนที่ 3 มิติหมุนรอบหมู่บ้าน + ชื่อหมู่บ้านพิมพ์ใหม่เปลี่ยนฟอนต์, ภาพดาวเทียมในกรอบ + ตัวเลข,
// บล็อกผืนดินบนพื้นหลังแผนที่, แถวการ์ดแปลงวิ่งเอง, ปิดท้าย
// รอโหลด content/text.txt ก่อน แล้วค่อยสร้างหน้า
RN.ready.then(() => {
  const { t, el, img, link, loadAll, formatNum, landUseColor, avatarEl, plotTitle, peopleLabel } = RN;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  RN.renderNav("home");
  // แถบเมนู: ซ่อนตอนเลื่อนลง โผล่กลับมาเมื่อเลื่อนขึ้น กลับถึงบนสุด หรือหยุดเลื่อนไปสักพัก (NAV_IDLE_MS)
  const navState = { skip: false };   // home.js ขยับตำแหน่งเลื่อนเอง (ไม่ใช่คนเลื่อน): ไม่ต้องโชว์/ซ่อนเมนู
  {
    const NAV_IDLE_MS = 1500;
    const nav = document.querySelector(".site-nav");
    let lastY = scrollY, idle = 0;
    addEventListener("scroll", () => {
      if (navState.skip) {
        navState.skip = false;
        lastY = scrollY;
        return;
      }
      clearTimeout(idle);
      idle = setTimeout(() => nav.classList.remove("nav-hidden"), NAV_IDLE_MS);
      const y = scrollY, d = y - lastY;
      if (Math.abs(d) < 6) return;   // ไม่สนการขยับนิดเดียว
      nav.classList.toggle("nav-hidden", d > 0 && y > 80);
      lastY = y;
    }, { passive: true });
  }
  document.querySelectorAll("[data-link]").forEach((a) => (a.href = link(a.dataset.link)));
  // ปุ่มติดต่อท้ายหน้า: อีเมลจาก content/text.txt (ไม่มี/สะกดผิดก็ใช้อีเมลเดิมใน index.html)
  const contactMail = t("home.cta_email");
  if (contactMail && contactMail.includes("@")) document.getElementById("cta-contact").href = `mailto:${contactMail.trim()}`;

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

  // ฉากเปิด: แผนที่ 3 มิติหมุนช้า ๆ รอบหมู่บ้าน
  const HERO = { zoom: 13.6, pitch: 60, bearing: -20 };   // ห่างพอเห็นหมู่บ้านทั้งหมดกับภูเขารอบ ๆ
  const SPIN = 0.003;                                      // ความเร็วหมุน (องศาต่อมิลลิวินาที)
  // แผนที่ฉากเปิดวาดใหม่ไม่เกินกี่ครั้งต่อวินาที: วาดแผนที่ 3 มิติคืองานหนักที่สุดของหน้า (มือถือหน่วงเพราะอันนี้)
  //   หมุนช้ามาก 30 ครั้งต่อวินาทีตาแยกไม่ออกจาก 60 แต่งานวาดลดครึ่งหนึ่ง ส่วนที่ผูกกับการเลื่อน (ย่อ/ขยับกรอบ) ยังขยับทุกเฟรม
  const MAP_FPS = 30;
  const TERRAIN = 1.6;                                     // ความสูงภูเขา (เท่าของจริง)
  // จอกว้าง: กรอบเลื่อนไปชิดซ้ายพร้อมย่อลงเล็กน้อย ข้อความอยู่คอลัมน์ขวา กึ่งกลางแนวตั้งเท่ากรอบ
  const SIDE_GAP = 56, SIDE_FRAME = 0.56;   // ช่องไฟ (px), กรอบกว้างสุดกี่ส่วนของความกว้างเนื้อหา
  // จอแคบ: กรอบอยู่บน ข้อความใต้กรอบ — เว้นบน (ให้แถบเมนู) / เว้นล่าง / ช่องระหว่างกรอบกับข้อความ (px)
  //   กรอบย่อได้เหลือน้อยสุดกี่ส่วน ถ้าต้องย่อเล็กกว่านี้ถึงจะพอดีจอ ไม่เล่นช่วงนี้
  const STACK_TOP = 76, STACK_BOTTOM = 16, STACK_GAP = 20, STACK_MIN = 0.5;

  // เลื่อนลง: ชั้นแผนที่ค่อย ๆ ย่อ + crop ลงไปทับกรอบภาพดาวเทียมของบล็อก "ยินดีต้อนรับ"
  // พร้อมกันนั้นกล้องแพนจากมุมเอียง 3 มิติ ลงไปเป็นมุมมองตรงลง ทิศเหนือขึ้น ภูเขาแบนลง
  // ให้เห็นพื้นที่เดียวกับภาพนิ่งในกรอบพอดี แล้วจางส่งต่อให้ภาพนิ่ง (ไม่เห็นรอยเปลี่ยนภาพ)
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp01 = (k) => Math.min(Math.max(k, 0), 1);
  const ease = (k) => k * k * (3 - 2 * k);

  // ความสูงจอแบบนิ่ง ไม่เปลี่ยนตอนแถบที่อยู่ของเบราว์เซอร์มือถือหด/ยืดระหว่างเลื่อน
  //   screenH (100svh ตอนแถบยืดเต็ม): วางกรอบกลางจอ / วางกรอบ + ข้อความบนจอแคบ / จุดที่เนื้อหาบล็อก "ดินแต่ละผืน" หยุดรอ
  //   screenL (100lvh ตอนแถบหด): ขนาดภาพพื้นหลังแผนที่ (#land-bg, .land-stage สูง 100lvh) ไม่โหลดภาพใหม่ทุกครั้งที่แถบขยับ
  const vhProbe = (unit) => {
    const n = document.body.appendChild(document.createElement("div"));
    n.setAttribute("aria-hidden", "true");
    n.style.cssText = `position:absolute;top:0;left:0;width:1px;height:100vh;height:100${unit};visibility:hidden;pointer-events:none`;
    return () => n.offsetHeight || innerHeight;
  };
  const screenH = vhProbe("svh"), screenL = vhProbe("lvh");

  // เขียนสไตล์เฉพาะตอนค่าเปลี่ยน: ลูปทุกเฟรมมักได้ค่าเดิมซ้ำ ไม่ต้องให้เบราว์เซอร์คำนวณสไตล์ใหม่ทุกเฟรม
  const written = new WeakMap();
  const put = (node, prop, value) => {
    let m = written.get(node);
    if (!m) written.set(node, (m = {}));
    if (m[prop] === value) return;
    m[prop] = value;
    if (prop.startsWith("--")) node.style.setProperty(prop, value);
    else node.style[prop] = value;
  };
  // เลื่อนหน้าไปตำแหน่งนี้ทันที (ไม่เลื่อนนุ่ม ๆ ตาม scroll-behavior: smooth ของหน้า)
  //   Safari รุ่นเก่ายังไม่รู้จัก behavior: "instant" (โยน error) จึงปิดการเลื่อนนุ่มชั่วคราวแทน
  const jump = (top) => {
    try {
      scrollTo({ top, behavior: "instant" });
    } catch {
      const st = document.documentElement.style;
      st.scrollBehavior = "auto";
      scrollTo(0, top);
      st.scrollBehavior = "";
    }
  };
  // รอให้ภาพโหลด + ถอดรหัสเสร็จ (โชว์ทีหลังจะไม่ต้องถอดรหัสกลางการเลื่อน) พังก็ถือว่าเสร็จ ไม่ค้าง
  const decoded = (im) => (im.decode ? im.decode() : Promise.resolve()).catch(() => {});

  // ---------- ฉากเปิด: ภาพจากชาวบ้านลอยบนแผนที่หมุน ----------
  // ทุก PIN_EVERY ms สุ่มรูปที่ชาวบ้านส่งมาขึ้นหนึ่งรูป: จุดบนแผนที่ (แปลงของคนส่ง หรือตำแหน่งที่ปักเอง) + เส้นลากไปหาการ์ดรูป
  //   ทั้งชุดขยับตามจุดนั้นขณะแผนที่หมุน อยู่รูปละ PIN_LIFE ms แล้วจางไป (จึงเห็นพร้อมกันราว PIN_LIFE / PIN_EVERY รูป)
  //   มีรูปบนจออย่างน้อยหนึ่งรูปตลอด: รูปสุดท้ายที่เหลือไม่จางจนกว่ารูปใหม่จะขึ้นแทน และถ้าจอว่างจะลองขึ้นใหม่ทุก PIN_RETRY ms
  //   สุ่มจากรูปล่าสุดไม่เกิน PIN_POOL รูป โหลดรอไว้ล่วงหน้า PIN_PRELOAD รูป รูปที่เพิ่งขึ้นไม่ซ้ำภายใน PIN_RECENT ครั้ง
  const PIN_EVERY = 1000, PIN_LIFE = 3000, PIN_RETRY = 200, PIN_POOL = 80, PIN_PRELOAD = 3, PIN_RECENT = 8;
  const PIN_TOP = 92, PIN_BOTTOM = 90;   // เว้นขอบบน (แถบเมนู) / ขอบล่าง (ปุ่มสำรวจ พิกัด) ไม่ให้การ์ดทับ (px)
  function heroPins(map, data, layer) {
    const box = el("div", "hero-pins");
    box.setAttribute("aria-hidden", "true");
    layer.append(box);   // อยู่ในชั้นแผนที่: พิกัดจาก map.project ตรงกันพอดี และอยู่ใต้ชื่อหมู่บ้าน
    const api = { box };

    const num = (v) => (v == null || v === "" ? NaN : +v);
    const okLL = (a) => a && Number.isFinite(a[0]) && Number.isFinite(a[1]);
    const plotById = new Map(data.plots.map((p) => [p.id, p]));
    let pool = [];
    for (const r of data.reports) {
      if (!r.image_url) continue;
      const plot = plotById.get(r.plot_id);
      const own = [num(r.longitude), num(r.latitude)];
      // ตำแหน่งเดียวกับหน้าแผนที่: รูปที่ปักเอง/ไม่มีแปลง = พิกัดของรูป, นอกนั้น = หมุดของแปลง
      let ll = !plot || r.own_location ? own : [num(plot.pin_lng), num(plot.pin_lat)];
      if (!okLL(ll) && plot) ll = okLL(own) ? own : RN.centerOf(plot.geojson);
      if (!okLL(ll)) continue;
      pool.push({
        id: r.id, src: r.image_url, ll,
        name: plot ? peopleLabel(plot) || plotTitle(plot) : r.caption || "",
        sub: plot ? plot.landUse : "",
        color: plot ? landUseColor(plot.landUse) : "#ffe900",
      });
      if (pool.length >= PIN_POOL) break;
    }
    if (!pool.length) return api;

    // รูปที่โหลด + ถอดรหัสเสร็จรอขึ้น (ready), กำลังโหลด (pending), อยู่บนจอ (live), เพิ่งขึ้น (recent)
    const ready = [], live = [], recent = [], pending = new Set();
    // สุ่มรูปถัดไป: เอารูปที่จุดของมันอยู่ตรงที่วางการ์ดได้ตอนนี้ก่อน (ok) ไม่มีค่อยเอารูปไหนก็ได้ / รูปน้อย: ยอมซ้ำ
    const pick = (ok) => {
      const busy = new Set([...pending, ...ready.map((x) => x.it.id), ...live.map((p) => p.it.id)]);
      const free = pool.filter((it) => !busy.has(it.id));
      const fresh = free.filter((it) => !recent.includes(it.id));
      for (const c of ok ? [fresh.filter(ok), free.filter(ok), fresh, free] : [fresh, free])
        if (c.length) return c[(Math.random() * c.length) | 0];
    };
    const topUp = (ok) => {
      for (let it; ready.length + pending.size < Math.min(PIN_PRELOAD, pool.length) && (it = pick(ok)); ) {
        pending.add(it.id);
        const im = new Image();
        im.decoding = "async";
        im.alt = "";
        im.src = it.src;
        decoded(im).then(() => {
          pending.delete(it.id);
          if (im.naturalWidth) ready.push({ it, im });
          else pool = pool.filter((x) => x !== it);   // รูปเสีย: ไม่สุ่มอีก
          kick();   // จอว่างอยู่: ขึ้นรูปที่เพิ่งโหลดเสร็จเลย
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

    const hit = (a, b, m) => a.l < b.r + m && a.r > b.l - m && a.t < b.b + m && a.b > b.t - m;
    const show = (r, { node, line, card }, s, at) => {
      line.setAttribute("x2", s.dx.toFixed(1));
      line.setAttribute("y2", s.dy.toFixed(1));
      card.style.left = `${s.left}px`;
      card.style.top = `${s.top}px`;
      node.classList.toggle("below", !s.above);
      node.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
      const p = { it: r.it, node, x: at.x, y: at.y, left: s.left, top: s.top, w: s.w, h: s.h, dx: s.dx, dy: s.dy, leaving: false };
      live.push(p);
      recent.push(r.it.id);
      if (recent.length > PIN_RECENT) recent.shift();
      void node.offsetWidth;   // เริ่ม transition จากสถานะซ่อน
      node.classList.add("on");
      // รูปที่หมดเวลาแล้วแต่ค้างไว้ (เพราะเป็นรูปสุดท้ายบนจอ) ไปได้แล้ว มีรูปใหม่ขึ้นแทน
      for (const q of live) if (q !== p && q.expired) retire(q);
      p.timer = setTimeout(() => expire(p), PIN_LIFE);
    };
    // รูปที่ยังอยู่บนจอและยังไม่หมดเวลา
    const fresh = () => live.some((p) => !p.leaving && !p.expired);
    // หมดเวลา: จางไป ยกเว้นเป็นรูปสุดท้ายบนจอ ให้อยู่ต่อจนรูปใหม่ขึ้นแทน (show) จอจะได้ไม่ว่าง
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
      setTimeout(kick);   // ไปก่อนเวลา (ขยับเข้าหาชื่อ/หลุดจอ) แล้วจอว่าง: หารูปใหม่ทันที
    };

    // พื้นที่ห้ามทับ: ชื่อหมู่บ้าน (+ บรรทัดอำเภอเหนือชื่อ) ในพิกัดของชั้นแผนที่
    //   ชื่อถูกลบ/พิมพ์ใหม่สลับฟอนต์ตลอด (บางจังหวะเหลือสั้นหรือว่าง) จึงกันไว้เท่าตอนกว้างที่สุดเสมอ:
    //   วัดชื่อเต็มคำด้วยทุกฟอนต์ที่สลับไปใช้ (canvas ไม่ต้องคำนวณเลย์เอาต์) เอาที่กว้างสุด + เคอร์เซอร์
    const content = document.getElementById("hero-content"), nameNode = document.getElementById("hero-name");
    const ctx = document.createElement("canvas").getContext("2d");
    let zone = null;   // + ตำแหน่งเลื่อนตอนวัด: ช่วงฉากเปิด แผนที่ตรึงจอแต่ชื่อเลื่อนขึ้นตามหน้า
    const measureZone = (lr) => {
      const hc = content.getBoundingClientRect(), nr = nameNode.getBoundingClientRect();
      const size = parseFloat(getComputedStyle(nameNode).fontSize) || 0;
      let wide = nr.width;
      for (const [fam, w, st] of TITLE_FONTS) {
        ctx.font = `${st} ${w} ${size}px ${fam}, sans-serif`;
        wide = Math.max(wide, ctx.measureText(typer.name || nameNode.textContent).width);
      }
      const right = Math.max(hc.right, nr.left + wide + size * 0.2);
      zone = {
        l: hc.left - lr.left, t: hc.top - lr.top, r: right - lr.left, b: hc.bottom - lr.top,
        fixed: document.documentElement.classList.contains("hero-fx"), y: scrollY,
      };
    };
    const zoneNow = () => {
      const up = zone.fixed ? scrollY - zone.y : 0;
      return { l: zone.l, r: zone.r, t: zone.t - up, b: zone.b - up };
    };
    // การ์ด จุด หรือเส้นโยง แตะพื้นที่ห้ามทับไหม (เส้น: เช็กเป็นจุด ๆ ตลอดแนว)
    const blocked = (rect, ax, ay, bx, by, z, m) => {
      if (hit(rect, z, m)) return true;
      for (let k = 0; k <= 8; k++) {
        const x = ax + ((bx - ax) * k) / 8, y = ay + ((by - ay) * k) / 8;
        if (hit({ l: x, r: x, t: y, b: y }, z, m)) return true;
      }
      return false;
    };

    // วางการ์ด: ปกติอยู่เหนือจุด เอียงเข้าหากลางจอ ถ้าไม่พอที่ค่อยลองฝั่งตรงข้าม / ใต้จุด
    //   ไม่ทับชื่อหมู่บ้าน แถบเมนู ปุ่มด้านล่าง และการ์ดที่ขึ้นอยู่แล้ว วางไม่ได้ก็ข้ามรอบนี้ไป
    //   เผื่อระยะจากชื่อไว้กว้าง (PIN_CLEAR) เพราะการ์ดยังขยับตามแผนที่หมุนต่ออีกพักหนึ่ง
    const PIN_CLEAR = 28;
    const canShow = () => boot.opened && !document.hidden && scrollY <= innerHeight * 0.3 && !layer.classList.contains("gone");
    let dims = null;   // ขนาดชั้นแผนที่ตอนขึ้นรูปล่าสุด (ใช้เช็กการ์ดหลุดจอใน render)
    const spawn = () => {
      if (!canShow()) return false;
      const W = layer.clientWidth, H = layer.clientHeight;
      if (!W || !H) return false;
      dims = { W, H };
      measureZone(layer.getBoundingClientRect());
      const title = zoneNow();
      // จุดบนแผนที่ที่ใช้ได้ตอนนี้: อยู่ในจอ ไม่ใต้แถบเมนู/ปุ่มด้านล่าง ไม่ใกล้ชื่อหมู่บ้าน
      const dotOk = (at) => at.x >= 20 && at.x <= W - 20 && at.y >= PIN_TOP && at.y <= H - PIN_BOTTOM && !hit({ l: at.x, r: at.x, t: at.y, b: at.y }, title, PIN_CLEAR);
      const okIds = new Set(pool.filter((it) => dotOk(map.project(it.ll))).map((it) => it.id));
      const ok = (it) => okIds.has(it.id);
      // รูปที่รออยู่แต่จุดของมันหมุนไปอยู่ตรงที่ใช้ไม่ได้แล้ว: ทิ้ง ให้รูปที่วางได้มารอแทน (อยู่ในแคชแล้ว โหลดซ้ำเร็ว)
      if (okIds.size) for (let i = ready.length - 1; i >= 0; i--) if (!ok(ready[i].it)) ready.splice(i, 1);
      topUp(ok);
      const others = live.map((p) => ({ l: p.x + p.left, t: p.y + p.top, r: p.x + p.left + p.w, b: p.y + p.top + p.h }));
      const order = ready.map((_, i) => i).sort(() => Math.random() - 0.5);
      for (const i of order) {
        const r = ready[i];
        if (!ok(r.it)) continue;
        const at = map.project(r.it.ll);
        const parts = build(r);
        box.append(parts.node);
        const w = parts.card.offsetWidth, h = parts.card.offsetHeight;
        const toward = at.x < W / 2 ? 1 : -1;
        let spot = null;
        // ลองเหนือจุดก่อน (เส้นสั้นแล้วเส้นยาว) ฝั่งที่เอียงเข้ากลางจอก่อนฝั่งตรงข้าม แล้วค่อยลองใต้จุด
        for (const above of [true, false]) for (const far of [false, true]) for (const side of [toward, -toward]) {
          if (spot) break;
          const reach = above ? (far ? 130 + Math.random() * 80 : 56 + Math.random() * 64) : far ? 100 + Math.random() * 60 : 48 + Math.random() * 44;
          const dy = above ? -reach : reach;
          const left = Math.min(Math.max(at.x + side * ((far ? 60 : 16) + Math.random() * 64) - w / 2, 12), W - 12 - w);
          const top = above ? at.y + dy - h : at.y + dy;
          const rect = { l: left, t: top, r: left + w, b: top + h };
          if (rect.t < PIN_TOP || rect.b > H - PIN_BOTTOM) continue;
          const dx = left + w / 2 - at.x;
          if (blocked(rect, at.x, at.y, at.x + dx, at.y + dy, title, PIN_CLEAR) || others.some((o) => hit(rect, o, 12))) continue;
          spot = { above, dy, dx, left: left - at.x, top: top - at.y, w, h };
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
    // ไม่มีรูปใหม่บนจอ: ลองขึ้นรูปถี่ ๆ ทุก PIN_RETRY ms จนได้ (หยุดเมื่อเลื่อนลงไปแล้ว รอบปกติทุกวินาทีจะเริ่มใหม่เอง)
    let kickT = 0;
    const kick = () => {
      clearTimeout(kickT);
      if (fresh() || !canShow()) return;
      if (!spawn()) kickT = setTimeout(kick, PIN_RETRY);
    };

    // ขยับตามแผนที่ทุกเฟรมที่แผนที่วาดใหม่ (หมุน/แพน) ใช้แค่ย้ายตำแหน่ง ไม่ต้องคำนวณเลย์เอาต์
    //   ขยับไปจนเกือบถึงชื่อหมู่บ้าน (หรือชื่อเลื่อนขึ้นมาหาตอนเลื่อนหน้า) หรือหลุดจอ: จางออกก่อนเวลาทันที แล้วหารูปใหม่
    map.on("render", () => {
      if (!live.length) return;
      const z = zone && zoneNow();
      for (const p of live) {
        const at = map.project(p.it.ll);
        p.x = at.x;
        p.y = at.y;
        p.node.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
        if (!z || p.leaving) continue;
        const rect = { l: at.x + p.left, t: at.y + p.top, r: at.x + p.left + p.w, b: at.y + p.top + p.h };
        const off = dims && (rect.r < 0 || rect.l > dims.W || rect.b < 0 || rect.t > dims.H);
        if (off || blocked(rect, at.x, at.y, at.x + p.dx, at.y + p.dy, z, 10)) retire(p);
      }
    });
    // เริ่มโหลดรูปหลังหน้าโหลดหาย (ไม่แย่งโหลดกับแผนที่) รูปแรกขึ้นทันทีที่โหลดเสร็จ (kick)
    //   จากนั้นขึ้นรูปใหม่ทุก PIN_EVERY ms และคอยดูไม่ให้จอว่าง
    heroReady.promise.then(() => {
      kick();
      setInterval(() => {
        spawn();
        kick();
      }, PIN_EVERY);
    });
    return api;
  }

  function heroMap(data) {
    const track = document.getElementById("hero-track");
    const layer = document.getElementById("hero-map");
    const center = RN.centerOf(data.area.geojson);
    const view = miniView(data);   // พื้นที่ที่ภาพนิ่งในกรอบแสดง (ปลายทางของกล้อง)
    const map = new maplibregl.Map({
      container: layer,
      style: RN.mapStyle({ terrain: true }),
      center,
      ...HERO,
      maxPitch: 75,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      // ความละเอียดที่วาด: จอคอม/แท็บเล็ตไม่เกิน 2 เท่า, มือถือ 1.25 เท่า (แผนที่ 3 มิติหมุนตลอด อยู่ใต้ม่านเงา
      //   ตาแทบแยกไม่ออก แต่จำนวนจุดที่ต้องวาดทุกเฟรมเหลือไม่ถึงครึ่งของจอ 2 เท่า เครื่องไม่ร้อน ลื่นขึ้นมาก)
      pixelRatio: Math.min(devicePixelRatio || 1, matchMedia("(pointer: coarse) and (max-width: 820px)").matches ? 1.25 : 2),
    });
    RN.keepPainted(map);   // ลดการเคลื่อนไหว (แผนที่นิ่ง) / กลับมาจากแอปอื่น: กันภาพหายบน iPhone
    const mapLoad = new Promise((r) => map.once("load", r));
    let shown = false, faded = false;
    const show = () => {
      if (shown) return;
      shown = true;
      track.classList.add("map-ready");
      boot.done("map");
      // หลังแผนที่ค่อย ๆ ปรากฏเสร็จ ปิด transition ของ CSS ให้ตอนส่งต่อจางตามการเลื่อนทันที
      setTimeout(() => { layer.style.transition = "none"; faded = true; }, 1300);
    };
    map.once("style.load", () => {
      map.setTerrain({ source: "dem", exaggeration: TERRAIN });
      addOverlays(map, data);
    });
    map.once("idle", show);
    // กันกรณีโหลดภาพช้า: แสดงอยู่ดีหลังผ่านไป 3 วินาที
    setTimeout(show, 3000);
    // ภาพจากชาวบ้านสุ่มขึ้นบนแผนที่ฉากเปิด มีเส้นโยงลงจุดบนแผนที่ ขยับตามแผนที่ที่หมุน
    const pins = heroPins(map, data, layer);

    // พื้นหลังบล็อก "ดินแต่ละผืน": ภาพดาวเทียมเต็มจอ ศูนย์กลางเดียวกับภาพในกรอบ
    // ขนาดพื้นที่คิดให้ตอนย่อภาพนี้ลงเท่ากรอบ (frameW x frameH บนจอ) ส่วนที่อยู่ในกรอบตรงกับภาพในกรอบพอดี
    //   จึงขยายจากกรอบออกเป็นเต็มจอได้ต่อเนื่อง
    const landBg = document.getElementById("land-bg"), landBox = document.getElementById("land");
    let imgKey = "", imgT = 0, imgWant = "";
    function landImage(frameW, frameH) {
      const W = document.documentElement.clientWidth || innerWidth, H = screenL();
      if (!frameW || !W) return;
      const key = [W, H, frameW, frameH].map(Math.round).join("|");
      if (key === imgKey) return;
      imgKey = key;
      const s = Math.max(frameW / W, frameH / H);
      const mpp = (view.ext[2] - view.ext[0]) / (frameW / s);
      const cx = (view.ext[0] + view.ext[2]) / 2, cy = (view.ext[1] + view.ext[3]) / 2;
      // ความละเอียดไม่เกิน 1.5 เท่าของจอ: เป็นพื้นหลังใต้ม่านเข้ม ไม่ต้องคมเท่าจอ retina แต่ไฟล์เล็กลงเกือบครึ่ง โหลด/ถอดรหัสเร็วขึ้น
      const k = Math.min(devicePixelRatio || 1, 1.5, 4096 / W, 4096 / H);
      const ext = [cx - (W * mpp) / 2, cy - (H * mpp) / 2, cx + (W * mpp) / 2, cy + (H * mpp) / 2];
      // โหลด + ถอดรหัสให้เสร็จก่อนค่อยใช้ (ตอนเปลี่ยนขนาดจอ ภาพเดิมยังอยู่จนภาพใหม่พร้อม ไม่กระพริบ)
      // ภาพเดียวใช้ทั้ง #land-bg และ .land-stage (site.css อ่านจาก --land-img)
      imgWant = key;
      tileImage(ext, Math.round(W * k), Math.round(H * k)).then(async (url) => {
        if (url) await decoded(Object.assign(new Image(), { src: url }));
        if (imgWant !== key) return;
        if (url) [landBg, landBox].forEach((n) => n?.style.setProperty("--land-img", `url("${url}")`));
        boot.done("land");   // ต่อภาพไม่สำเร็จก็ไม่ให้หน้าโหลดค้าง
      });
    }
    if (reduceMotion) {
      const m = document.getElementById("mini-map");
      landImage(m.offsetWidth, m.offsetHeight);
      boot.done("warm");
      return;
    }
    document.documentElement.classList.add("hero-fx");
    const mini = document.getElementById("mini-map");
    // ย่อเสร็จแล้วกั๊กบล็อก "ยินดีต้อนรับ" ไว้ด้วย position: sticky (เบราว์เซอร์ตรึงให้เองตอนเลื่อน จึงไม่สั่น)
    // ตั้ง top ให้บล็อกเริ่มติดพอดีตอนกรอบภาพดาวเทียมอยู่กลางจอ ระยะที่กั๊กอยู่ใน site.css (.welcome-hold::after)
    // จอกว้าง (.side): ระหว่างกั๊ก กรอบเลื่อนไปทางซ้าย แล้วข้อความยินดีต้อนรับพิมพ์ขึ้นข้าง ๆ แทนที่จะอยู่ใต้ภาพ
    // จอแคบ (.stack): กรอบย่อลงแล้วเลื่อนขึ้นไปด้านบนจอ ข้อความ + ตัวเลขพิมพ์ขึ้นใต้กรอบ ให้อยู่ครบในจอเดียว
    //   (จอเตี้ยเกินจนต้องย่อกรอบเหลือไม่ถึงครึ่ง เช่นมือถือแนวนอน: ไม่เล่นช่วงนี้ ข้อความอยู่ใต้กรอบตามปกติ)
    //   ช่วงกั๊ก: 15% แรกนิ่งกลางจอ -> 35% ถัดมากรอบเลื่อนซ้าย/ขึ้น -> ที่เหลือให้อ่านข้อความ
    const welcome = document.getElementById("welcome");
    const holdBox = welcome.parentElement;
    const inner = welcome.querySelector(".welcome-inner");
    const frameBox = welcome.querySelector(".welcome-frame");
    const label = inner.querySelector(":scope > .label");
    const words = inner.querySelector(".welcome-text");
    const sideMQ = matchMedia("(min-width: 1000px)");
    // ระยะเลื่อนตอนบล็อกติดอยู่กลางจอ: ช่วงแผนที่ย่อลงกรอบ (.hold-shrink) + ช่วงกั๊ก (.hold-stay) ความสูงอยู่ใน site.css
    // ทั้งสองแบบ (.to-land): หลังกั๊ก (.hold-expand) ข้อความจางหาย แล้วภาพในกรอบขยายออกเป็นเต็มจอ (#land-bg ลอยตรึงจอ)
    //   แล้วบล็อก "ดินแต่ละผืน" เลื่อนขึ้นมาบนพื้นหลังแผนที่นั้น
    const shrinkBox = holdBox.querySelector(".hold-shrink"), stayBox = holdBox.querySelector(".hold-stay");
    const expandBox = holdBox.querySelector(".hold-expand");
    const statsBox = document.getElementById("hero-stats");
    const ghost = welcome.querySelector(".ghost-word");
    const land = document.getElementById("land");
    let stickTop = null, shrinkPx = 0, stayPx = 0, expandPx = 0, side = false, lastQ = -1, lastX = -1, bgOn = false, colVars = "", wtype = null, svh = 0;
    let stack = false, stackK = 1, stackLift = 0, stackTextTop = 0, calm = false;
    // ขนาด/ตำแหน่งที่ไม่เปลี่ยนตอนเลื่อน วัดครั้งเดียวใน measure (ตอนโหลด/เปลี่ยนขนาดจอ) ลูปทุกเฟรมจะได้ไม่ต้องอ่านเลย์เอาต์ซ้ำ
    const g = {};
    // ตัวเลขสรุปย้ายเข้าไปอยู่ใต้ข้อความ (ขึ้น + นับหลังพิมพ์เสร็จ) หรือกลับมาอยู่ใต้ข้อความตามปกติ (นับตอนเลื่อนมาเห็น)
    const statsIn = (on) => {
      if (on === (statsBox.parentElement === words)) return;
      if (on) {
        words.append(statsBox);
        if (!wtype?.done) statsGate.hold = true;
      } else {
        words.after(statsBox);
        statsGate.hold = false;
      }
    };
    const statsIfSeen = () => {
      const r = statsBox.getBoundingClientRect();
      if (!statsGate.hold && r.top < innerHeight && r.bottom > 0) statsGate.start?.();
    };
    const measure = () => {
      side = sideMQ.matches;
      svh = screenH();
      holdBox.classList.toggle("side", side);
      // จอแคบ: ลองวางกรอบไว้บน ข้อความ + ตัวเลขไว้ใต้กรอบ ย่อกรอบให้ทั้งหมดพอดีจอ (เว้นบน STACK_TOP ให้แถบเมนู)
      stack = !side && !calm;
      holdBox.classList.toggle("stack", stack);
      // จอกว้าง: ตัวเลขสรุปย้ายไปอยู่ใต้ข้อความในคอลัมน์ขวา ให้เห็นครบทั้งบล็อกตอนกั๊ก (ขึ้นหลังพิมพ์เสร็จ)
      statsIn(side || stack);
      if (stack) {
        const fh = frameBox.offsetHeight, textH = words.offsetHeight;
        stackK = Math.min(1, (svh - STACK_TOP - STACK_BOTTOM - STACK_GAP - textH) / fh);
        if (stackK < STACK_MIN) {
          stack = false;
          holdBox.classList.remove("stack");
          statsIn(false);
        } else {
          // กรอบ + ข้อความทั้งก้อนอยู่กลางจอ (แต่ไม่สูงกว่า STACK_TOP) กรอบขยับขึ้นจากกลางจอ stackLift px
          const centerTop = Math.max((svh - fh) / 2, 80);
          const top = Math.max(STACK_TOP, (svh - (stackK * fh + STACK_GAP + textH)) / 2);
          stackLift = centerTop - top;
          stackTextTop = frameBox.offsetTop - stackLift + stackK * fh + STACK_GAP;
          // ข้อความลอยอยู่ (absolute) จึงจองความสูงไว้ให้บล็อก ไม่ให้ตัวเลขโดนตัดขอบล่าง
          inner.style.minHeight = `${stackTextTop + textH}px`;
        }
      }
      holdBox.classList.toggle("to-land", side || stack);
      shrinkPx = shrinkBox.offsetHeight;
      stayPx = stayBox.offsetHeight;
      expandPx = expandBox.offsetHeight;
      lastQ = lastX = -1;
      if (!side) {
        if (!stack) frameBox.style.transform = "";
        if (label) label.style.transform = "";
      }
      if (!stack) {
        inner.style.minHeight = "";
        welcome.style.removeProperty("--lift");
      }
      if (!side && !stack) statsIfSeen();
      Object.assign(g, {
        W: layer.clientWidth || innerWidth, H: layer.clientHeight || innerHeight,   // ชั้นแผนที่ฉากเปิด
        mw: mini.offsetWidth, mh: mini.offsetHeight,                               // กรอบภาพดาวเทียม (ไม่นับ transform)
        fw: frameBox.offsetWidth, fh: frameBox.offsetHeight, fTop: frameBox.offsetTop, fLeft: frameBox.offsetLeft,
        iw: inner.clientWidth, offTop: inner.offsetTop + frameBox.offsetTop, offLeft: inner.offsetLeft + frameBox.offsetLeft,
        lLeft: label ? label.offsetLeft : 0,
        bgW: landBg.clientWidth, bgH: landBg.clientHeight,
        heroEnd: scrollY + track.querySelector(".hero").getBoundingClientRect().bottom,
      });
      g.centerTop = Math.max((svh - g.mh) / 2, 80);
      // ภาพพื้นหลังตามขนาดจอ (ตอนลากเปลี่ยนขนาดหน้าต่าง รอให้หยุดก่อนค่อยโหลดภาพใหม่)
      const k = side ? Math.min(1, (inner.clientWidth * SIDE_FRAME) / frameBox.offsetWidth) : stack ? stackK : 1;
      const make = () => landImage(mini.offsetWidth * k, mini.offsetHeight * k);
      clearTimeout(imgT);
      if (imgKey) imgT = setTimeout(make, 300);
      else make();
    };
    measure();
    addEventListener("resize", measure);
    // ฟอนต์โหลดเสร็จทีหลัง ความสูงข้อความเปลี่ยน: วัดใหม่ให้กรอบ + ข้อความพอดีจอ
    document.fonts?.ready.then(measure);
    const hero = track.querySelector(".hero");
    const shade = hero.querySelector(".hero-shade");
    // ชื่อหมู่บ้านตัวใหญ่ไม่จาง เลื่อนขึ้นไปพร้อมหน้า ส่วนปุ่มสำรวจ/พิกัด/ภาพบนแผนที่จางออกเร็ว ๆ
    const fade = [".hero-explore", ".hero-coord"].map((q) => hero.querySelector(q)).concat(pins.box);
    let last = performance.now(), spin = HERO.bearing, prevY = scrollY, movedAt = 0, calmAt = null;
    // ถึงรอบวาดแผนที่หรือยัง (MAP_FPS) force: วาดเลย (กล้องเพิ่งถึงต้นทาง/ปลายทาง ต้องตรงเป๊ะ)
    let drawnAt = -1e9, camAt = -1;
    const mapDue = (now, force) => {
      if (!force && now - drawnAt < 1000 / MAP_FPS - 4) return false;
      drawnAt = now;
      return true;
    };
    // จอสัมผัส: รู้ว่านิ้วยังแตะจออยู่ไหม (ดูตอนเปลี่ยนเป็นหน้าธรรมดาใน frame)
    const touchy = matchMedia("(pointer: coarse)").matches;
    let touching = false;
    if (touchy) {
      const onTouch = (e) => (touching = e.touches.length > 0);
      ["touchstart", "touchend", "touchcancel"].forEach((ev) => addEventListener(ev, onTouch, { passive: true }));
    }

    // ดูฉากเปิดจบแล้ว (เลื่อนพ้นช่วงกั๊ก หรือเลื่อนย้อนขึ้นหลังแผนที่ย่อลงกรอบเสร็จ): เปลี่ยนเป็นหน้าเว็บธรรมดา
    // เลื่อนย้อนขึ้นไปก็ไม่เล่นย่อ/แพน/เลื่อนกรอบย้อนหลัง ฉากเปิดเป็นแผนที่ 3 มิติหมุนอยู่ในบล็อกของมันเอง
    // ระยะเว้นของฉากเปิดหายไป จึงชดเชยตำแหน่งเลื่อนให้สิ่งที่อยู่บนจออยู่ที่เดิม (ไม่เห็นกระโดด)
    function goCalm(anchor = welcome) {
      calm = true;
      const before = anchor.getBoundingClientRect().top;
      const wasStack = stack;
      if ((side && lastQ < 1) || (stack && lastQ > 0)) {
        // จอกว้าง: ยังเลื่อนกรอบไปซ้ายไม่สุด / จอแคบ: กรอบกลับลงมาเต็มขนาด ข้อความกลับไปอยู่ใต้กรอบ
        //   ค่อย ๆ เข้าที่เองแป๊บเดียว
        holdBox.classList.add("settle");
        setTimeout(() => holdBox.classList.remove("settle"), 800);
      }
      if (stack) {
        // จอแคบ: กลับเป็นเลย์เอาต์ปกติ กรอบเต็มขนาด ข้อความ + ตัวเลขเรียงอยู่ใต้กรอบ
        stack = false;
        holdBox.classList.remove("stack", "to-land");
        frameBox.style.transform = "";
        welcome.style.removeProperty("--lift");
        inner.style.minHeight = "";
        statsIn(false);
      }
      document.documentElement.classList.remove("hero-fx");
      mini.style.removeProperty("--handoff");
      welcome.style.top = "";
      welcome.style.removeProperty("--clear");
      frameBox.style.opacity = "";
      landBg.classList.remove("on");
      landBg.style.transform = landBg.style.clipPath = "";
      layer.classList.remove("gone");
      layer.style.transform = layer.style.clipPath = layer.style.opacity = "";
      fade.forEach((n) => n && (n.style.opacity = ""));
      if (shade) shade.style.opacity = "";
      navState.skip = true;
      jump(scrollY + anchor.getBoundingClientRect().top - before);
      setTimeout(() => (navState.skip = false), 120);   // เผื่อตำแหน่งไม่เปลี่ยนเลยจนไม่มี scroll event
      if (wasStack) statsIfSeen();
      if (map.terrain) map.terrain.exaggeration = TERRAIN;
      map.resize();
      map.jumpTo({ center, zoom: HERO.zoom, pitch: HERO.pitch, bearing: spin });
      lastQ = -1;
      if (side) slide(Infinity);
    }

    // ข้อความจาง (x 0-0.35) แล้วภาพขยายจากกรอบเป็นเต็มจอ (x 0.2-1) คณิตเดียวกับตอนย่อฉากเปิด แต่กลับทาง
    // r: ตำแหน่งกรอบบนจอ (อ่านไว้ตอนต้นเฟรม)
    function expand(x, r) {
      if (x === lastX) return;
      lastX = x;
      welcome.style.setProperty("--clear", clamp01(x / 0.35));
      const on = x > 0.2;
      if (on !== bgOn) {
        bgOn = on;
        landBg.classList.toggle("on", on);
        frameBox.style.opacity = on ? "0" : "";
      }
      if (!on) return;
      const e = ease(clamp01((x - 0.2) / 0.8));
      const W = g.bgW || innerWidth, H = g.bgH || innerHeight;
      const s = Math.max(r.width / W, r.height / H);
      const sc = lerp(s, 1, e);
      const cw = lerp(r.width / s, W, e), ch = lerp(r.height / s, H, e);
      const tx = lerp(r.left + r.width / 2 - (s * W) / 2, 0, e);
      const ty = lerp(r.top + r.height / 2 - (s * H) / 2, 0, e);
      landBg.style.transform = e < 1 ? `translate(${tx}px, ${ty}px) scale(${sc})` : "";
      landBg.style.clipPath = e < 1 ? `inset(${(H - ch) / 2}px ${(W - cw) / 2}px round ${lerp(18 / s, 0, e)}px)` : "";
      landBg.style.setProperty("--shade", e);
    }

    // จอกว้าง: กรอบเลื่อนไปซ้าย ข้อความอยู่คอลัมน์ขวา / จอแคบ (stack): กรอบเลื่อนขึ้น ข้อความอยู่ใต้กรอบ
    function slide(held) {
      const { fw, fh, iw, fTop } = g;
      const kEnd = stack ? stackK : Math.min(1, (iw * SIDE_FRAME) / fw);
      const colLeft = fw * kEnd + SIDE_GAP;
      const vars = stack ? `stack|${stackTextTop}` : `${colLeft}|${iw}|${fTop}|${fh}`;
      if (vars !== colVars) {
        colVars = vars;
        if (stack) words.style.setProperty("--side-top", `${stackTextTop}px`);
        else Object.entries({ "--side-left": colLeft, "--side-w": iw - colLeft, "--side-top": fTop, "--side-h": fh })
          .forEach(([k, v]) => words.style.setProperty(k, `${v}px`));
      }
      // ล้างข้อความรอไว้ก่อนคอลัมน์จะค่อย ๆ ปรากฏ พิมพ์เสร็จแล้วตัวเลขสรุปค่อยขึ้น + นับ
      wtype ||= welcomeTyper(words, () => {
        statsBox.classList.add("shown");
        statsGate.hold = false;
        statsGate.start?.();
      });
      const q = ease(clamp01((held - stayPx * 0.15) / (stayPx * 0.35)));
      if (q === lastQ) return;
      lastQ = q;
      const k = lerp(1, kEnd, q);
      if (stack) {
        // ย่อจากขอบบนกลางกรอบ (transform-origin ใน site.css) แล้วยกขึ้น หัวข้อจางหายไปพร้อมกัน
        frameBox.style.transform = q ? `translateY(${-stackLift * q}px) scale(${k})` : "";
        welcome.style.setProperty("--lift", q);
      } else {
        frameBox.style.transform = q ? `translateX(${-g.fLeft * q}px) scale(${k})` : "";
        if (label) label.style.transform = q ? `translate(${-g.lLeft * q}px, ${(fh * (1 - k)) / 2}px)` : "";
      }
      words.style.setProperty("--side-op", clamp01((q - 0.6) / 0.4));
      if (q >= 1) wtype.run();
    }

    // กล้องแผนที่ฉากเปิดที่ความคืบหน้าการแพน k (0 = มุม 3 มิติหมุนรอบหมู่บ้าน, 1 = ตรงลงตรงกับภาพนิ่งในกรอบ)
    //   ปลายทาง: ตอนย่อเสร็จ ส่วนกลางของแผนที่ขนาด (กรอบ / s) ต้องเห็นพื้นที่ view.ext พอดี
    const moveCam = (k) => {
      const { W, H, mw, mh } = g;
      const s = Math.max(mw / W, mh / H);
      const zEnd = mw > 0 ? Math.log2((2 * Math.PI * R * mw) / (512 * (view.ext[2] - view.ext[0]) * s)) : HERO.zoom;
      if (map.terrain) map.terrain.exaggeration = TERRAIN * (1 - k);   // ภูเขาแบนลงจนตรงกับภาพนิ่ง
      map.jumpTo({
        center: [lerp(center[0], view.center[0], k), lerp(center[1], view.center[1], k)],
        zoom: lerp(HERO.zoom, zEnd, k),
        pitch: HERO.pitch * (1 - k),
        bearing: spin * (1 - k),
      });
    };

    // ระหว่างหน้าโหลด: พากล้องไปตามทางที่จะแพนตอนเลื่อน (ปลายทาง แล้วกลางทาง) ให้ภาพดาวเทียม + ข้อมูลความสูงโหลดเก็บไว้ก่อน
    //   แล้วกลับมาจุดเริ่ม ตอนเลื่อนจริงจึงไม่ต้องรอโหลดกลางทาง (ไม่สะดุด ไม่เห็นภาพเบลอ) หน้าโหลดหายก่อนก็เลิกทันที
    let warming = true;
    const settle = (ms = 4000) => new Promise((r) => {
      const t = setTimeout(r, ms);
      map.once("idle", () => (clearTimeout(t), r()));
    });
    (async () => {
      await mapLoad;
      await settle();
      for (const k of [1, 0.5]) {
        if (boot.opened) break;
        moveCam(k);
        await settle();
      }
      warming = false;
      if (!boot.opened) {
        moveCam(0);
        await settle();
      }
      boot.done("warm");
    })();

    const frame = (now) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const vh = innerHeight, y = scrollY;
      if (calm) {
        if (side) slide(Infinity);
        // หมุนแผนที่ฉากเปิดเฉพาะตอนมองเห็น
        if (y < vh && !document.hidden) {
          spin += dt * SPIN;
          if (mapDue(now)) map.setBearing(spin);
        }
        return requestAnimationFrame(frame);
      }
      // อ่านตำแหน่งทั้งหมดก่อน แล้วค่อยเขียนสไตล์ทีหลัง (ไม่สลับอ่าน-เขียน เบราว์เซอร์จะได้ไม่ต้องคำนวณเลย์เอาต์ซ้ำกลางเฟรม)
      // ลำดับ: ข้อความฉากเปิดเลื่อนพ้นจอ -> แผนที่เปล่าเต็มจอ (ระหว่างนั้นบล็อกถัดไปเลื่อนขึ้นมาใต้แผนที่จนกรอบ
      //   ภาพดาวเทียมอยู่กลางจอแล้วติดอยู่ที่ S) -> แผนที่ย่อเข้าหากลางจอลงกรอบที่อยู่นิ่ง (S..E) -> กั๊ก/เลื่อนกรอบซ้าย -> ปล่อย
      const seq = side || stack;   // เล่นช่วงกรอบเลื่อน + ข้อความพิมพ์ + ขยายภาพเข้าบล็อก "ดินแต่ละผืน"
      const hbTop = holdBox.getBoundingClientRect().top, wr = welcome.getBoundingClientRect();
      const landTop = y + land.getBoundingClientRect().top;
      const mr = seq ? mini.getBoundingClientRect() : null;
      const { W, H, mw: fw, mh: fh, offTop, centerTop } = g;
      const S = y + hbTop + offTop - centerTop;   // ใช้ตำแหน่งตามเลย์เอาต์ปกติ (ไม่นับ sticky)
      const E = S + shrinkPx;
      const top = Math.round(centerTop - offTop);
      if (top !== stickTop) {
        stickTop = top;
        welcome.style.top = `${top}px`;
      }
      // ตำแหน่งจริงบนจอของกรอบ (ระหว่างย่อติดนิ่งอยู่กลางจอ)
      const f = { left: wr.left + g.offLeft, top: wr.top + offTop, width: fw, height: fh };
      if (seq) slide(y - E);
      const lin = clamp01((y - S) / Math.max(shrinkPx, 1));
      const p = ease(lin);
      // กล้องแพนเสร็จก่อนช่วงจางส่งต่อ (p 0.82 ขึ้นไป) ตอนจางจึงเป็นภาพเดียวกันแล้ว
      const cam = ease(clamp01(lin / 0.7));
      const past = y >= E - 1;
      const goingUp = y < prevY - 3;
      if (y !== prevY) movedAt = now;
      prevY = y;
      // กั๊กจบที่ X0 แล้วขยายภาพเป็นเต็มจอจนถึง X1 จากนั้นบล็อก "ดินแต่ละผืน" เลื่อนขึ้นมา
      const X0 = E + stayPx;
      if (seq) expand(clamp01((y - X0) / Math.max(expandPx, 1)), mr);
      // เปลี่ยนเป็นหน้าธรรมดา: เมื่อบล็อก "ดินแต่ละผืน" ขึ้นมาเต็มจอแล้ว (พื้นหลังเปลี่ยนเป็นของบล็อกเองที่หน้าตาเหมือนกัน)
      //   หรือเลื่อนย้อนขึ้นก่อนเริ่มขยายภาพ
      //   จอเตี้ยที่ไม่เล่นช่วงนี้: เมื่อพ้นช่วงกั๊กหรือเลื่อนย้อนขึ้น
      const toLand = seq && y >= landTop;
      // เลื่อนลงจนจบฉากแล้ว: จอสัมผัสรอให้นิ้วปล่อยและหน้าหยุดไหลก่อนค่อยเปลี่ยน (ระหว่างรอหน้าตาเหมือนกันอยู่แล้ว)
      //   ไม่งั้นการชดเชยตำแหน่งเลื่อนไปตัดแรงไหลต่อหลังปัดนิ้ว หน้าจะหยุดกึก
      if (past && (seq ? toLand : y >= X0)) calmAt ||= toLand ? land : welcome;
      const back = past && goingUp && (!seq || y < X0);
      const still = !touchy || (!touching && now - movedAt > 180);
      if (back || (calmAt && (goingUp || still))) {
        goCalm(calmAt || welcome);
        return requestAnimationFrame(frame);
      }

      const fadeOp = 1 - clamp01(y / (vh * 0.35));
      fade.forEach((n) => n && put(n, "opacity", fadeOp));
      if (shade) put(shade, "opacity", 1 - clamp01(y / (g.heroEnd * 0.7)));
      layer.classList.toggle("gone", past);
      const handoff = past ? 1 : clamp01((p - 0.82) / 0.18);
      put(mini, "--handoff", handoff);   // ตั้งที่กรอบเอง (ตั้งที่ <html> จะทำให้ทั้งหน้าคำนวณสไตล์ใหม่ทุกเฟรม)
      if (faded) put(layer, "opacity", 1 - handoff);

      if (!past) {
        // ย่อ s เท่าให้กรอบเต็ม แล้ว crop ส่วนที่เกินออก มุมโค้งเท่ากรอบ
        const s = Math.max(fw / W, fh / H);
        // หมุนรอบหมู่บ้านต่อ แต่ช้าลงเรื่อย ๆ ตามที่กล้องแพน แล้วหันกลับทิศเหนือทางที่ใกล้ที่สุด
        // (ระหว่างหน้าโหลดพากล้องไปโหลดตามทางอยู่ ไม่ต้องขยับกล้องตรงนี้)
        if (!warming || boot.opened) {
          if (!document.hidden) spin += dt * SPIN * (1 - cam);
          if (cam === 0) spin = ((spin + 540) % 360) - 180;
          if (mapDue(now, cam !== camAt && (cam === 0 || cam === 1))) {
            camAt = cam;
            moveCam(cam);
          }
        }
        const sc = lerp(1, s, p);
        const cw = lerp(W, fw / s, p), ch = lerp(H, fh / s, p);
        const tx = lerp(0, f.left + fw / 2 - (s * W) / 2, p);
        const ty = lerp(0, f.top + fh / 2 - (s * H) / 2, p);
        put(layer, "transform", p > 0 ? `translate(${tx}px, ${ty}px) scale(${sc})` : "");
        put(layer, "clipPath", p > 0 ? `inset(${(H - ch) / 2}px ${(W - cw) / 2}px round ${lerp(0, 18 / s, p)}px)` : "");
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ข้อความยินดีต้อนรับ: พิมพ์ทีละตัวข้างกรอบภาพดาวเทียม เว้นที่ส่วนที่ยังไม่พิมพ์ไว้ (มองไม่เห็น) ให้บรรทัดไม่กระโดด
  // โปรแกรมอ่านหน้าจออ่านข้อความเต็มจาก .sr-only
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const graphemes = (str) => (Intl.Segmenter ? [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(str)].map((x) => x.segment) : [...str]);
  function welcomeTyper(box, onDone) {
    const hide = (n) => (n.setAttribute("aria-hidden", "true"), n);
    const paras = [...box.querySelectorAll("p")].map((p) => {
      const full = p.textContent;
      const shown = hide(el("span")), rest = hide(el("span", "tw-rest", full));
      p.replaceChildren(el("span", "sr-only", full), shown, rest);
      return { parts: graphemes(full), shown, rest };
    });
    // เคอร์เซอร์ของแต่ละย่อหน้า กะพริบรออยู่ที่ต้นบรรทัด
    paras.forEach((x) => x.rest.before((x.caret = hide(el("span", "tw-caret")))));
    const TYPE_MS = 16, STAGGER_MS = 90;   // เวลาต่อตัวอักษร, ย่อหน้าถัดไปเริ่มช้ากว่ากันนิดเดียว
    let started = false;
    const api = {
      done: false,
      run() {
        if (started) return;
        started = true;
        box.classList.add("typing");
        // พิมพ์ทุกย่อหน้าไปพร้อมกัน
        Promise.all(paras.map(async ({ parts, shown, rest, caret }, i) => {
          await wait(i * STAGGER_MS);
          for (let n = 1; n <= parts.length; n++) {
            shown.textContent = parts.slice(0, n).join("");
            rest.textContent = parts.slice(n).join("");
            await wait(TYPE_MS);
          }
          if (i < paras.length - 1) caret.remove();
        })).then(async () => {
          box.classList.remove("typing");
          api.done = true;
          onDone?.();
          await wait(1800);
          paras.forEach((x) => x.caret.remove());
        });
      },
    };
    return api;
  }

  // ชื่อหมู่บ้านตัวใหญ่: ลบทีละตัว แล้วพิมพ์ใหม่ด้วยฟอนต์ถัดไป วนไปเรื่อย ๆ
  const TITLE_FONTS = [
    ['"Anuphan"', 500, "normal"],
    ['"Trirong"', 300, "italic"],
    ['"Kanit"', 600, "normal"],
    ['"Sriracha"', 400, "normal"],
    ['"Chakra Petch"', 500, "normal"],
    ['"Charm"', 700, "normal"],
    ['"Pridi"', 300, "normal"],
    ['"Srisakdi"', 700, "normal"],
    ['"Mitr"', 400, "normal"],
  ];
  const typer = { name: null };
  // ชื่อหมู่บ้านเต็มคำไว้ก่อนตอนแผนที่ค่อย ๆ ปรากฏ แล้วค่อยเริ่มลบ/พิมพ์ใหม่
  const heroReady = {};
  heroReady.promise = new Promise((r) => (heroReady.resolve = r));
  function typeTitle() {
    const h1 = document.getElementById("hero-title");
    const node = document.getElementById("hero-name");
    typer.name = node.textContent.trim();
    h1.setAttribute("aria-label", typer.name);
    node.setAttribute("aria-hidden", "true");
    if (reduceMotion) return;
    const seg = (str) => (Intl.Segmenter ? [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(str)].map((x) => x.segment) : [...str]);
    TITLE_FONTS.forEach(([fam, w, st]) => document.fonts?.load(`${st} ${w} 40px ${fam}`, typer.name).catch(() => {}));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let i = 0;
    (async () => {
      await heroReady.promise;
      await wait(2600);
      for (;;) {
        let parts = seg(node.textContent);
        h1.classList.add("typing");
        while (parts.length) {
          parts.pop();
          node.textContent = parts.join("");
          await wait(55);
        }
        h1.classList.remove("typing");
        await wait(380);
        i = (i + 1) % TITLE_FONTS.length;
        const [fam, w, st] = TITLE_FONTS[i];
        Object.assign(node.style, { fontFamily: `${fam}, var(--sans)`, fontWeight: w, fontStyle: st });
        h1.classList.add("typing");
        const target = seg(typer.name);
        for (let n = 1; n <= target.length; n++) {
          node.textContent = target.slice(0, n).join("");
          await wait(95 + Math.random() * 70);
        }
        h1.classList.remove("typing");
        h1.setAttribute("aria-label", typer.name);
        await wait(2200);
      }
    })();
  }

  // ภาพนิ่งจาก Esri export (ไม่ต้องใช้ WebGL) ใช้กับกรอบภาพดาวเทียม สไลด์แปลง และฉากท้ายหน้า
  const R = 6378137;
  const merc = ([lng, lat]) => [(lng * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
  // ภาพดาวเทียมนิ่ง (กรอบยินดีต้อนรับ, พื้นหลังผืนดิน, ปิดท้าย, การ์ดแปลง): ต่อ tile ของ Esri เองใน canvas
  //   แทนบริการ export ของ Esri ที่สร้างภาพใหม่ทุกครั้ง (ภาพ 1200x760 รอ 3-4 วินาที มือถือหน้าโหลดค้างนาน)
  //   tile เป็นไฟล์สำเร็จรูปบน CDN (ราว 0.05 วินาที/ไฟล์) และเป็นชุดเดียวกับที่แผนที่ 3 มิติโหลดอยู่แล้ว ภาพจึงตรงกันด้วย
  //   ext = [xmin, ymin, xmax, ymax] (เมตร, Web Mercator) ได้ URL ของภาพ (blob) กลับมา; ภาพเดียวกันขอซ้ำได้ ไม่ต่อใหม่
  const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";
  const WORLD = 2 * Math.PI * R;
  const tileJobs = new Map();
  const tileImage = (ext, w, h) => {
    const key = [...ext.map((n) => n.toFixed(1)), w, h].join(",");
    if (!tileJobs.has(key)) tileJobs.set(key, stitchTiles(ext, w, h).catch(() => ""));
    return tileJobs.get(key);
  };
  async function stitchTiles(ext, w, h) {
    // ซูมที่ tile ละเอียดพอสำหรับขนาดภาพ (ไม่เกินจำนวน tile ที่ต้องโหลดมากเกินไป)
    const mpp = (ext[2] - ext[0]) / w;
    let z = Math.max(0, Math.min(19, Math.ceil(Math.log2(WORLD / (256 * mpp)))));
    const range = (zz) => {
      const span = WORLD / 2 ** zz;
      const col = (x) => Math.floor((x + WORLD / 2) / span), row = (y) => Math.floor((WORLD / 2 - y) / span);
      return { span, x0: col(ext[0]), x1: col(ext[2] - 1e-6), y0: row(ext[3]), y1: row(ext[1] + 1e-6) };
    };
    let r = range(z);
    while (z > 0 && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 90) r = range(--z);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    const sx = w / (ext[2] - ext[0]), sy = h / (ext[3] - ext[1]);   // จุดต่อเมตร
    const jobs = [];
    for (let ty = r.y0; ty <= r.y1; ty++)
      for (let tx = r.x0; tx <= r.x1; tx++)
        jobs.push(new Promise((done) => {
          const im = new Image();
          im.crossOrigin = "anonymous";   // Esri ส่ง CORS มา จึงวาดลง canvas แล้วส่งออกเป็นภาพได้
          im.onload = () => {
            // ปัดขอบเป็นจุดเต็ม + เกินกันนิดหนึ่ง ไม่ให้เห็นรอยต่อระหว่าง tile
            const l = Math.floor((tx * r.span - WORLD / 2 - ext[0]) * sx), t0 = Math.floor((ext[3] - (WORLD / 2 - ty * r.span)) * sy);
            const rr = Math.ceil(((tx + 1) * r.span - WORLD / 2 - ext[0]) * sx), b = Math.ceil((ext[3] - (WORLD / 2 - (ty + 1) * r.span)) * sy);
            g.drawImage(im, l, t0, rr - l + 1, b - t0 + 1);
            done();
          };
          im.onerror = done;
          im.src = `${TILE_URL}${z}/${ty}/${tx}`;
        }));
    await Promise.all(jobs);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
    return blob ? URL.createObjectURL(blob) : "";
  }
  function staticView(geojson, w, h, pad = 1.25) {
    const [[a, b], [c, d]] = RN.bboxOf(geojson);
    const [x0, y0] = merc([a, b]);
    const [x1, y1] = merc([c, d]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let hw = Math.max(((x1 - x0) / 2) * pad, 60), hh = Math.max(((y1 - y0) / 2) * pad, 60);
    if (hw / hh > w / h) hh = (hw * h) / w; else hw = (hh * w) / h;
    const ext = [cx - hw, cy - hh, cx + hw, cy + hh];
    const image = () => tileImage(ext, w, h);   // สร้างภาพตอนเรียกครั้งแรก (Promise ของ URL)
    const project = (pt) => {
      const [x, y] = merc(pt);
      return [((x - ext[0]) / (ext[2] - ext[0])) * w, ((ext[3] - y) / (ext[3] - ext[1])) * h];
    };
    const unmerc = ([x, y]) => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
    return { image, project, ext, center: unmerc([cx, cy]) };
  }
  // ภาพดาวเทียมในกรอบของบล็อก "ยินดีต้อนรับ" (แผนที่ฉากเปิดแพนกล้องลงมาจบที่ภาพนี้)
  const miniView = (data) => staticView(data.area.geojson, 1200, 760, 1.15);

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
    const { image, project } = miniView(data);
    const box = document.getElementById("mini-map");
    // ภาพในกรอบต้องพร้อมก่อนแผนที่ฉากเปิดย่อลงมาส่งต่อ: สร้างทันที (ไม่รอเลื่อนใกล้) หน้าโหลดรอจนถอดรหัสเสร็จ
    const pic = el("img", "mini-sat");
    pic.alt = t("home.welcome_map_alt");
    box.append(pic);
    image().then(async (url) => {
      if (url) {
        pic.src = url;
        await decoded(pic);
      }
      boot.done("mini");
    });
    box.append(svgLayer(W, H, [
      [svgPath(data.area.geojson, project), "mm-area"],
      ...data.plots.map((p, i) => [svgPath(p.geojson, project), "mm-plot", landUseColor(p.landUse), i]),
    ]));

    // ภาพฉากท้ายหน้า: อยู่ล่างสุด โหลดตอนเลื่อนเข้าใกล้ (ไม่แย่งเน็ตกับภาพที่ต้องใช้ตอนเปิดหน้า)
    const cta = staticView(data.area.geojson, 1600, 800, 3.2);
    const ctaBox = document.getElementById("cta-map");
    new IntersectionObserver(([e], o) => {
      if (!e.isIntersecting) return;
      o.disconnect();
      cta.image().then((url) => url && (ctaBox.style.backgroundImage = `url("${url}")`));
    }, { rootMargin: "150% 0px" }).observe(ctaBox);
  }

  // ---------- ตัวเลข ----------
  const statsGate = { hold: false, start: null };
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

  // statsGate.hold: จอกว้างรอให้ข้อความยินดีต้อนรับพิมพ์เสร็จก่อนค่อยนับ (heroMap เรียก start เอง)
  function stats(data) {
    const values = { plots: data.plots.length, rai: data.totalRai, people: data.villagers.length, photos: data.reports.length };
    const nodes = document.querySelectorAll("[data-count]");
    let done = false;
    statsGate.start = () => {
      if (done) return;
      done = true;
      nodes.forEach((b) => countUp(b, values[b.dataset.count], b.dataset.count === "rai" ? 1 : 0));
    };
    new IntersectionObserver(([e], o) => {
      if (!e.isIntersecting || statsGate.hold) return;
      o.disconnect();
      statsGate.start();
    }, { threshold: 0.4 }).observe(document.getElementById("hero-stats"));
  }

  // ท้ายบล็อก "ดินแต่ละผืน": เนื้อหาเลื่อนขึ้นมาจนขอบล่างถึงขอบล่างจอแล้วหยุดนิ่ง (sticky)
  //   เนื้อหาจบด้วยกล่องคำใหญ่สูงเท่าจอ (site.css) จุดที่หยุดจึงเป็นตอนคำใหญ่อยู่กลางจอพอดี แล้วเริ่มขยายทันที
  //   ระหว่างเลื่อนผ่าน .land-tail (t 0-1 ผูกกับการเลื่อน เลื่อนย้อนขึ้นก็เล่นย้อนกลับ):
  //     - พื้นหลังแผนที่ค่อย ๆ กลายเป็นสีขาว ขาวเต็มที่ที่ t = WASH_END  ตัวหนังสือเปลี่ยนเป็นสีเข้มตอนพื้นขาวถึง LIT_AT
  //     - ข้อความอื่นจางหายภายใน t = OUT_END
  //     - คำใหญ่ "นา สวน ไร่ / บ่อปลา & ป่า" ขยายพร้อมเลื่อนเข้ากลางจอภายใน t = GROW_END
  //     - แล้วบรรทัดบนเลื่อนออกซ้าย บรรทัดล่างออกขวา ช่วง t = SPLIT_FROM - SPLIT_TO
  //     - คำออกพ้นจอแล้ว ที่ t = GALLERY_SHOW การ์ดแปลงในบล็อกถัดไปลอยเข้ามากลางจอ (ใบคี่ขึ้นจากล่าง ใบคู่ลงจากบน)
  //       เลื่อนย้อนขึ้นต่ำกว่า GALLERY_HIDE การ์ดลอยออกไปก่อนคำใหญ่กลับมา
  //   ความยาวทั้งช่วงคือความสูงของ .land-tail ใน site.css
  const WASH_END = 0.7, LIT_AT = 0.4, OUT_END = 0.18, GROW_END = 0.3, SPLIT_FROM = 0.35, SPLIT_TO = 0.85;
  const GALLERY_SHOW = 0.87, GALLERY_HIDE = 0.8;
  const WORDS_MAX = 2.2, WORDS_FILL = 0.92;   // ขยายได้สุดกี่เท่า, บรรทัดยาวสุดกว้างได้กี่ส่วนของจอ
  function landWash() {
    const land = document.getElementById("land");
    const body = land.querySelector(".land-body"), tail = land.querySelector(".land-tail");
    const words = land.querySelector(".land-words");
    if (!body || !tail) return;
    const lines = words ? [...words.children] : [];
    const gallery = document.getElementById("plots-gallery");
    let queued = false, lastT = -1, lit = false, shown = false, sh = screenH();
    // ขนาด/ตำแหน่งที่ใช้คิดตอนท้าย (ไม่นับ transform): ขยายกี่เท่า, เลื่อนลงเท่าไรให้อยู่กลางจอ, เลื่อนออกเท่าไรให้พ้นจอ
    let grow = 1, dy = 0, offs = [];
    const layout = () => {
      const H = body.offsetHeight;
      land.style.setProperty("--land-h", `${H}px`);
      land.classList.add("pin");
      if (!words || !lines.length) return;
      const vw = document.documentElement.clientWidth || innerWidth;
      const widths = lines.map((n) => n.offsetWidth);
      grow = Math.min(WORDS_MAX, Math.max(1.2, (vw * WORDS_FILL) / Math.max(...widths, 1)));
      // ระหว่างหยุดรอ ขอบบนของเนื้อหาอยู่ที่ sh - H บนจอ
      dy = sh / 2 - (sh - H + words.offsetTop + words.offsetHeight / 2);
      offs = widths.map((w) => (vw / 2 + (w * grow) / 2) / grow + 24);
      lastT = -1;
    };
    const update = () => {
      queued = false;
      // เนื้อหาเริ่มหยุดตอนขอบบนของ .land-tail (= ขอบล่างของเนื้อหา) ขึ้นมาถึงขอบล่างจอ (100svh)
      const r = tail.getBoundingClientRect();
      const t = clamp01((sh - r.top) / Math.max(r.height, 1));
      if (t === lastT) return;
      lastT = t;
      const wash = clamp01(t / WASH_END);
      land.style.setProperty("--wash", wash);
      land.style.setProperty("--out", clamp01(t / OUT_END));
      if (wash >= LIT_AT !== lit) land.classList.toggle("lit", (lit = wash >= LIT_AT));
      if (gallery && (shown ? t < GALLERY_HIDE : t >= GALLERY_SHOW)) {
        gallery.classList.toggle("show", (shown = !shown));
        gallery.dispatchEvent(new Event(shown ? "pg-show" : "pg-hide"));   // plotsGallery: เร่งแถววิ่งหลังลอยเข้าเสร็จ
      }
      if (!words) return;
      if (reduceMotion) {
        // ลดการเคลื่อนไหว: คำใหญ่ไม่ขยาย/ไม่แยก แค่จางหายช่วงเดียวกัน
        words.style.opacity = 1 - clamp01((t - SPLIT_FROM) / (SPLIT_TO - SPLIT_FROM));
        return;
      }
      const g = ease(clamp01(t / GROW_END));
      const s = ease(clamp01((t - SPLIT_FROM) / (SPLIT_TO - SPLIT_FROM)));
      land.style.setProperty("--grow", g);
      words.style.transform = g ? `translateY(${dy * g}px) scale(${lerp(1, grow, g)})` : "";
      lines.forEach((n, i) => (n.style.transform = s ? `translateX(${(i % 2 ? 1 : -1) * offs[i] * s}px)` : ""));
    };
    const ask = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    // ความสูงเนื้อหาเปลี่ยนได้ (ข้อมูลสัดส่วนที่ดินโหลดทีหลัง / เปลี่ยนขนาดจอ / ฟอนต์โหลดเสร็จ): คิดใหม่
    new ResizeObserver(() => {
      layout();
      ask();
    }).observe(body);
    document.fonts?.ready.then(() => {
      layout();
      ask();
    });
    addEventListener("scroll", ask, { passive: true });
    addEventListener("resize", () => {
      sh = screenH();
      layout();
      ask();
    });
    layout();
    update();
  }

  // ---------- แปลงในชุมชน: แถวการ์ดวิ่งเองช้า ๆ เห็นหลายแปลงพร้อมกัน ----------
  // การ์ดละแปลง: รูปโปรไฟล์ผู้ดูแล + รูปที่ส่งมาล่าสุด 3 รูป (ตาราง 2 x 2) ชื่อผู้ดูแลใต้ภาพ กดแล้วเปิดแปลงนั้นบนแผนที่
  //   รูปไม่ถึง 3: ช่องถัดไปเป็นภาพดาวเทียมของแปลง ที่เหลือเป็นช่องสีตามการใช้ที่ดิน
  // วนไม่รู้จบ: ชุดการ์ดซ้ำจนกว้างกว่าจอ แล้วต่อสองชุดเหมือนกัน CSS เลื่อนไปครึ่งหนึ่งแล้ววนกลับ (เบราว์เซอร์เลื่อนให้เอง ไม่ใช้ JS ทุกเฟรม)
  const GALLERY_MAX = 14, GALLERY_SPEED = 36, GALLERY_IMG_DELAY = 2500;   // แปลงสูงสุดกี่แปลง, ความเร็ววิ่ง (px ต่อวินาที), เริ่มโหลดรูปในการ์ดหลังหน้าโหลดหาย (ms)
  // การ์ดลอยลงที่ปุ๊บ (FLY_MS หลังเริ่มลอยเข้า ตอนการ์ดเกือบเข้าที่) แถววิ่งพรวดเร็วมากทันที: เร่งถึง BURST_PEAK เท่าใน BURST_UP ms
  //   แล้วค่อย ๆ ผ่อนกลับความเร็วปกติใน BURST_DOWN ms (เหมือนล้อที่ถูกปั่นแรง ๆ แล้วค่อยหยุด)
  //   BURST_PEAK ใช้กับการ์ดกว้าง BURST_CARD px ขึ้นไป การ์ดเล็กกว่านั้น (จอแคบ) ลดลงตามส่วน
  const FLY_MS = 380, BURST_PEAK = 110, BURST_UP = 160, BURST_DOWN = 1800, BURST_CARD = 300, BURST_FRAME = 1000 / 60;
  function plotsGallery(data) {
    const plots = data.plots
      .filter((p) => p.photos.length || p.villagers.length)
      .sort((a, b) => b.photos.length - a.photos.length || (b.lastPhotoAt || "").localeCompare(a.lastPhotoAt || ""))
      .slice(0, GALLERY_MAX);
    if (!plots.length) return;
    const section = document.getElementById("plots-gallery");
    const view = document.getElementById("pg-view"), track = document.getElementById("pg-track");
    section.hidden = false;

    // รูปในการ์ด (รูปชาวบ้าน รูปโปรไฟล์ ภาพดาวเทียม) ยังไม่โหลดตอนหน้าโหลด: รวมกันหลาย MB แย่งเน็ตกับแผนที่ฉากเปิดที่หน้าโหลดรออยู่
    //   (มือถือหน้าโหลดค้างนานขึ้นมาก) ปล่อยโหลดหลังหน้าโหลดหายไป GALLERY_IMG_DELAY ms หรือตอนเลื่อนเข้าใกล้บล็อกนี้ แล้วแต่อะไรถึงก่อน
    //   src = URL ของรูป หรือฟังก์ชันที่ได้ URL มาทีหลัง (ภาพดาวเทียมที่ต้องต่อ tile ก่อน)
    let imgsOpen = false;
    const loaders = new WeakMap();
    const load = (im) => {
      const get = loaders.get(im);
      if (!get) return;
      loaders.delete(im);
      Promise.resolve(get()).then((url) => url && (im.src = url));
    };
    const pic = (src, alt, cls) => {
      const im = el("img", cls);
      im.alt = alt || "";
      im.decoding = "async";
      loaders.set(im, typeof src === "function" ? src : () => src);
      if (imgsOpen) load(im);
      return im;
    };
    const openImgs = () => {
      if (imgsOpen) return;
      imgsOpen = true;
      track.querySelectorAll("img").forEach(load);
    };
    heroReady.promise.then(() => setTimeout(openImgs, GALLERY_IMG_DELAY));
    const near = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (near.disconnect(), openImgs()), { rootMargin: "250% 0px" });
    near.observe(section);

    const card = (p, copy, i) => {
      const a = el("a", "pg-card");
      a.href = link(`map.html#plot=${encodeURIComponent(p.code)}`);
      a.style.setProperty("--c", landUseColor(p.landUse));
      const name = p.villagers.length ? peopleLabel(p) : t("home.slider_no_owner");
      a.setAttribute("aria-label", `${name} · ${plotTitle(p)}`);
      a.style.setProperty("--i", Math.min(i, 10));   // ลำดับลอยเข้า (ใบหลัง ๆ อยู่นอกจออยู่แล้ว)
      if (copy) {
        // ชุดซ้ำไว้ให้วนต่อเนื่อง: โปรแกรมอ่านหน้าจอกับปุ่ม Tab ข้ามไป
        a.setAttribute("aria-hidden", "true");
        a.tabIndex = -1;
      }
      const grid = el("span", "pg-grid");
      const who = p.villagers[0];
      grid.append(who?.avatar_url ? pic(who.avatar_url, "", "pg-face") : who ? avatarEl(who, "pg-face") : el("span", "pg-face", RN.landUseIcon(p.landUse)));
      p.photos.slice(0, 3).forEach((ph) => grid.append(pic(ph.image_url, ph.caption || plotTitle(p))));
      if (grid.children.length < 4) {
        const W = 400, H = 400;
        const v = staticView(p.geojson, W, H, 2.4);
        const sat = el("span", "pg-sat");
        sat.append(pic(v.image, t("home.slider_satellite_alt", { plot: plotTitle(p) })), svgLayer(W, H, [[svgPath(p.geojson, v.project), "pg-outline", landUseColor(p.landUse)]]));
        grid.append(sat);
      }
      while (grid.children.length < 4) grid.append(el("span", "pg-blank"));
      const meta = el("span", "pg-meta");
      const photos = p.photos.length ? t("home.slider_photos", { n: formatNum(p.photos.length) }) : null;
      meta.append(el("span", null, [p.landUse, p.name, photos].filter(Boolean).join(" · ")));
      a.append(grid, el("strong", "pg-name", name), meta);
      return a;
    };

    // ลดการเคลื่อนไหว: ไม่วิ่ง ชุดเดียว เลื่อนแนวนอนเอง
    view.classList.toggle("still", reduceMotion);
    let builtFor = 0, rt = 0;
    const build = () => {
      const vw = document.documentElement.clientWidth || innerWidth;
      if (vw === builtFor) return;   // มือถือ: แถบที่อยู่หด/ยืดไม่ต้องสร้างใหม่
      builtFor = vw;
      track.replaceChildren(...plots.map((p, i) => card(p, false, i)));
      if (reduceMotion) return;
      const setW = track.offsetWidth;   // ความกว้างหนึ่งชุด (รวมช่องไฟท้ายการ์ด)
      const reps = Math.max(1, Math.ceil((vw + 1) / Math.max(setW, 1)));
      for (let k = 1; k < reps * 2; k++) plots.forEach((p, i) => track.append(card(p, true, k * plots.length + i)));
      track.style.setProperty("--pg-dur", `${(reps * setW) / GALLERY_SPEED}s`);
    };
    // วางบล็อกนี้ซ้อนท้ายบล็อก "ดินแต่ละผืน" ขึ้นไป --pg-over ให้แถวการ์ดเลื่อนขึ้นมาถึงกลางจอพอดีตอนลอยเข้า (t = GALLERY_SHOW)
    //   แล้วติดกลางจอ (sticky top = --pg-top) รั้งไว้ระยะเลื่อนเท่า .pg-hold ให้ดูการ์ดลอยเข้าจบก่อนค่อยเลื่อนต่อ
    //   ระหว่างเนื้อหาหยุดรอ ขอบล่างบล็อกนั้นอยู่ที่ sh + ความยาว .land-tail x (1 - t) บนจอ
    const tail = document.querySelector(".land-tail");
    const place = () => {
      if (!tail) return;
      const sh = screenH();
      const midS = view.offsetTop + view.offsetHeight / 2;   // กลางแถวการ์ด วัดจากขอบบนส่วนที่ติดจอ (.pg-stick)
      const padTop = parseFloat(getComputedStyle(section).paddingTop) || 0;
      section.style.setProperty("--pg-top", `${Math.round(sh / 2 - midS)}px`);
      const over = Math.max(0, sh / 2 + tail.offsetHeight * (1 - GALLERY_SHOW) + padTop + midS);
      section.style.setProperty("--pg-over", `${Math.round(over)}px`);
    };
    build();
    place();
    document.fonts?.ready.then(place);
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        // จอกว้างเปลี่ยน แถวสร้างใหม่: เลิกพรวดที่คิดไว้กับแถวเดิม
        if ((document.documentElement.clientWidth || innerWidth) !== builtFor) stopBurst();
        build();
        place();
      }, 250);
    });
    // พ้นจอแล้วหยุดวิ่ง (ไม่เปลืองเครื่อง)
    new IntersectionObserver(([e]) => view.classList.toggle("off", !e.isIntersecting)).observe(view);

    // วิ่งพรวด: คิดตำแหน่งแถวตลอดช่วงพรวดไว้ก่อนเป็น animation เดียว (track.animate) เบราว์เซอร์เล่นเองบนการ์ดจอ ไม่ต้องสั่งทุกเฟรม
    //   (เดิมเปลี่ยนความเร็วทีละเฟรม มือถือโดยเฉพาะ Safari ตามไม่ทัน แถวสั่น)
    //   ระหว่างพรวดปิด animation วิ่งปกติ (.burst) จบแล้วเปิดคืนโดยตั้งเวลาให้อยู่ตำแหน่งที่พรวดไปถึงพอดี (ต่อกันเนียน ไม่กระโดด)
    let burstWait = 0, burstAnim = null, burstAt = null;
    const runAnim = () => track.getAnimations?.().find((a) => a.animationName === "pg-run");
    // .intro: ช่วงลอยเข้า + วิ่งพรวด ห้ามหยุด (ชี้เมาส์/กดก็ไม่หยุด) จบแล้วค่อยกลับมาหยุดได้ตามปกติ
    const intro = (on) => {
      view.classList.toggle("intro", on);
      if (on) view.classList.remove("pause");
    };
    // ความเร็ว (กี่เท่าของปกติ) ที่ e ms หลังเริ่มพรวด
    const rateAt = (e, peak) => e < BURST_UP
      ? lerp(1, peak, ease(e / BURST_UP))
      : lerp(peak, 1, 1 - Math.pow(1 - Math.min(1, (e - BURST_UP) / BURST_DOWN), 3));
    // เอาตัวพรวดออก เปิด animation วิ่งปกติคืนที่เวลา runTime (ms) ในเฟรมเดียวกัน
    const endBurst = (runTime) => {
      const a = burstAnim;
      burstAnim = burstAt = null;
      view.classList.remove("burst");
      const run = runAnim();   // อ่านแล้วเบราว์เซอร์สร้าง animation วิ่งใหม่ทันที (ยังไม่วาด)
      const dur = run && Number(run.effect.getComputedTiming().duration);
      if (run && dur > 0) run.currentTime = ((runTime % dur) + dur) % dur;
      a?.cancel();
    };
    const stopBurst = () => {
      clearTimeout(burstWait);
      if (burstAnim) endBurst(burstAt(burstAnim.currentTime || 0));
      intro(false);
    };
    const burst = () => {
      const run = runAnim();
      const dur = run && Number(run.effect.getComputedTiming().duration);
      if (!run || !(dur > 0) || !track.animate) return intro(false);
      const P = track.getBoundingClientRect().width / 2;   // ระยะหนึ่งรอบ (pg-run เลื่อนไป -50%)
      // จอแคบ การ์ดเล็ก: ลดความเร็วสูงสุดตามขนาดการ์ด ไม่งั้นการ์ดผ่านจอเร็วจนดูกระตุก (จอกว้างการ์ดเต็มขนาด เท่าเดิม)
      const cardW = track.firstElementChild?.getBoundingClientRect().width || BURST_CARD;
      const peak = 1 + (BURST_PEAK - 1) * Math.min(1, cardW / BURST_CARD);
      const T = BURST_UP + BURST_DOWN, c0 = run.currentTime || 0;
      // d[i]: เวลาวิ่งปกติที่พรวดไปได้ถึงเฟรมที่ i (ms) ทุก ๆ BURST_FRAME ms
      const d = [0];
      for (let i = 1, acc = 0, e = 0; e < T; i++) {
        const to = Math.min(T, i * BURST_FRAME);
        for (const h = (to - e) / 8; e < to - 1e-9; e += h) acc += (h * (rateAt(e, peak) + rateAt(e + h, peak))) / 2;
        e = to;
        d.push(acc);
      }
      const n = d.length - 1;
      const runAt = (k) => c0 + d[k];
      burstAt = (e) => {
        const k = Math.min(n, Math.max(0, e / BURST_FRAME)), i = Math.min(n - 1, Math.floor(k));
        return c0 + lerp(d[i], d[i + 1], k - i);
      };
      // keyframe ทุกเฟรม ตำแหน่ง = ส่วนเศษของรอบ x P; ตรงที่ครบรอบใส่ -P กับ 0 ชิดกัน (หน้าตาเหมือนกัน วนต่อได้ไม่เห็นรอย)
      const at = (k) => Math.min(1, (k * BURST_FRAME) / T);
      const loops = (k) => runAt(k) / dur;
      const tx = (px) => ({ transform: `translateX(${(-px).toFixed(2)}px)` });
      const frames = [{ offset: 0, ...tx((loops(0) % 1) * P) }];
      for (let k = 1; k <= n; k++) {
        const ua = loops(k - 1), ub = loops(k);
        if (Math.floor(ub) > Math.floor(ua)) {
          const o = lerp(at(k - 1), at(k), (Math.floor(ub) - ua) / (ub - ua));
          frames.push({ offset: o, ...tx(P) }, { offset: Math.min(at(k), o + 1e-6), ...tx(0) });
        }
        frames.push({ offset: at(k), ...tx((ub % 1) * P) });
      }
      view.classList.add("burst");
      const a = (burstAnim = track.animate(frames, { duration: T, easing: "linear", fill: "forwards" }));
      a.startTime = document.timeline.currentTime;
      a.onfinish = () => {
        if (burstAnim !== a) return;
        endBurst(runAt(n));
        intro(false);
      };
    };
    const startBurst = () => {
      stopBurst();
      intro(true);
      burstWait = setTimeout(burst, FLY_MS);
    };
    if (!reduceMotion) {
      section.addEventListener("pg-show", startBurst);
      section.addEventListener("pg-hide", stopBurst);
      // เปิดหน้ามาเลยจุดนั้นแล้ว (กลับมาหน้านี้ที่ตำแหน่งเดิม): การ์ดขึ้นอยู่ก่อนแล้ว เร่งให้ดูหนึ่งครั้ง
      if (section.classList.contains("show")) startBurst();
    }
    // หยุดเมื่อขยับเมาส์เข้ามาชี้เองเท่านั้น: เมาส์ที่วางค้างอยู่ก่อนแล้วการ์ดเลื่อนมาอยู่ใต้มัน (movement = 0) ไม่นับ
    //   จอสัมผัสไม่หยุด (แตะ = เปิดแปลง) / ช่วง .intro ไม่หยุด
    track.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || view.classList.contains("intro") || !(e.movementX || e.movementY)) return;
      view.classList.add("pause");
    });
    track.addEventListener("pointerleave", () => view.classList.remove("pause"));
  }

  // ---------- หน้าโหลด ----------
  // ปิดหน้าไว้ (.is-loading ตั้งใน <head>) จนของที่ต้องใช้ตอนเลื่อนผ่านฉากเปิดพร้อมครบ เลื่อนแล้วจะได้ไม่สะดุด:
  //   data  ข้อมูลหมู่บ้าน/แปลง          map   แผนที่ 3 มิติจุดเริ่มโหลดเสร็จ
  //   warm  พากล้องโหลดตลอดทางที่จะแพน    mini  ภาพดาวเทียมในกรอบ
  //   land  ภาพพื้นหลังบล็อก "ดินแต่ละผืน"   fonts ฟอนต์ (ไม่ให้ตัวหนังสือเปลี่ยนขนาดกลางทาง)
  // ช้าเกิน BOOT_MAX_MS ก็เปิดหน้าอยู่ดี (ของที่เหลือโหลดต่อเบื้องหลัง)
  const BOOT_MAX_MS = 12000;
  const boot = (() => {
    const bar = document.getElementById("boot-bar");
    const all = ["data", "map", "warm", "mini", "land", "fonts"];
    const left = new Set(all);
    const api = {
      opened: false,
      open() {
        if (api.opened) return;
        api.opened = true;
        document.documentElement.classList.remove("is-loading");
        heroReady.resolve();   // ชื่อหมู่บ้านเริ่มลบ/พิมพ์ใหม่หลังหน้าโหลดหาย
        setTimeout(() => document.getElementById("boot")?.remove(), 900);
      },
      done(name) {
        if (!left.delete(name)) return;
        // เปิดหน้าด้วย ?debug: ดูใน console ว่าหน้าโหลดรออะไรเสร็จตอนไหน (ไว้หาว่าอะไรช้าบนมือถือ)
        if (/[?&]debug\b/.test(location.search)) console.log(`[boot] ${name} ${Math.round(performance.now())}ms`);
        if (bar) bar.style.transform = `scaleX(${Math.max(0.04, 1 - left.size / all.length)})`;
        if (!left.size) setTimeout(api.open, 300);   // ให้เห็นแถบเต็มแป๊บหนึ่ง
      },
    };
    setTimeout(api.open, BOOT_MAX_MS);
    if (document.fonts) document.fonts.ready.then(() => api.done("fonts"));
    else api.done("fonts");
    return api;
  })();

  // ---------- เริ่ม ----------
  typeTitle();
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.12 });
  document.querySelectorAll(".welcome, .land, .plots-gallery, .final-cta").forEach((s) => io.observe(s));
  landWash();

  loadAll()
    .then((data) => {
      boot.done("data");
      const name = data.areaTitle.replace(/^ชุมชน/, "");
      document.getElementById("hero-name").textContent = name;
      typer.name = name;
      document.querySelector(".boot-name")?.replaceChildren(name);
      document.querySelectorAll(".ghost-word, .footer-mark").forEach((n) => (n.textContent = name.replace(/^บ้าน/, "")));
      if (data.areaSub) document.getElementById("hero-place").textContent = data.areaSub;
      document.getElementById("footer-name").textContent = data.areaTitle;
      document.getElementById("footer-sub").textContent = data.areaSub;
      const [lng, lat] = RN.centerOf(data.area.geojson);
      document.getElementById("hero-coord").textContent = `${lat.toFixed(4)}° N   ${lng.toFixed(4)}° E`;
      document.title = t("home.page_title", { name });
      // ของที่หน้าโหลดรอ (ภาพในกรอบ แผนที่ฉากเปิด) เริ่มโหลดก่อน แถวรูปด้านล่างโหลดตอนเลื่อนเข้าใกล้อยู่แล้ว
      stats(data);
      miniMap(data);
      heroMap(data);
      plotsGallery(data);
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("hero-map").hidden = true;
      boot.open();
      RN.showError(err);
    });
});
