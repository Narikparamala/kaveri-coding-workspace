-- Kaveri Coding v0.11 — live class lock / unlock
-- Applied to production Supabase on 2026-08-26.

alter table public.coding_vscode_assignment_batches
  add column if not exists is_unlocked boolean not null default false,
  add column if not exists unlocked_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Preserve access for targets that existed before live locking was introduced.
update public.coding_vscode_assignment_batches
set is_unlocked = true,
    unlocked_at = coalesce(unlocked_at, created_at),
    updated_at = coalesce(updated_at, created_at)
where unlocked_at is null
  and locked_at is null;

drop function if exists public.get_coding_vscode_assignment_targets();
create function public.get_coding_vscode_assignment_targets()
returns table(
  id uuid,
  assignment_id uuid,
  batch_id uuid,
  is_unlocked boolean,
  unlocked_at timestamptz,
  locked_at timestamptz,
  updated_at timestamptz,
  updated_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_kaveri_staff() then
    raise exception 'Teacher access required';
  end if;

  return query
  select ab.id, ab.assignment_id, ab.batch_id, ab.is_unlocked,
         ab.unlocked_at, ab.locked_at, ab.updated_at, ab.updated_by, ab.created_at
  from public.coding_vscode_assignment_batches ab
  order by ab.created_at;
end;
$$;

create or replace function public.set_coding_vscode_assignment_target(
  p_assignment_id uuid,
  p_batch_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_kaveri_staff() then
    raise exception 'Teacher access required';
  end if;

  if p_enabled then
    insert into public.coding_vscode_assignment_batches (
      assignment_id, batch_id, is_unlocked, updated_at, updated_by
    ) values (
      p_assignment_id, p_batch_id, false, now(), auth.uid()
    )
    on conflict (assignment_id, batch_id)
    do update set updated_at = now(), updated_by = auth.uid();
  else
    delete from public.coding_vscode_assignment_batches
    where assignment_id = p_assignment_id and batch_id = p_batch_id;
  end if;
end;
$$;

create or replace function public.set_coding_vscode_assignment_lock(
  p_assignment_id uuid,
  p_batch_id uuid,
  p_unlocked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_kaveri_staff() then
    raise exception 'Teacher access required';
  end if;

  insert into public.coding_vscode_assignment_batches (
    assignment_id, batch_id, is_unlocked, unlocked_at, locked_at, updated_at, updated_by
  ) values (
    p_assignment_id,
    p_batch_id,
    p_unlocked,
    case when p_unlocked then now() else null end,
    case when not p_unlocked then now() else null end,
    now(),
    auth.uid()
  )
  on conflict (assignment_id, batch_id)
  do update set
    is_unlocked = excluded.is_unlocked,
    unlocked_at = case when excluded.is_unlocked then now() else public.coding_vscode_assignment_batches.unlocked_at end,
    locked_at = case when not excluded.is_unlocked then now() else public.coding_vscode_assignment_batches.locked_at end,
    updated_at = now(),
    updated_by = auth.uid();
end;
$$;

create or replace function public.get_my_coding_batches()
returns table(batch_id uuid, batch_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;

  return query
  select b.id, b.name
  from public.batch_students bs
  join public.batches b on b.id = bs.batch_id
  where bs.student_id = auth.uid()
    and bs.status = 'active'
    and b.status = 'active'
  order by bs.enrolled_at desc, b.name;
end;
$$;

create or replace function public.get_my_coding_classroom_assignments()
returns table(
  database_id uuid,
  assignment_key text,
  title text,
  topic text,
  language text,
  file_name text,
  marks numeric,
  updated_at timestamptz,
  is_unlocked boolean,
  batch_id uuid,
  batch_name text,
  question text,
  starter_code text,
  visible_tests jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select a.id as database_id, a.assignment_key, a.title, a.topic, a.language,
           a.file_name, a.marks, a.updated_at, ab.is_unlocked,
           b.id as batch_id, b.name as batch_name, a.question, a.starter_code,
           row_number() over (
             partition by a.id
             order by ab.is_unlocked desc, bs.enrolled_at desc, b.name
           ) as rn
    from public.batch_students bs
    join public.batches b on b.id = bs.batch_id and b.status = 'active'
    join public.coding_vscode_assignment_batches ab on ab.batch_id = b.id
    join public.coding_vscode_assignments a
      on a.id = ab.assignment_id and a.is_published = true and a.language = 'python'
    where bs.student_id = auth.uid() and bs.status = 'active'
  )
  select e.database_id, e.assignment_key, e.title, e.topic, e.language, e.file_name,
         e.marks, e.updated_at, e.is_unlocked, e.batch_id, e.batch_name,
         case when e.is_unlocked then e.question else null end,
         case when e.is_unlocked then coalesce(e.starter_code, '') else null end,
         case when e.is_unlocked then coalesce((
           select jsonb_agg(jsonb_build_array(t.input_text, t.expected_output) order by t.position)
           from public.coding_vscode_test_cases t
           where t.assignment_id = e.database_id and t.is_hidden = false
         ), '[]'::jsonb) else '[]'::jsonb end
  from eligible e
  where e.rn = 1
  order by e.updated_at, e.title;
$$;

-- Locked content must not be readable by bypassing the extension UI.
drop policy if exists vscode_assignments_student_read_published on public.coding_vscode_assignments;
create policy vscode_assignments_student_read_published
on public.coding_vscode_assignments
for select to authenticated
using (
  is_published = true
  and exists (
    select 1
    from public.coding_vscode_assignment_batches cab
    join public.batch_students bs on bs.batch_id = cab.batch_id
    join public.batches b on b.id = cab.batch_id
    where cab.assignment_id = coding_vscode_assignments.id
      and cab.is_unlocked = true
      and bs.student_id = auth.uid()
      and bs.status = 'active'
      and b.status = 'active'
  )
);

drop policy if exists vscode_test_cases_student_visible on public.coding_vscode_test_cases;
create policy vscode_test_cases_student_visible
on public.coding_vscode_test_cases
for select to authenticated
using (
  is_hidden = false
  and exists (
    select 1
    from public.coding_vscode_assignments a
    join public.coding_vscode_assignment_batches cab on cab.assignment_id = a.id
    join public.batch_students bs on bs.batch_id = cab.batch_id
    join public.batches b on b.id = cab.batch_id
    where a.id = coding_vscode_test_cases.assignment_id
      and a.is_published = true
      and cab.is_unlocked = true
      and bs.student_id = auth.uid()
      and bs.status = 'active'
      and b.status = 'active'
  )
);

revoke all on function public.get_coding_vscode_assignment_targets() from public;
revoke all on function public.set_coding_vscode_assignment_target(uuid, uuid, boolean) from public;
revoke all on function public.set_coding_vscode_assignment_lock(uuid, uuid, boolean) from public;
revoke all on function public.get_my_coding_batches() from public;
revoke all on function public.get_my_coding_classroom_assignments() from public;

grant execute on function public.get_coding_vscode_assignment_targets() to authenticated;
grant execute on function public.set_coding_vscode_assignment_target(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_coding_vscode_assignment_lock(uuid, uuid, boolean) to authenticated;
grant execute on function public.get_my_coding_batches() to authenticated;
grant execute on function public.get_my_coding_classroom_assignments() to authenticated;
