# RA-NAN

แพลตฟอร์มชุมชน: ชาวบ้านส่งรูปผ่าน LINE bot แล้วรูปขึ้นบนแผนที่ดาวเทียมตามแปลงของแต่ละคน

| โฟลเดอร์ | คืออะไร | ขึ้นไปที่ |
|---|---|---|
| `public/` | หน้าเว็บ static (แผนที่, เรื่องเล่า, `/admin/`) | Worker `ra-nan-web` |
| `line-worker/` | LINE webhook รับรูป เก็บ R2 บันทึก Supabase | Worker `ra-nan-line-webhook` |
| `sql/` | migration ของ Supabase (รันเองใน SQL Editor ไม่ได้ deploy อัตโนมัติ) | Supabase |
| `tools/gen_sample.py` | สร้างข้อมูลตัวอย่างใน `public/sample/` (เปิดเว็บด้วย `?sample`) | |

## Deploy อัตโนมัติ (GitHub Actions)

| ทำอะไร | ผลที่ได้ |
|---|---|
| push / merge เข้า `main` ที่แก้ `public/` | เว็บจริงอัปเดตใน ~1 นาที |
| push / merge เข้า `main` ที่แก้ `line-worker/` | รันเทสต์ก่อน ผ่านแล้ว LINE bot อัปเดต |
| เปิด PR ที่แก้ `public/` | ได้ลิงก์ preview `https://pr-<เลข PR>-ra-nan-web.pranpan-som.workers.dev` ในคอมเมนต์ PR เว็บจริงไม่เปลี่ยน |
| เปิด PR ที่แก้ `line-worker/` | รันเทสต์อย่างเดียว |
| อยาก deploy ใหม่เฉย ๆ | แท็บ Actions → เลือก Web หรือ LINE worker → Run workflow |

ไฟล์อยู่ที่ `.github/workflows/web.yml` และ `.github/workflows/line-worker.yml`

### ตั้งค่าครั้งแรก (ทำครั้งเดียว)

1. **สร้าง API token:** Cloudflare dashboard → รูปโปรไฟล์ → My Profile → API Tokens → Create Token → ใช้ template **Edit Cloudflare Workers** → Account Resources เลือกบัญชีนี้, Zone Resources เลือก All zones → Create แล้ว copy token
2. **หา Account ID:** Cloudflare dashboard → Workers & Pages → ด้านขวามี Account ID
3. **ใส่ใน GitHub:** repo → Settings → Secrets and variables → Actions → New repository secret
   - `CLOUDFLARE_API_TOKEN` = token จากข้อ 1
   - `CLOUDFLARE_ACCOUNT_ID` = จากข้อ 2

ค่าลับของ LINE bot (`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) **อยู่ใน Cloudflare เหมือนเดิม ไม่ต้องใส่ใน GitHub** และ deploy ไม่ลบ (`keep_vars = true` ใน `line-worker/wrangler.toml`) ห้าม commit ค่าลับลง repo นี้เด็ดขาด (repo เป็น public) `public/config.js` มีแค่ publishable key ซึ่งเปิดเผยได้

### ข้อควรรู้

- preview ใช้ฐานข้อมูลจริง แก้ข้อมูลในหน้า `/admin/` ของ preview = แก้ของจริง
- เปลี่ยน SQL ยังต้องรันเองใน Supabase SQL Editor ก่อน merge โค้ดที่ต้องใช้ตารางใหม่
- deploy เองจากเครื่องยังทำได้: `npx wrangler deploy` ที่ root (เว็บ) และ `cd line-worker && npx wrangler deploy -c wrangler.toml` (LINE bot ต้องมี `-c` เสมอ)

## รันบนเครื่อง

```bash
npx wrangler dev                      # เว็บ http://localhost:8787 (เติม ?sample ใช้ข้อมูลตัวอย่าง)
cd line-worker && npm test            # เทสต์ LINE bot แบบจำลอง ไม่ต่อของจริง
```

รายละเอียดเพิ่ม: `line-worker/README.md`
