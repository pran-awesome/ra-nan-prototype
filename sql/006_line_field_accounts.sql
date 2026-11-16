-- LINE พิเศษ (บัญชีภาคสนาม): admin ออกโค้ด 8 หลัก, LINE ที่ผูกโค้ดนี้ส่งรูปแล้วเลือกเองว่าลงแปลงไหน (ได้ทุกแปลง)
-- รูปรอเป็น pending จนกว่าจะจิ้มเลือกแปลง จิ้มแล้วขึ้นแผนที่ทันที ไม่จิ้ม = ทีมงานระบุแปลงในหน้า admin
-- โค้ด 8 หลักไม่ชนกับโค้ดชาวบ้าน (6 หลัก) บอทแยกได้จากความยาว
-- LINE หนึ่งบัญชีผูกได้แบบเดียว: ผูกเป็น LINE พิเศษ = เลิกผูกกับชาวบ้าน และกลับกัน

create table public.line_field_accounts (
  id bigint generated always as identity primary key,
  label text not null check (length(trim(label)) between 1 and 60),
  code text unique check (code ~ '^[0-9]{8}$'),
  code_expires_at timestamptz,
  line_user_id text unique,
  line_display_name text,
  linked_at timestamptz,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.line_field_accounts enable row level security;
revoke all on public.line_field_accounts from anon, authenticated;
grant select on public.line_field_accounts to authenticated;
create policy field_read on public.line_field_accounts for select to authenticated using (public.has_role('admin'));
create trigger audit after insert or delete or update on public.line_field_accounts
  for each row execute function public.audit();

-- รูปจาก LINE พิเศษ: villager_id เป็น null และมี field_account_id แทน
alter table public.reports add column field_account_id bigint references public.line_field_accounts(id);
create index reports_field_batch on public.reports (user_id, batch_id) where field_account_id is not null;

-- ==========================================
-- หน้า admin (ต้องเป็น admin)
-- ==========================================

-- ออกโค้ดใหม่ ถ้าให้ p_id = ออกโค้ดใหม่ให้บัญชีเดิม (เช่น เปลี่ยนเครื่อง) โค้ดเก่าใช้ไม่ได้ทันที
create or replace function public.create_field_code(p_label text, p_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_code text;
  v_row public.line_field_accounts;
begin
  if not public.has_role('admin') then raise exception 'ต้องเป็น admin'; end if;
  loop
    v_code := lpad(((('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40)::bigint) % 100000000)::text, 8, '0');
    exit when not exists (select 1 from public.line_field_accounts where code = v_code);
  end loop;
  if p_id is null then
    insert into public.line_field_accounts (label, code, code_expires_at)
    values (trim(p_label), v_code, now() + interval '7 days')
    returning * into v_row;
  else
    update public.line_field_accounts
       set code = v_code, code_expires_at = now() + interval '7 days', is_active = true,
           label = coalesce(nullif(trim(p_label), ''), label)
     where id = p_id
    returning * into v_row;
    if v_row.id is null then raise exception 'ไม่พบบัญชีนี้'; end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'code', v_row.code, 'expires_at', v_row.code_expires_at);
end;
$$;

-- ปิดบัญชี: เลิกผูก LINE และยกเลิกโค้ดที่ยังไม่ใช้ (รูปเดิมยังอยู่)
create or replace function public.revoke_field_account(p_id bigint)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.has_role('admin') then raise exception 'ต้องเป็น admin'; end if;
  update public.line_field_accounts
     set is_active = false, line_user_id = null, linked_at = null, code = null, code_expires_at = null
   where id = p_id;
  if not found then raise exception 'ไม่พบบัญชีนี้'; end if;
end;
$$;

-- ==========================================
-- LINE worker (service_role เท่านั้น)
-- ==========================================

create or replace function public.consume_field_code(p_code text, p_line_user_id text, p_display_name text)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_id bigint;
  v_label text;
begin
  if (select count(*) from public.link_attempts
       where line_user_id = p_line_user_id and at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select id into v_id from public.line_field_accounts
   where code = p_code and is_active and code_expires_at > now()
   for update;
  if v_id is null then
    insert into public.link_attempts (line_user_id) values (p_line_user_id);
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.line_field_accounts set line_user_id = null, linked_at = null
   where line_user_id = p_line_user_id and id <> v_id;
  update public.villagers set line_user_id = null, line_display_name = null, linked_at = null
   where line_user_id = p_line_user_id;
  update public.line_field_accounts
     set line_user_id = p_line_user_id, line_display_name = p_display_name, linked_at = now(),
         code = null, code_expires_at = null
   where id = v_id
  returning label into v_label;
  return jsonb_build_object('status', 'linked', 'label', v_label);
end;
$$;

create or replace function public.line_field_sender(p_line_user_id text)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object('id', id, 'label', label)
  from public.line_field_accounts
  where line_user_id = p_line_user_id and is_active
$$;

-- เมนูเลือกแปลง: ทุกแปลงที่เปิดใช้งาน พร้อมชื่อเจ้าของหลัก
create or replace function public.line_field_plots()
returns jsonb
language sql
stable
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'owner', o.who) order by p.code), '[]'::jsonb)
  from public.plots p
  left join lateral (
    select coalesce(v.nickname, v.full_name) as who
    from public.plot_assignments a join public.villagers v on v.id = a.villager_id
    where a.plot_id = p.id and a.end_date is null
    order by a.is_primary desc, a.id limit 1
  ) o on true
  where p.is_active
$$;

-- รูปในชุดเดียวกัน (batch) อยู่ stack เดียวกัน ถ้าชุดนี้เลือกแปลงไปแล้ว รูปที่ตามมาทีหลังลงแปลงนั้นเลย
create or replace function public.add_field_photo(p_line_user_id text, p_image_url text, p_image_size bigint, p_batch text)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_acc bigint;
  v_stack timestamptz;
  v_plot bigint;
  v_id bigint;
begin
  select id into v_acc from public.line_field_accounts where line_user_id = p_line_user_id and is_active;
  if v_acc is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('ranan_field'), hashtext(p_batch));

  select min(stack_started_at), max(plot_id) into v_stack, v_plot
    from public.reports
   where user_id = p_line_user_id and field_account_id = v_acc and batch_id = p_batch and status <> 'removed';

  insert into public.reports (user_id, field_account_id, plot_id, image_url, image_size, status, batch_id, stack_started_at, created_at)
  values (p_line_user_id, v_acc, v_plot, p_image_url, p_image_size,
          case when v_plot is null then 'pending' else 'published' end,
          p_batch, coalesce(v_stack, clock_timestamp()), clock_timestamp())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'plot_id', v_plot);
end;
$$;

create or replace function public.set_field_batch_plot(p_line_user_id text, p_batch text, p_plot bigint)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_acc bigint;
  v_plot jsonb;
  v_n int;
begin
  select id into v_acc from public.line_field_accounts where line_user_id = p_line_user_id and is_active;
  if v_acc is null then return null; end if;
  select jsonb_build_object('id', id, 'code', code, 'name', name) into v_plot
    from public.plots where id = p_plot and is_active;
  if v_plot is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('ranan_field'), hashtext(p_batch));

  update public.reports
     set plot_id = p_plot, status = case when status = 'pending' then 'published' else status end
   where batch_id = p_batch and user_id = p_line_user_id and field_account_id = v_acc
     and status <> 'removed' and created_at > now() - interval '1 day';
  get diagnostics v_n = row_count;
  return v_plot || jsonb_build_object('updated', v_n);
end;
$$;

-- ==========================================
-- ผูกชาวบ้าน: เลิกผูก LINE พิเศษของ LINE นี้ และไม่ดึงรูปของ LINE พิเศษมาเป็นของชาวบ้าน
-- (เหมือนเดิมทุกอย่าง เพิ่ม 2 จุดที่มีคอมเมนต์)
-- ==========================================
create or replace function public._link_line(p_villager bigint, p_line_user_id text, p_display_name text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plot bigint := public.primary_plot(p_villager);
begin
  update public.villagers
     set line_user_id = null, line_display_name = null, linked_at = null
   where line_user_id = p_line_user_id and id <> p_villager;
  -- ใหม่: LINE หนึ่งบัญชีเป็นได้แบบเดียว
  update public.line_field_accounts set line_user_id = null, linked_at = null
   where line_user_id = p_line_user_id;
  update public.villagers
     set line_user_id = p_line_user_id,
         line_display_name = coalesce(p_display_name, line_display_name),
         linked_at = now(),
         avatar_updated_at = null
   where id = p_villager;
  update public.reports
     set villager_id = p_villager,
         plot_id = coalesce(plot_id, v_plot),
         status = case when status = 'pending' and coalesce(plot_id, v_plot) is not null then 'published' else status end
   where user_id = p_line_user_id and villager_id is null
     and field_account_id is null; -- ใหม่: รูปที่ส่งตอนเป็น LINE พิเศษไม่ย้ายมา
end;
$$;

-- ==========================================
-- สิทธิ์
-- ==========================================
revoke execute on function public.create_field_code(text, bigint), public.revoke_field_account(bigint),
  public.consume_field_code(text, text, text), public.line_field_sender(text), public.line_field_plots(),
  public.add_field_photo(text, text, bigint, text), public.set_field_batch_plot(text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.create_field_code(text, bigint), public.revoke_field_account(bigint) to authenticated, service_role;
grant execute on function public.consume_field_code(text, text, text), public.line_field_sender(text), public.line_field_plots(),
  public.add_field_photo(text, text, bigint, text), public.set_field_batch_plot(text, text, bigint) to service_role;
