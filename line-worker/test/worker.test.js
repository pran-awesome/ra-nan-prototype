// ทดสอบ Worker แบบไม่ต่อของจริง: จำลอง LINE, R2 และ Supabase ในหน่วยความจำ
// (ตรรกะฝั่งฐานข้อมูลของ rpc ทดสอบแยกด้วย Postgres จริง ที่นี่จำลองแค่ผลลัพธ์)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";

const SECRET = "test-secret";
const A1 = { id: 11, code: "A-01", name: "นาข้าว", is_primary: true };
const A2 = { id: 12, code: "A-02", name: "สวน", is_primary: false };

function setup({ villagers = [], codes = {} } = {}) {
  const rows = [];
  const replies = [];
  const r2 = new Map();
  const villagerPatches = [];
  let nextId = 1;
  const usage = {};

  const matches = (row, params) => {
    for (const [k, v] of params) {
      if (["order", "limit", "select"].includes(k)) continue;
      const val = row[k] ?? null;
      if (v === "is.null" && val !== null) return false;
      if (v === "not.is.null" && val === null) return false;
      if (v.startsWith("eq.") && String(val) !== v.slice(3)) return false;
      if (v.startsWith("gte.") && !(val >= v.slice(4))) return false;
    }
    return true;
  };
  const sender = (userId) => villagers.find((v) => v.line_user_id === userId) || null;

  // จำลอง add_line_photo ใน 005_photo_stacks.sql (ตรรกะจริงทดสอบกับ Postgres แยก)
  const clock = { now: Date.now() };
  const pendingCaption = {};
  const active = (vid) => rows.filter((r) => r.villager_id === vid && r.status !== "removed");
  const rpc = {
    add_line_photo: (a) => {
      const mine = active(a.p_villager_id);
      const last = mine.reduce((m, r) => (r.stack_started_at > m ? r.stack_started_at : m), 0);
      const inLast = mine.filter((r) => r.stack_started_at === last).length;
      const stack = !last || last <= clock.now - 3600e3 || inLast >= 4 ? clock.now++ : last;
      const row = { id: nextId++, created_at: new Date(clock.now).toISOString(), location: null, user_id: a.p_line_user_id,
        villager_id: a.p_villager_id, plot_id: a.p_plot_id, status: a.p_status, image_url: a.p_image_url,
        image_size: a.p_image_size, batch_id: a.p_batch, stack_started_at: stack };
      rows.push(row);
      const evicted = [];
      for (;;) {
        const now = active(a.p_villager_id);
        if (now.length <= 15 && new Set(now.map((r) => r.stack_started_at)).size <= 5) break;
        const victim = now.filter((r) => r.stack_started_at < stack).sort((x, y) => x.stack_started_at - y.stack_started_at || x.id - y.id)[0];
        if (!victim) break;
        Object.assign(victim, { status: "removed", removed_batch: a.p_batch });
        evicted.push(victim.image_url);
      }
      const be = rows.filter((r) => r.villager_id === a.p_villager_id && r.removed_batch === a.p_batch);
      return { id: row.id, evicted, batch_evicted: { count: be.length, oldest: be[0]?.created_at ?? null } };
    },
    line_my_photos: ({ p_line_user_id }) => {
      const v = sender(p_line_user_id);
      if (!v) return [];
      const groups = new Map();
      for (const r of active(v.id)) groups.set(r.stack_started_at, [...(groups.get(r.stack_started_at) || []), r]);
      return [...groups].sort((x, y) => y[0] - x[0]).map(([t, ps]) => ({ started: new Date(t).toISOString(),
        photos: ps.map((r) => ({ id: r.id, image_url: r.image_url, created_at: r.created_at, status: r.status, plot_code: "A-01", caption: r.caption ?? null })) }));
    },
    start_caption: ({ p_line_user_id, p_report_id, p_batch }) => {
      const v = sender(p_line_user_id);
      const hit = rows.filter((r) => v && r.villager_id === v.id && r.status !== "removed" && (r.id === p_report_id || (p_report_id == null && r.batch_id === p_batch)));
      if (hit.length) pendingCaption[p_line_user_id] = { p_report_id, p_batch };
      return hit.length;
    },
    apply_caption: ({ p_line_user_id, p_text }) => {
      const pc = pendingCaption[p_line_user_id];
      if (!pc) return null;
      delete pendingCaption[p_line_user_id];
      const hit = rows.filter((r) => r.status !== "removed" && (r.id === pc.p_report_id || (pc.p_report_id == null && r.batch_id === pc.p_batch)));
      hit.forEach((r) => (r.caption = p_text === "-" ? null : p_text));
      return hit.length;
    },
    cancel_caption: ({ p_line_user_id }) => {
      const had = !!pendingCaption[p_line_user_id];
      delete pendingCaption[p_line_user_id];
      return had || null;
    },
    remove_my_photo: ({ p_line_user_id, p_id }) => {
      const v = sender(p_line_user_id);
      const r = rows.find((x) => x.id === p_id && v && x.villager_id === v.id && x.status !== "removed");
      if (!r) return null;
      r.status = "removed";
      return r.image_url;
    },
    r2_usage_bytes: () => usage.bytes ?? rows.reduce((n, r) => n + (r.image_size || 0), 0),
    line_sender: ({ p_line_user_id }) => sender(p_line_user_id),
    consume_link_code: ({ p_code, p_line_user_id }) => {
      const v = codes[p_code];
      if (!v) return { status: "invalid" };
      delete codes[p_code];
      v.line_user_id = p_line_user_id;
      return { status: "linked", sender: v };
    },
    set_batch_plot: ({ p_line_user_id, p_batch, p_plot }) => {
      const plot = sender(p_line_user_id)?.plots.find((p) => p.id === p_plot);
      if (!plot) return null;
      const hit = rows.filter((r) => r.batch_id === p_batch && r.user_id === p_line_user_id);
      hit.forEach((r) => Object.assign(r, { plot_id: p_plot, status: "published" }));
      return { ...plot, updated: hit.length };
    },
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    if (url.hostname === "api-data.line.me") {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
    }
    if (url.hostname === "profile.line-scdn.net") {
      return new Response(new Uint8Array([1, 2, 3, 4, 5]), { headers: { "content-type": "image/jpeg" } });
    }
    if (url.pathname.startsWith("/v2/bot/profile/")) {
      return Response.json({ displayName: "ป้าแดง LINE", pictureUrl: "https://profile.line-scdn.net/abc" });
    }
    if (url.pathname === "/v2/bot/message/reply") {
      replies.push(JSON.parse(init.body).messages[0]);
      assert.equal(JSON.parse(init.body).messages.length, 1);
      return new Response("{}");
    }
    assert.equal(init.headers.apikey, "service-key");
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = rpc[url.pathname.slice("/rest/v1/rpc/".length)];
      return Response.json(fn(JSON.parse(init.body || "{}")));
    }
    if (url.pathname === "/rest/v1/villagers" && method === "PATCH") {
      villagerPatches.push(JSON.parse(init.body));
      return Response.json([{ id: 1 }]);
    }
    if (url.pathname === "/rest/v1/reports") {
      const params = [...url.searchParams];
      if (method === "POST") {
        rows.push({ id: nextId++, created_at: new Date().toISOString(), location: null, ...JSON.parse(init.body) });
        return new Response(null, { status: 201 });
      }
      const hit = rows.filter((r) => matches(r, params));
      if (method === "PATCH") {
        hit.forEach((r) => Object.assign(r, JSON.parse(init.body)));
        return Response.json(hit.map((r) => ({ id: r.id })));
      }
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };

  const env = {
    LINE_CHANNEL_SECRET: SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    PUBLIC_DOMAIN: "https://img.example.com/",
    STORAGE_LIMIT_GB: "8",
    BUCKET: {
      put: async (key, body, opts) => r2.set(key, { body, opts }),
      delete: async (key) => r2.delete(key),
    },
  };
  return { rows, replies, r2, env, usage, villagerPatches, clock };
}

async function post(env, events, sign = true) {
  const body = JSON.stringify({ destination: "x", events });
  const sig = sign ? createHmac("sha256", SECRET).update(body).digest("base64") : "bad";
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const res = await worker.fetch(
    new Request("https://w.example/webhook", { method: "POST", body, headers: { "x-line-signature": sig } }),
    env, ctx
  );
  await Promise.all(pending);
  return res;
}

const src = (userId = "U1") => ({ type: "user", userId });
const image = (id, imageSet, userId) => ({ type: "message", replyToken: `rt-${id}`, source: src(userId), message: { type: "image", id, ...(imageSet && { imageSet }) } });
const text = (t, userId) => ({ type: "message", replyToken: "rt-text", source: src(userId), message: { type: "text", text: t } });
const location = { type: "message", replyToken: "rt-loc", source: src(), message: { type: "location", latitude: 13.7, longitude: 100.5, address: "บ้านนา" } };
const fresh = new Date().toISOString();
const daeng = (plots, extra = {}) => ({ id: 1, full_name: "สมศรี ใจดี", line_user_id: "U1", avatar_url: null, avatar_updated_at: fresh, plots, ...extra });

test("rejects bad signature", async () => {
  const { env } = setup();
  assert.equal((await post(env, [], false)).status, 401);
});

test("LINE verify request (no events) returns 200", async () => {
  const { env } = setup();
  assert.equal((await post(env, [])).status, 200);
});

test("photo from a villager with one plot is published at that plot", async () => {
  const { env, rows, replies, r2 } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1")]);
  assert.equal(rows.length, 1);
  assert.ok(r2.has("photos/m1.jpg"), "stored under photos/ without userId");
  assert.deepEqual(
    { villager_id: rows[0].villager_id, plot_id: rows[0].plot_id, status: rows[0].status, batch_id: rows[0].batch_id, image_url: rows[0].image_url },
    { villager_id: 1, plot_id: 11, status: "published", batch_id: "m1", image_url: "https://img.example.com/photos/m1.jpg" }
  );
  assert.match(replies[0].text, /A-01 นาข้าว/);
  assert.deepEqual(replies[0].quickReply.items.map((i) => i.action.data), ["action=cap&batch=m1"], "only the caption button");
});

test("photo from an unlinked LINE user is refused, nothing stored, explains how to link", async () => {
  const { env, rows, replies, r2 } = setup();
  await post(env, [image("m1", { id: "s", index: 1, total: 2 }), image("m2", { id: "s", index: 2, total: 2 })]);
  assert.equal(rows.length, 0);
  assert.equal(r2.size, 0);
  assert.equal(replies.length, 1, "one reply for the whole set");
  assert.match(replies[0].text, /ต้องผูกบัญชีก่อน/);
  assert.match(replies[0].text, /โค้ด 6 หลัก/);
});

test("after linking with a code, the same LINE user can send photos", async () => {
  const v = daeng([A1], { line_user_id: null });
  const { env, rows, replies } = setup({ villagers: [v], codes: { "123456": v } });
  await post(env, [image("m0")]);
  assert.equal(rows.length, 0);
  await post(env, [text("123456")]);
  assert.match(replies.at(-1).text, /ผูกบัญชีกับ "สมศรี ใจดี" เรียบร้อย/);
  await post(env, [image("m1")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plot_id, 11);
  assert.equal(rows[0].status, "published");
});

test("photo from a villager without plots waits for staff", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([])] });
  await post(env, [image("m1")]);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].villager_id, 1);
  assert.match(replies[0].text, /ยังไม่มีแปลง/);
});

test("several plots: image set goes to primary plot, one reply with plot buttons, postback moves the set", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([A1, A2])] });
  await post(env, [image("m1", { id: "s1", index: 1, total: 2 }), image("m2", { id: "s1", index: 2, total: 2 })]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.plot_id === 11 && r.batch_id === "s1"));
  assert.equal(replies.length, 1, "image set replies once");
  const items = replies[0].quickReply.items;
  assert.deepEqual(items.map((i) => i.action.label), ["A-01 นาข้าว", "A-02 สวน", "✏️ เขียนคำบรรยาย"]);
  assert.equal(items[1].action.data, "plot=12&batch=s1");

  await post(env, [{ type: "postback", replyToken: "rt-pb", source: src(), postback: { data: items[1].action.data } }]);
  assert.ok(rows.every((r) => r.plot_id === 12));
  assert.match(replies.at(-1).text, /ย้ายรูปไปแปลง A-02/);
});

test("postback for a plot that is not yours is refused", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1")]);
  await post(env, [{ type: "postback", replyToken: "rt-pb", source: src(), postback: { data: "plot=99&batch=m1" } }]);
  assert.equal(rows[0].plot_id, 11);
  assert.match(replies.at(-1).text, /เลือกแปลงนี้ไม่ได้/);
});

test("labels longer than 20 characters are cut for LINE", async () => {
  const long = { id: 13, code: "B-01", name: "สวนมะม่วงริมคลองหลังวัด" };
  const { env, replies } = setup({ villagers: [daeng([A1, long])] });
  await post(env, [image("m1")]);
  assert.ok(replies[0].quickReply.items.every((i) => [...i.action.label].length <= 20));
});

test("6-digit code links the account, fetches the LINE avatar and lists plots", async () => {
  const v = daeng([A1], { line_user_id: null, avatar_updated_at: null, avatar_url: "https://img.example.com/avatars/old.jpg" });
  const { env, replies, r2, villagerPatches } = setup({ villagers: [v], codes: { "123456": v } });
  r2.set("avatars/old.jpg", {});
  await post(env, [text(" 123456 ")]);
  assert.match(replies[0].text, /ผูกบัญชีกับ "สมศรี ใจดี"/);
  assert.match(replies[0].text, /A-01/);
  assert.equal(villagerPatches.length, 1);
  assert.match(villagerPatches[0].avatar_url, /^https:\/\/img\.example\.com\/avatars\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(villagerPatches[0].avatar_size, 5);
  assert.equal(villagerPatches[0].line_display_name, "ป้าแดง LINE");
  assert.ok(!r2.has("avatars/old.jpg"), "old avatar deleted");
  assert.equal([...r2.keys()].filter((k) => k.startsWith("avatars/")).length, 1);
});

test("wrong code gets a clear error", async () => {
  const { env, replies } = setup();
  await post(env, [text("000000")]);
  assert.match(replies[0].text, /โค้ดไม่ถูกต้อง/);
});

test("chat text: hint for unlinked users, silence for linked ones", async () => {
  const { env, replies } = setup({ villagers: [daeng([A1])] });
  await post(env, [text("สวัสดี", "U1")]);
  assert.equal(replies.length, 0);
  await post(env, [text("สวัสดี", "U2")]);
  assert.match(replies[0].text, /โค้ด 6 หลัก/);
});

test("avatar is refreshed when older than 7 days, not on every photo", async () => {
  const { env, villagerPatches } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1")]);
  assert.equal(villagerPatches.length, 0);

  const old = setup({ villagers: [daeng([A1], { avatar_updated_at: "2020-01-01T00:00:00Z" })] });
  await post(old.env, [image("m1")]);
  assert.equal(old.villagerPatches.length, 1);
});

test("location messages are ignored: photos stay pinned at the plot", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1")]);
  await post(env, [location]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].location, null);
  assert.equal(rows[0].location_source, undefined);
  assert.match(replies.at(-1).text, /ไม่ต้องส่งตำแหน่ง/);
});

test("follow event greets and explains linking", async () => {
  const { env, replies } = setup();
  await post(env, [{ type: "follow", replyToken: "rt-f", source: src("U9") }]);
  assert.match(replies[0].text, /ยินดีต้อนรับ/);
});

test("stores image size for the storage counter", async () => {
  const { env, rows } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1")]);
  assert.equal(rows[0].image_size, 3);
});

test("rejects images once storage limit is reached", async () => {
  const { env, rows, replies, r2, usage } = setup({ villagers: [daeng([A1])] });
  usage.bytes = 8e9 - 1; // ใช้ไปเกือบเต็ม รูปขนาด 3 bytes จะทำให้เกิน
  await post(env, [image("m1")]);
  assert.equal(rows.length, 0);
  assert.equal(r2.size, 0);
  assert.match(replies[0].text, /พื้นที่เก็บรูปของระบบเต็ม/);
});

test("rejects images when usage check fails (fail closed)", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([A1])] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input).includes("/rpc/r2_usage_bytes") ? new Response("boom", { status: 500 }) : realFetch(input, init);
  await post(env, [image("m1")]);
  assert.equal(rows.length, 0);
  assert.match(replies[0].text, /พื้นที่เก็บรูปของระบบเต็ม/);
});

test("16th photo pushes out the oldest photo, deletes its file and tells the villager", async () => {
  const { env, rows, replies, r2, clock } = setup({ villagers: [daeng([A1])] });
  for (let i = 0; i < 15; i++) {
    if (i % 4 === 0) clock.now += 2 * 3600e3; // stack ใหม่ทุก 4 รูป
    await post(env, [image(`m${i}`)]);
  }
  assert.equal(r2.size, 15);
  assert.doesNotMatch(replies.at(-1).text, /ถูกนำออก/);
  await post(env, [image("m15")]);
  assert.equal(rows.filter((r) => r.status !== "removed").length, 15);
  assert.equal(rows.find((r) => r.batch_id === "m0").status, "removed");
  assert.ok(!r2.has("photos/m0.jpg"), "evicted file deleted from R2");
  assert.ok(r2.has("photos/m15.jpg"));
  assert.match(replies.at(-1).text, /ถูกนำออก 1 รูป/);
});

test("'รูปของฉัน' shows one card per stack with delete buttons", async () => {
  const { env, replies, clock } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("a1")]);
  clock.now += 2 * 3600e3;
  await post(env, [image("b1", { id: "s", index: 1, total: 2 }), image("b2", { id: "s", index: 2, total: 2 })]);
  await post(env, [text("รูปของฉัน")]);
  const msg = replies.at(-1);
  assert.equal(msg.type, "flex");
  const cards = msg.contents.contents;
  assert.equal(cards.length, 2);
  assert.equal(cards[0].body.contents.length, 2, "newest stack first, 2 photos");
  const [info, buttons] = cards[0].body.contents[0].contents;
  assert.equal(info.contents[0].url, "https://img.example.com/photos/b1.jpg");
  assert.deepEqual(buttons.contents.map((b) => b.action.label), ["✏️ คำบรรยาย", "🗑️ ลบ"]);
  assert.match(buttons.contents[0].action.data, /^action=cap&id=\d+$/);
  assert.match(buttons.contents[1].action.data, /^action=del&id=\d+$/);
});

test("'รูปของฉัน' for unlinked user explains linking; empty list says so", async () => {
  const { env, replies } = setup({ villagers: [daeng([A1])] });
  await post(env, [text("รูปของฉัน", "U9")]);
  assert.match(replies[0].text, /ต้องผูกบัญชีก่อน/);
  await post(env, [text("รูปของฉัน")]);
  assert.match(replies[1].text, /ยังไม่มีรูป/);
});

test("delete own photo: asks to confirm, then removes row and file; others cannot", async () => {
  const other = { id: 2, full_name: "คนอื่น", line_user_id: "U2", avatar_updated_at: fresh, plots: [A2] };
  const { env, rows, replies, r2 } = setup({ villagers: [daeng([A1]), other] });
  await post(env, [image("m1")]);
  const id = rows[0].id;
  const pb = (data, userId) => ({ type: "postback", replyToken: "rt-pb", source: src(userId), postback: { data } });
  await post(env, [pb(`action=del&id=${id}`)]);
  assert.match(replies.at(-1).text, /ลบรูปนี้ใช่ไหม/);
  assert.deepEqual(replies.at(-1).quickReply.items.map((i) => i.action.data), [`action=delok&id=${id}`, "action=cancel"]);
  assert.equal(rows[0].status, "published", "nothing removed before confirm");
  await post(env, [pb(`action=delok&id=${id}`, "U2")]);
  assert.match(replies.at(-1).text, /ไม่ใช่รูปของคุณ/);
  assert.ok(r2.has("photos/m1.jpg"));
  await post(env, [pb(`action=delok&id=${id}`)]);
  assert.equal(rows[0].status, "removed");
  assert.ok(!r2.has("photos/m1.jpg"));
  assert.match(replies.at(-1).text, /ลบรูปแล้ว/);
  await post(env, [pb("action=cancel")]);
  assert.match(replies.at(-1).text, /ยกเลิก/);
});

test("caption: button after photos, next text becomes caption for the whole set", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1", { id: "s", index: 1, total: 2 }), image("m2", { id: "s", index: 2, total: 2 })]);
  const btn = replies.at(-1).quickReply.items.at(-1);
  assert.equal(btn.action.data, "action=cap&batch=s");
  const pb = (data) => ({ type: "postback", replyToken: "rt-pb", source: src(), postback: { data } });
  await post(env, [pb(btn.action.data)]);
  assert.match(replies.at(-1).text, /พิมพ์คำบรรยายสำหรับรูป 2 รูป/);
  await post(env, [text("ข้าวออกรวงแล้ว")]);
  assert.match(replies.at(-1).text, /บันทึกคำบรรยายแล้วครับ \(2 รูป\)/);
  assert.deepEqual(rows.map((r) => r.caption), ["ข้าวออกรวงแล้ว", "ข้าวออกรวงแล้ว"]);
  const n = replies.length;
  await post(env, [text("ขอบคุณครับ")]);
  assert.equal(replies.length, n, "after the caption, chat from a linked user is not a caption and gets no reply");
  assert.equal(rows[0].caption, "ข้าวออกรวงแล้ว");
});

test("caption from 'รูปของฉัน' edits one photo; '-' clears; ยกเลิก cancels", async () => {
  const { env, rows, replies } = setup({ villagers: [daeng([A1])] });
  await post(env, [image("m1", { id: "s", index: 1, total: 2 }), image("m2", { id: "s", index: 2, total: 2 })]);
  const pb = (data) => ({ type: "postback", replyToken: "rt-pb", source: src(), postback: { data } });
  await post(env, [pb(`action=cap&id=${rows[1].id}`)]);
  assert.match(replies.at(-1).text, /^✏️ พิมพ์คำบรรยายส่งมาได้เลย/);
  await post(env, [text("รูปที่สอง")]);
  assert.deepEqual(rows.map((r) => r.caption ?? null), [null, "รูปที่สอง"]);
  await post(env, [text("รูปของฉัน")]);
  const info = replies.at(-1).contents.contents[0].body.contents[1].contents[0];
  assert.equal(info.contents[1].contents.at(-1).text, "รูปที่สอง", "card shows the caption");
  await post(env, [pb(`action=cap&id=${rows[1].id}`)]);
  await post(env, [text("-")]);
  assert.equal(rows[1].caption, null);
  assert.match(replies.at(-1).text, /ลบคำบรรยายแล้ว/);
  await post(env, [pb(`action=cap&id=${rows[0].id}`)]);
  await post(env, [text("ยกเลิก")]);
  assert.match(replies.at(-1).text, /ยกเลิกแล้ว/);
  await post(env, [text("ไม่ใช่คำบรรยาย")]);
  assert.equal(rows[0].caption ?? null, null);
});

test("caption: cannot caption someone else's photo", async () => {
  const other = { id: 2, full_name: "คนอื่น", line_user_id: "U2", avatar_updated_at: fresh, plots: [A2] };
  const { env, rows, replies } = setup({ villagers: [daeng([A1]), other] });
  await post(env, [image("m1")]);
  await post(env, [{ type: "postback", replyToken: "rt-pb", source: src("U2"), postback: { data: `action=cap&id=${rows[0].id}` } }]);
  assert.match(replies.at(-1).text, /ไม่พบรูปนี้/);
  await post(env, [text("แอบแก้", "U2")]);
  assert.equal(rows[0].caption ?? null, null);
});
