// หน้าเรื่องเล่า: ทุกชุดรูปเรียงจากล่าสุด แบ่งหัวข้อตามเดือน กรองตามการใช้ที่ดินและค้นหาคำได้
(() => {
  const { el, link, loadAll, landUseColor, landUseIcon, storyCard, plotTitle, peopleLabel } = RN;
  RN.renderNav("stories");
  document.querySelectorAll("[data-link]").forEach((a) => (a.href = link(a.dataset.link)));

  const state = { use: "all", q: "" };
  let data;

  function renderChips() {
    const counts = new Map();
    for (const s of data.stacks) if (s.plot) counts.set(s.plot.landUse, (counts.get(s.plot.landUse) || 0) + 1);
    const box = document.getElementById("use-chips");
    box.replaceChildren();
    const chip = (key, label, color) => {
      const b = el("button", "chip", label);
      b.setAttribute("aria-pressed", String(state.use === key));
      if (color) b.style.setProperty("--c", color);
      b.onclick = () => { state.use = state.use === key && key !== "all" ? "all" : key; renderChips(); render(); };
      box.append(b);
    };
    chip("all", "ทั้งหมด");
    for (const [k] of [...counts.entries()].sort((a, b) => b[1] - a[1])) chip(k, `${landUseIcon(k)} ${k}`, landUseColor(k));
    box.hidden = counts.size < 2;
  }

  function matches(s) {
    if (state.use !== "all" && s.plot?.landUse !== state.use) return false;
    if (!state.q) return true;
    const hay = [s.caption, ...s.photos.map((p) => p.caption), s.plot && plotTitle(s.plot), s.plot && peopleLabel(s.plot), s.plot?.code]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(state.q.toLowerCase());
  }

  function render() {
    const feed = document.getElementById("feed");
    feed.replaceChildren();
    const list = data.stacks.filter(matches);
    if (!data.stacks.length) {
      const empty = el("div", "empty-hero");
      empty.append(
        el("span", "empty-icon", "📷"),
        el("h3", null, "ยังไม่มีเรื่องเล่า"),
        el("p", null, "เรื่องแรกจะมาจากชาวบ้านสบปืนเอง เมื่อมีคนส่งรูปผ่าน LINE ของชุมชน ภาพจะขึ้นที่นี่และบนแผนที่ทันที"),
      );
      const a = el("a", "btn btn-primary", "ไปดูแผนที่หมู่บ้าน →");
      a.href = link("map.html");
      empty.append(a);
      feed.append(empty);
      return;
    }
    if (!list.length) {
      feed.append(el("p", "empty-note center", "ไม่พบเรื่องเล่าที่ตรงกับคำค้น"));
      return;
    }
    // หัวข้อตามเดือน แล้วการ์ดแบบ masonry
    let month, grid;
    for (const s of list) {
      const m = new Date(s.latest).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
      if (m !== month) {
        month = m;
        feed.append(el("h2", "month-head", m));
        grid = el("div", "masonry");
        feed.append(grid);
      }
      grid.append(storyCard(s));
    }
  }

  document.getElementById("q").addEventListener("input", (e) => { state.q = e.target.value.trim(); render(); });

  loadAll()
    .then((d) => {
      data = d;
      document.getElementById("area-name").textContent = data.area.name;
      document.getElementById("footer-name").textContent = data.areaTitle;
      renderChips();
      render();
    })
    .catch((err) => {
      console.error(err);
      RN.showError(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
    });
})();
