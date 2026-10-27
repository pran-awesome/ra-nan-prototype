// publishable key เปิดเผยในเบราว์เซอร์ได้ หน้าเว็บอ่านแค่ view public_reports / public_areas
// ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด
window.RANAN_CONFIG = {
  supabaseUrl: "https://lwcjdfjycaoypcrieggj.supabase.co",
  supabaseKey: "sb_publishable_a31gjGBu9G9vVSq_xzFY7A_pil-8BYv",
  // เปิดด้วย ?sample แล้วหน้าเว็บจะอ่าน sample-data.json แทน Supabase (ใช้ตอนทำ UI บนเครื่อง)
  useSampleData: new URLSearchParams(location.search).has("sample"),
};
