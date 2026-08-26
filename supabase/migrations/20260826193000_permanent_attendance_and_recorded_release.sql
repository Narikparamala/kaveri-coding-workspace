-- Kaveri Coding: permanent live-attendance access + recorded/self-paced release

alter table public.coding_vscode_assignment_batches
  add column if not exists is_permanently_released boolean not null default false;

create table if not exists public.coding_vscode_student_assignment_access (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.coding_vscode_assignments(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  source text not null default 'live_attendance',
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  unique (student_id, assignment_id, batch_id)
);

alter table public.coding_vscode_student_assignment_access enable row level security;

drop policy if exists coding_student_access_read_own on public.coding_vscode_student_assignment_access;
create policy coding_student_access_read_own
on public.coding_vscode_student_assignment_access
for select to authenticated
using (student_id = auth.uid() or public.is_kaveri_staff());

drop policy if exists coding_student_access_staff_all on public.coding_vscode_student_assignment_access;
create policy coding_student_access_staff_all
on public.coding_vscode_student_assignment_access
for all to authenticated
using (public.is_kaveri_staff())
with check (public.is_kaveri_staff());

create or replace function public.start_coding_live_class(
  p_batch_id uuid,
  p_assignment_ids uuid[],
  p_minutes integer default 90
)
returns table(assignment_id uuid, batch_id uuid, live_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_assignment uuid;
begin
  if not public.is_kaveri_staff() then raise exception 'Teacher access required'; end if;
  if coalesce(array_length(p_assignment_ids, 1), 0) = 0 then raise exception 'Select at least one question'; end if;
  if p_minutes < 5 or p_minutes > 480 then raise exception 'Live class duration must be between 5 and 480 minutes'; end if;
  if not exists (select 1 from public.batches b where b.id = p_batch_id and b.status = 'active') then
    raise exception 'Active batch not found';
  end if;

  v_until := now() + make_interval(mins => p_minutes);

  foreach v_assignment in array p_assignment_ids loop
    if not exists (
      select 1 from public.coding_vscode_assignments a
      where a.id = v_assignment and a.is_published = true and a.language = 'python'
    ) then raise exception 'Published Python question not found'; end if;

    insert into public.coding_vscode_assignment_batches (
      assignment_id, batch_id, is_unlocked, unlocked_at, locked_at, live_until,
      is_permanently_released, updated_at, updated_by
    ) values (
      v_assignment, p_batch_id, true, now(), null, v_until,
      false, now(), auth.uid()
    )
    on conflict on constraint coding_vscode_assignment_batches_assignment_id_batch_id_key
    do update set
      is_unlocked = true,
      unlocked_at = now(),
      locked_at = null,
      live_until = v_until,
      updated_at = now(),
      updated_by = auth.uid();
  end loop;

  return query
  select ab.assignment_id, ab.batch_id, ab.live_until
  from public.coding_vscode_assignment_batches ab
  where ab.batch_id = p_batch_id
    and ab.assignment_id = any(p_assignment_ids);
end;
$$;

create or replace function public.join_coding_live_class(p_batch_id uuid)
returns table(unlocked_count integer, batch_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_batch_name text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'student' and coalesce(p.is_active, true) = true
  ) then raise exception 'Only active student accounts can join a live class'; end if;

  select b.name into v_batch_name
  from public.batch_students bs
  join public.batches b on b.id = bs.batch_id
  where bs.student_id = auth.uid()
    and bs.status = 'active'
    and b.status = 'active'
    and b.id = p_batch_id;

  if v_batch_name is null then raise exception 'You are not enrolled in this active batch'; end if;

  insert into public.coding_vscode_student_assignment_access (
    student_id, assignment_id, batch_id, source, granted_at, granted_by
  )
  select auth.uid(), ab.assignment_id, ab.batch_id, 'live_attendance', now(), null
  from public.coding_vscode_assignment_batches ab
  join public.coding_vscode_assignments a on a.id = ab.assignment_id
  where ab.batch_id = p_batch_id
    and a.is_published = true
    and ab.is_unlocked = true
    and ab.live_until is not null
    and ab.live_until > now()
  on conflict (student_id, assignment_id, batch_id)
  do update set source = 'live_attendance',
                granted_at = least(public.coding_vscode_student_assignment_access.granted_at, excluded.granted_at);

  get diagnostics v_count = row_count;

  if v_count = 0 and not exists (
    select 1 from public.coding_vscode_assignment_batches ab
    where ab.batch_id = p_batch_id
      and ab.is_unlocked = true
      and ab.live_until is not null
      and ab.live_until > now()
  ) then raise exception 'There is no live coding class active for this batch right now'; end if;

  return query select v_count, v_batch_name;
end;
$$;

create or replace function public.release_coding_assignments_permanently(
  p_batch_id uuid,
  p_assignment_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment uuid;
  v_count integer := 0;
begin
  if not public.is_kaveri_staff() then raise exception 'Teacher access required'; end if;
  if coalesce(array_length(p_assignment_ids, 1), 0) = 0 then raise exception 'Select at least one question'; end if;

  foreach v_assignment in array p_assignment_ids loop
    insert into public.coding_vscode_assignment_batches (
      assignment_id, batch_id, is_unlocked, unlocked_at, locked_at, live_until,
      is_permanently_released, updated_at, updated_by
    ) values (
      v_assignment, p_batch_id, false, null, null, null,
      true, now(), auth.uid()
    )
    on conflict on constraint coding_vscode_assignment_batches_assignment_id_batch_id_key
    do update set is_permanently_released = true, updated_at = now(), updated_by = auth.uid();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Recreate RPCs because their OUT parameter lists changed.
drop function if exists public.get_coding_vscode_assignment_targets();
create function public.get_coding_vscode_assignment_targets()
returns table(
  id uuid,
  assignment_id uuid,
  batch_id uuid,
  is_unlocked boolean,
  is_permanently_released boolean,
  live_until timestamptz,
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
  if not public.is_kaveri_staff() then raise exception 'Teacher access required'; end if;
  return query
  select ab.id, ab.assignment_id, ab.batch_id, ab.is_unlocked,
         ab.is_permanently_released, ab.live_until,
         ab.unlocked_at, ab.locked_at, ab.updated_at, ab.updated_by, ab.created_at
  from public.coding_vscode_assignment_batches ab
  order by ab.created_at;
end;
$$;

drop function if exists public.get_my_coding_classroom_assignments();
create function public.get_my_coding_classroom_assignments()
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
  live_available boolean,
  batch_id uuid,
  batch_name text,
  question text,
  starter_code text,
  visible_tests jsonb,
  access_source text,
  access_until timestamptz,
  request_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select a.id as database_id, a.assignment_key, a.title, a.topic, a.language,
           a.file_name, a.marks, a.updated_at, b.id as batch_id, b.name as batch_name,
           a.question, a.starter_code, ab.is_permanently_released,
           (ab.is_unlocked = true and ab.live_until is not null and ab.live_until > now()) as live_available,
           pa.source as personal_source, (pa.id is not null) as personal_access,
           ar.status as request_status, ab.live_until,
           row_number() over (
             partition by a.id
             order by (ab.is_permanently_released or pa.id is not null) desc,
                      (ab.is_unlocked = true and ab.live_until is not null and ab.live_until > now()) desc,
                      bs.enrolled_at desc, b.name
           ) as rn
    from public.batch_students bs
    join public.batches b on b.id = bs.batch_id and b.status = 'active'
    join public.coding_vscode_assignment_batches ab on ab.batch_id = b.id
    join public.coding_vscode_assignments a on a.id = ab.assignment_id
      and a.is_published = true and a.language = 'python'
    left join public.coding_vscode_student_assignment_access pa
      on pa.student_id = auth.uid() and pa.assignment_id = a.id and pa.batch_id = b.id
    left join public.coding_vscode_access_requests ar
      on ar.student_id = auth.uid() and ar.assignment_id = a.id and ar.batch_id = b.id
    where bs.student_id = auth.uid() and bs.status = 'active'
  )
  select e.database_id, e.assignment_key, e.title, e.topic, e.language, e.file_name,
         e.marks, e.updated_at,
         (e.is_permanently_released or e.personal_access) as is_unlocked,
         e.live_available, e.batch_id, e.batch_name,
         case when (e.is_permanently_released or e.personal_access) then e.question else null end,
         case when (e.is_permanently_released or e.personal_access) then coalesce(e.starter_code, '') else null end,
         case when (e.is_permanently_released or e.personal_access) then coalesce((
           select jsonb_agg(jsonb_build_array(t.input_text, t.expected_output) order by t.position)
           from public.coding_vscode_test_cases t
           where t.assignment_id = e.database_id and t.is_hidden = false
         ), '[]'::jsonb) else '[]'::jsonb end,
         case
           when e.is_permanently_released then 'recorded_release'
           when e.personal_access then coalesce(e.personal_source, 'permanent_access')
           when e.live_available then 'live_available'
           else 'locked'
         end,
         case when e.live_available then e.live_until else null end,
         e.request_status
  from eligible e
  where e.rn = 1
  order by e.updated_at, e.title;
$$;

create or replace function public.decide_coding_access_request(
  p_request_id uuid,
  p_approve boolean,
  p_minutes integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.coding_vscode_access_requests%rowtype;
begin
  if not public.is_kaveri_staff() then raise exception 'Teacher access required'; end if;
  select * into v_request from public.coding_vscode_access_requests where id = p_request_id;
  if v_request.id is null then raise exception 'Access request not found'; end if;

  if p_approve then
    insert into public.coding_vscode_student_assignment_access (
      student_id, assignment_id, batch_id, source, granted_at, granted_by
    ) values (
      v_request.student_id, v_request.assignment_id, v_request.batch_id,
      'teacher_grant', now(), auth.uid()
    )
    on conflict (student_id, assignment_id, batch_id)
    do update set source = 'teacher_grant', granted_by = auth.uid();
  end if;

  update public.coding_vscode_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_at = now(), decided_by = auth.uid(), access_until = null, updated_at = now()
  where id = p_request_id;
end;
$$;

-- Direct student reads are allowed only after permanent entitlement or batch release.
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
    left join public.coding_vscode_student_assignment_access pa
      on pa.student_id = auth.uid() and pa.assignment_id = cab.assignment_id and pa.batch_id = cab.batch_id
    where cab.assignment_id = coding_vscode_assignments.id
      and bs.student_id = auth.uid() and bs.status = 'active' and b.status = 'active'
      and (cab.is_permanently_released = true or pa.id is not null)
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
    left join public.coding_vscode_student_assignment_access pa
      on pa.student_id = auth.uid() and pa.assignment_id = cab.assignment_id and pa.batch_id = cab.batch_id
    where a.id = coding_vscode_test_cases.assignment_id
      and a.is_published = true and bs.student_id = auth.uid() and bs.status = 'active' and b.status = 'active'
      and (cab.is_permanently_released = true or pa.id is not null)
  )
);

revoke all on function public.join_coding_live_class(uuid) from public;
revoke all on function public.release_coding_assignments_permanently(uuid, uuid[]) from public;
revoke all on function public.get_coding_vscode_assignment_targets() from public;
revoke all on function public.get_my_coding_classroom_assignments() from public;
grant execute on function public.join_coding_live_class(uuid) to authenticated;
grant execute on function public.release_coding_assignments_permanently(uuid, uuid[]) to authenticated;
grant execute on function public.get_coding_vscode_assignment_targets() to authenticated;
grant execute on function public.get_my_coding_classroom_assignments() to authenticated;
