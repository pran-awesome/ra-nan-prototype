// RA-NAN LINE webhook on Cloudflare Workers.
// รับรูปจาก LINE, เก็บรูปลง R2, บันทึกลง Supabase (ตาราง reports) โดยปักหมุดที่แปลงของชาวบ้านที่ส่งมา
// ชาวบ้านผูกบัญชี LINE กับข้อมูลในระบบครั้งเดียวด้วยโค้ด 6 หลักที่ทีมงานออกให้ในหน้า admin

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";
const AVATAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_FULL_TEXT =
  "🙏 ขออภัยครับ ตอนนี้พื้นที่เก็บรูปของระบบเต็มแล้ว จึงยังรับรูปเพิ่มไม่ได้ชั่วคราว\nทีมงานกำลังดูแลอยู่ ขอบคุณที่ร่วมส่งเรื่องราวของชุมชนนะครับ";
const LINK_HINT_TEXT =
  "หากได้รับโค้ด 6 หลักจากทีมงาน พิมพ์โค้ดส่งมาในแชทนี้ได้เลยครับ ระบบจะผูกบัญชีกับแปลงของคุณ แล้วรูปที่ส่งมาจะขึ้นแผนที่ที่แปลงให้อัตโนมัติ";
const MY_PHOTOS_RE = /^(รูปของฉัน|รูปฉัน|จัดการรูป|my photos?)$/i;
const NOT_LINKED_TEXT =
  "🙏 ขออภัยครับ ต้องผูกบัญชีก่อนจึงจะส่งรูปขึ้นแผนที่ได้ รูปนี้ระบบยังไม่ได้เก็บไว้\nขอโค้ด 6 หลักจากทีมงาน แล้วพิมพ์โค้ดส่งมาในแชทนี้ จากนั้นส่งรูปใหม่อีกครั้งครับ";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ status: "ok", service: "ra-nan-line-webhook" });
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return json({ status: "not_found" }, 404);
    }

    const body = await request.text();
    const signature = request.headers.get("x-line-signature") || "";
    if (!(await verifySignature(body, signature, env.LINE_CHANNEL_SECRET))) {
      return json({ status: "invalid_signature" }, 401);
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return json({ status: "bad_json" }, 400);
    }

    // ตอบ LINE ทันที แล้วค่อยทำงานช้า (ดึงรูป/อัปโหลด/DB) ต่อเบื้องหลัง
    const events = Array.isArray(payload.events) ? payload.events : [];
    ctx.waitUntil(
      Promise.all(events.map((event) => handleEvent(event, env).catch((err) => {
        console.error("event failed", event?.webhookEventId, err?.stack || String(err));
      })))
    );
    return json({ status: "success" });
  },
};

// ==========================================
// Event handlers
// ==========================================

export async function handleEvent(event, env) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === "follow") return handleFollow(event, env, userId);
  if (event.type === "postback") return handlePostback(event, env, userId);
  if (event.type !== "message") return;

  const message = event.message;
  if (message.type === "image") return handleImage(event, env, userId);
  if (message.type === "location") return handleLocation(event, env);
  if (message.type === "text") return handleText(event, env, userId);
}

async function handleImage(event, env, userId) {
  const message = event.message;
  // ถ้าส่งหลายรูปพร้อมกัน (imageSet) ตอบกลับแค่รูปสุดท้าย ไม่ให้แชทรก
  const set = message.imageSet;
  const shouldReply = !set || set.index === set.total;

  const db = supabase(env);
  // รับรูปเฉพาะคนที่ผูกบัญชีแล้ว (ไม่ดึงรูป ไม่เก็บอะไรเลยถ้ายังไม่ผูก)
  const sender = await db.rpc("line_sender", { p_line_user_id: userId });
  if (!sender) {
    if (shouldReply) await replyText(env, event.replyToken, NOT_LINKED_TEXT);
    return;
  }

  let image;
  try {
    image = await fetchLineImage(env, message.id);
  } catch (err) {
    console.error("image fetch failed", err?.stack || String(err));
    if (shouldReply) await replyText(env, event.replyToken, "❌ เกิดข้อผิดพลาดในการรับรูปภาพ กรุณาลองส่งใหม่อีกครั้ง");
    return;
  }

  // ระบบป้องกันพื้นที่เต็ม: ถ้าใช้ไปแล้ว + รูปนี้ เกินเพดาน ไม่รับรูป
  // ถ้าเช็กยอดไม่ได้ ให้ปฏิเสธไว้ก่อน (fail closed) เพื่อไม่ให้เกินโดยไม่รู้ตัว
  let full = true;
  try {
    full = (await db.usageBytes()) + image.size > storageLimitBytes(env);
  } catch (err) {
    console.error("usage check failed", err?.stack || String(err));
  }
  if (full) {
    console.warn("storage limit reached, image rejected", message.id);
    if (shouldReply) await replyText(env, event.replyToken, STORAGE_FULL_TEXT);
    return;
  }

  let imageUrl;
  try {
    imageUrl = await storeImage(env, message.id, image);
  } catch (err) {
    console.error("image upload failed", err?.stack || String(err));
    if (shouldReply) await replyText(env, event.replyToken, "❌ เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ กรุณาลองส่งใหม่อีกครั้ง");
    return;
  }

  // ใช้แปลงไหน (แปลงหลักมาก่อน) ยังไม่มีแปลง = รอทีมงานระบุแปลงในหน้า admin
  const plots = sender.plots || [];
  const plot = plots[0] || null;
  const batch = set?.id || message.id;

  // จัด stack และดันรูปเก่าออกเมื่อเกิน 5 stack / 15 รูป (web/sql/005_photo_stacks.sql)
  const saved = await db.rpc("add_line_photo", {
    p_villager_id: sender.id,
    p_line_user_id: userId,
    p_plot_id: plot?.id ?? null,
    p_status: plot ? "published" : "pending",
    p_image_url: imageUrl,
    p_image_size: image.size,
    p_batch: batch,
  });
  for (const url of saved?.evicted || []) {
    const key = r2Key(env, url);
    if (key) await env.BUCKET.delete(key).catch((err) => console.error("evict delete failed", key, String(err)));
  }

  await refreshAvatar(env, db, sender, userId, false).catch((err) => {
    console.error("avatar refresh failed", err?.stack || String(err));
  });

  if (!shouldReply) return;
  const got = set ? `ได้รับรูป ${set.total} รูปแล้ว` : "ได้รับรูปแล้ว";
  const ev = saved?.batch_evicted;
  const evictedText = ev?.count
    ? `\n\n📦 เก็บรูปได้สูงสุด 15 รูป รูปเก่าตั้งแต่ ${fmtTime(ev.oldest)} ถูกนำออก ${ev.count} รูป`
    : "";
  // ปุ่มเขียนคำบรรยายให้รูปชุดนี้ (ต่อท้ายปุ่มเลือกแปลง ถ้ามี)
  const captionButton = { items: [captionItem(`action=cap&batch=${enc(batch)}`)] };
  if (!plot) {
    await replyText(env, event.replyToken, `✅ ${got} ขอบคุณครับ\nตอนนี้บัญชีของคุณยังไม่มีแปลง ทีมงานจะระบุแปลงให้แล้วรูปจะขึ้นแผนที่${evictedText}`, captionButton);
  } else if (plots.length === 1) {
    await replyText(env, event.replyToken, `✅ ${got} ขึ้นแผนที่ที่แปลง ${plotLabel(plot)} เรียบร้อย${evictedText}`, captionButton);
  } else {
    const plotButtons = plotQuickReply(plots, batch);
    await replyText(
      env,
      event.replyToken,
      `✅ ${got} ลงแปลง ${plotLabel(plot)} ไว้ก่อน\nถ้าเป็นแปลงอื่น กดเลือกด้านล่างได้เลยครับ${evictedText}`,
      { items: [...plotButtons.items.slice(0, 12), ...captionButton.items] }
    );
  }
}

// ไม่รับตำแหน่งจากชาวบ้านแล้ว หมุดอยู่ที่แปลงที่ทีมงานกำหนดเท่านั้น (กันปักหมุดผิดที่)
async function handleLocation(event, env) {
  await replyText(
    env,
    event.replyToken,
    "📍 ไม่ต้องส่งตำแหน่งแล้วครับ ระบบปักหมุดรูปที่แปลงของคุณให้อัตโนมัติ ส่งเฉพาะรูปมาได้เลย"
  );
}

async function handleText(event, env, userId) {
  const text = event.message.text?.trim() || "";
  const code = text.match(/^\d{6}$/)?.[0];
  const db = supabase(env);

  if (MY_PHOTOS_RE.test(text)) return showMyPhotos(event, env, db, userId);

  // กำลังรอคำบรรยาย (กดปุ่ม "เขียนคำบรรยาย" ไว้ภายใน 10 นาที): ข้อความนี้คือคำบรรยาย
  if (text === "ยกเลิก" && (await db.rpc("cancel_caption", { p_line_user_id: userId }))) {
    return replyText(env, event.replyToken, "ยกเลิกแล้วครับ");
  }
  const captioned = text && !code ? await db.rpc("apply_caption", { p_line_user_id: userId, p_text: text }) : null;
  if (captioned != null) {
    if (!captioned) return replyText(env, event.replyToken, "รูปนี้ถูกลบไปแล้วครับ");
    const what = captioned > 1 ? ` (${captioned} รูป)` : "";
    return replyText(env, event.replyToken, text === "-" ? `ลบคำบรรยายแล้วครับ${what}` : `✅ บันทึกคำบรรยายแล้วครับ${what}`);
  }

  if (!code) {
    // คุยทั่วไป: ตอบเฉพาะคนที่ยังไม่ผูก เพื่อบอกวิธีผูก
    if (!(await db.rpc("line_sender", { p_line_user_id: userId }))) {
      await replyText(env, event.replyToken, LINK_HINT_TEXT);
    }
    return;
  }

  const profile = await getProfile(env, userId);
  const result = await db.rpc("consume_link_code", {
    p_code: code,
    p_line_user_id: userId,
    p_display_name: profile?.displayName ?? null,
  });

  if (result?.status === "linked") {
    const sender = result.sender;
    await refreshAvatar(env, db, sender, userId, true, profile).catch((err) => {
      console.error("avatar refresh failed", err?.stack || String(err));
    });
    const plotText = sender.plots.length
      ? `แปลงของคุณ: ${sender.plots.map(plotLabel).join(", ")}`
      : "ตอนนี้ยังไม่มีแปลง ทีมงานจะเพิ่มให้";
    await replyText(
      env,
      event.replyToken,
      `✅ ผูกบัญชีกับ "${sender.full_name}" เรียบร้อยแล้ว\n${plotText}\n\nต่อไปส่งรูปได้เลย ไม่ต้องส่งตำแหน่ง หมุดจะขึ้นที่แปลงของคุณเอง`
    );
  } else if (result?.status === "rate_limited") {
    await replyText(env, event.replyToken, "⏳ ลองโค้ดผิดหลายครั้งเกินไป กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่ครับ");
  } else {
    await replyText(env, event.replyToken, "❌ โค้ดไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอโค้ดใหม่จากทีมงานครับ");
  }
}

async function handleFollow(event, env, userId) {
  const sender = await supabase(env).rpc("line_sender", { p_line_user_id: userId });
  const text = sender
    ? `ยินดีต้อนรับกลับครับ คุณ${sender.full_name} ส่งรูปมาได้เลย หมุดจะขึ้นที่แปลงของคุณ`
    : `สวัสดีครับ ยินดีต้อนรับสู่ RA-NAN 🌾 ก่อนส่งรูป ต้องผูกบัญชีกับทีมงานก่อนครับ\n\n${LINK_HINT_TEXT}`;
  await replyText(env, event.replyToken, text);
}

// เมนู "รูปของฉัน": การ์ด 1 ใบต่อ 1 stack (stack ใหม่สุดก่อน) แต่ละรูปมีปุ่มลบ
async function showMyPhotos(event, env, db, userId) {
  if (!(await db.rpc("line_sender", { p_line_user_id: userId }))) {
    return replyText(env, event.replyToken, `ต้องผูกบัญชีก่อนครับ\n\n${LINK_HINT_TEXT}`);
  }
  const stacks = (await db.rpc("line_my_photos", { p_line_user_id: userId })) || [];
  if (!stacks.length) return replyText(env, event.replyToken, "ยังไม่มีรูปครับ ส่งรูปเข้ามาได้เลย");
  const total = stacks.reduce((n, s) => n + s.photos.length, 0);
  await replyMessages(env, event.replyToken, [{
    type: "flex",
    altText: `รูปของฉัน ${total} รูป`,
    contents: { type: "carousel", contents: stacks.slice(0, 12).map(stackBubble) },
  }]);
}

function stackBubble(stack) {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box", layout: "vertical", paddingBottom: "none",
      contents: [
        { type: "text", text: `ชุด ${fmtTime(stack.started)}`, weight: "bold", size: "sm" },
        { type: "text", text: `${stack.photos.length} รูป`, size: "xs", color: "#888888" },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "lg",
      contents: stack.photos.map((p) => ({
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "md",
            contents: [
              { type: "image", url: p.image_url, size: "72px", aspectRatio: "1:1", aspectMode: "cover", flex: 0 },
              {
                type: "box", layout: "vertical", flex: 1,
                // LINE ไม่รับ text ว่าง
                contents: [
                  { type: "text", text: fmtTime(p.created_at, true), size: "sm" },
                  ...(photoNote(p) ? [{ type: "text", text: photoNote(p), size: "xxs", color: "#888888", wrap: true }] : []),
                  ...(p.caption ? [{ type: "text", text: p.caption, size: "xs", wrap: true, maxLines: 3 }] : []),
                ],
              },
            ],
          },
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              {
                type: "button", style: "secondary", height: "sm",
                action: { type: "postback", label: p.caption ? "✏️ แก้คำบรรยาย" : "✏️ คำบรรยาย", data: `action=cap&id=${p.id}`, displayText: "เขียนคำบรรยาย" },
              },
              {
                type: "button", style: "secondary", height: "sm",
                action: { type: "postback", label: "🗑️ ลบ", data: `action=del&id=${p.id}`, displayText: `ลบรูป ${fmtTime(p.created_at, true)}` },
              },
            ],
          },
        ],
      })),
    },
  };
}

function captionItem(data) {
  return { type: "action", action: { type: "postback", label: "✏️ เขียนคำบรรยาย", data, displayText: "เขียนคำบรรยาย" } };
}

function photoNote(p) {
  if (p.status === "pending") return "รอทีมงานระบุแปลง";
  if (p.status === "hidden") return "ทีมงานซ่อนไว้";
  return p.plot_code ? `แปลง ${p.plot_code}` : "";
}

// ชาวบ้านกดปุ่มเลือกแปลงให้รูปชุดล่าสุด / ลบรูปตัวเอง
async function handlePostback(event, env, userId) {
  const params = new URLSearchParams(event.postback?.data || "");
  const action = params.get("action");
  if (action === "del") {
    return replyText(env, event.replyToken, "ลบรูปนี้ใช่ไหมครับ ลบแล้วกู้คืนไม่ได้", {
      items: [
        { type: "action", action: { type: "postback", label: "ยืนยันลบ", data: `action=delok&id=${enc(params.get("id"))}`, displayText: "ยืนยันลบ" } },
        { type: "action", action: { type: "postback", label: "ยกเลิก", data: "action=cancel", displayText: "ยกเลิก" } },
      ],
    });
  }
  if (action === "delok") {
    const url = await supabase(env).rpc("remove_my_photo", { p_line_user_id: userId, p_id: Number(params.get("id")) });
    if (!url) return replyText(env, event.replyToken, "รูปนี้ถูกลบไปแล้ว หรือไม่ใช่รูปของคุณครับ");
    const key = r2Key(env, url);
    if (key) await env.BUCKET.delete(key);
    return replyText(env, event.replyToken, "🗑️ ลบรูปแล้วครับ\nพิมพ์ \"รูปของฉัน\" เพื่อดูรูปที่เหลือ");
  }
  if (action === "cancel") return replyText(env, event.replyToken, "ยกเลิกแล้วครับ");
  if (action === "cap") {
    const id = params.get("id");
    const n = await supabase(env).rpc("start_caption", {
      p_line_user_id: userId,
      p_report_id: id ? Number(id) : null,
      p_batch: id ? null : params.get("batch"),
    });
    if (!n) return replyText(env, event.replyToken, "ไม่พบรูปนี้แล้วครับ (อาจถูกลบไปแล้ว)");
    return replyText(
      env,
      event.replyToken,
      `✏️ พิมพ์คำบรรยาย${n > 1 ? `สำหรับรูป ${n} รูปนี้` : ""}ส่งมาได้เลยครับ ภายใน 10 นาที\nพิมพ์ - ถ้าต้องการลบคำบรรยาย`,
      { items: [{ type: "action", action: { type: "postback", label: "ยกเลิก", data: "action=capcancel", displayText: "ยกเลิก" } }] }
    );
  }
  if (action === "capcancel") {
    await supabase(env).rpc("cancel_caption", { p_line_user_id: userId });
    return replyText(env, event.replyToken, "ยกเลิกแล้วครับ");
  }

  const plotId = Number(params.get("plot"));
  const batch = params.get("batch");
  if (!plotId || !batch) return;

  const plot = await supabase(env).rpc("set_batch_plot", { p_line_user_id: userId, p_batch: batch, p_plot: plotId });
  if (plot) {
    await replyText(env, event.replyToken, `📍 ย้ายรูปไปแปลง ${plotLabel(plot)} แล้วครับ`);
  } else {
    await replyText(env, event.replyToken, "❌ เลือกแปลงนี้ไม่ได้ (อาจไม่ใช่แปลงของคุณแล้ว) ทีมงานจะช่วยตรวจให้ครับ");
  }
}

function plotLabel(plot) {
  return plot.name ? `${plot.code} ${plot.name}` : plot.code;
}

function plotQuickReply(plots, batch) {
  // LINE ให้ปุ่มได้ไม่เกิน 13 ปุ่ม และป้ายปุ่มยาวได้ไม่เกิน 20 ตัวอักษร
  return {
    items: plots.slice(0, 13).map((p) => ({
      type: "action",
      action: {
        type: "postback",
        label: [...plotLabel(p)].slice(0, 20).join(""),
        data: `plot=${p.id}&batch=${enc(batch)}`,
        displayText: `แปลง ${plotLabel(p)}`,
      },
    })),
  };
}

// ==========================================
// LINE helpers
// ==========================================

export async function verifySignature(body, signature, secret) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function fetchLineImage(env, messageId) {
  const res = await fetch(`${LINE_DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`LINE content ${res.status}: ${await res.text()}`);
  const data = await res.arrayBuffer();
  return { data, size: data.byteLength, contentType: res.headers.get("content-type") || "image/jpeg" };
}

async function getProfile(env, userId) {
  try {
    const res = await fetch(`${LINE_API}/profile/${enc(userId)}`, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) throw new Error(`LINE profile ${res.status}: ${await res.text()}`);
    return await res.json();
  } catch (err) {
    console.error("profile fetch failed", err?.stack || String(err));
    return null;
  }
}

// รูปโปรไฟล์ LINE เป็นลิงก์ชั่วคราว จึงคัดลอกมาเก็บใน R2 แล้วรีเฟรชทุก 7 วัน (หรือทันทีตอนผูกบัญชี)
async function refreshAvatar(env, db, sender, userId, force, profile) {
  const age = sender.avatar_updated_at ? Date.now() - Date.parse(sender.avatar_updated_at) : Infinity;
  if (!force && age < AVATAR_MAX_AGE_MS) return;

  profile = profile || (await getProfile(env, userId));
  if (!profile) return;

  const patch = { line_display_name: profile.displayName ?? null, avatar_updated_at: new Date().toISOString() };
  if (profile.pictureUrl) {
    const res = await fetch(profile.pictureUrl);
    if (!res.ok) throw new Error(`LINE picture ${res.status}`);
    const data = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    // ชื่อไฟล์สุ่ม ไม่มี userId เพราะ URL เป็นสาธารณะ
    const key = `avatars/${crypto.randomUUID()}.${contentType.includes("png") ? "png" : "jpg"}`;
    await env.BUCKET.put(key, data, { httpMetadata: { contentType } });
    Object.assign(patch, { avatar_url: publicUrl(env, key), avatar_size: data.byteLength });
  } else {
    Object.assign(patch, { avatar_url: null, avatar_size: null });
  }
  await db.from("villagers").update(`id=eq.${sender.id}`, patch);

  const oldKey = r2Key(env, sender.avatar_url);
  if (oldKey && oldKey !== r2Key(env, patch.avatar_url)) await env.BUCKET.delete(oldKey);
}

async function storeImage(env, messageId, image) {
  const ext = image.contentType.includes("png") ? "png" : "jpg";
  // ชื่อไฟล์ใช้แค่ messageId (ไม่ใส่ userId เพราะ URL รูปเป็นสาธารณะ) ถ้า LINE ส่ง event ซ้ำจะเขียนทับไฟล์เดิม
  const key = `photos/${messageId}.${ext}`;
  await env.BUCKET.put(key, image.data, { httpMetadata: { contentType: image.contentType } });
  return publicUrl(env, key);
}

function publicUrl(env, key) {
  return `${env.PUBLIC_DOMAIN.replace(/\/$/, "")}/${key}`;
}

function r2Key(env, url) {
  const prefix = `${env.PUBLIC_DOMAIN.replace(/\/$/, "")}/`;
  return url && url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

function fmtTime(iso, timeOnlyToday = false) {
  const d = new Date(iso);
  const opt = { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" };
  const day = (x) => x.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" });
  if (timeOnlyToday && day(d) === day(new Date())) return d.toLocaleTimeString("th-TH", opt);
  return d.toLocaleString("th-TH", { ...opt, day: "numeric", month: "short" });
}

function replyText(env, replyToken, text, quickReply) {
  return replyMessages(env, replyToken, [{ type: "text", text, ...(quickReply && { quickReply }) }]);
}

async function replyMessages(env, replyToken, messages) {
  if (!replyToken) return;
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error("LINE reply failed", res.status, await res.text());
}

// ==========================================
// Supabase (PostgREST) helpers
// ==========================================

function supabase(env) {
  const root = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  async function call(method, url, query, body, prefer) {
    const res = await fetch(`${url}${query ? `?${query}` : ""}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    from: (table) => ({
      insert: (row) => call("POST", `${root}/${table}`, "", row, "return=minimal"),
      update: async (query, patch) =>
        (await call("PATCH", `${root}/${table}`, `${query}&select=id`, patch, "return=representation")) || [],
    }),
    // ฟังก์ชันใน web/sql/002_admin_plots.sql (เรียกได้เฉพาะ service_role)
    rpc: (name, args) => call("POST", `${root}/rpc/${name}`, "", args),
    // ผลรวมขนาดรูป + รูปโปรไฟล์ (web/sql/002_admin_plots.sql)
    usageBytes: async () => Number(await call("POST", `${root}/rpc/r2_usage_bytes`, "", {})),
  };
}

function storageLimitBytes(env) {
  // ใช้ 1 GB = 1,000,000,000 bytes (เผื่อไว้ต่ำกว่า GiB เล็กน้อย)
  return Number(env.STORAGE_LIMIT_GB || 8) * 1e9;
}

const enc = encodeURIComponent;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
