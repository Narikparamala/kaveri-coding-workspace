-- Kaveri Coding v0.11 — timed live class windows + individual make-up access

alter table public.coding_vscode_assignment_batches
  add column if not exists live_until timestamptz;

create table if not exists public.coding_vscode_access_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.coding_vscode_assignments(id) on delete cascade,
  batch_id uuid not null references public.batches(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  access_until timestamptz,
  updated_at timestamptz not null default now(),
  unique(student_id, assignment_id, batch_id)
);

alter table public.coding_vscode_access_requests enable row level security;

drop policy if exists coding_access_requests_student_read_own on public.coding_vscode_access_requests;
create policy coding_access_requests_student_read_own
on public.coding_vscode_access_requests
for select to authenticated
using (student_id = auth.uid());

drop policy if exists coding_access_requests_staff_all on public.coding_vscode_access_requests;
create policy coding_access_requests_staff_all
on public.coding_vscode_access_requests
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
  if not exists (select 1 from public.batches b where b.id = p_batch_id and b.status = 'active') then raise exception 'Active batch not found'; end if;

  v_until := now() + make_interval(mins => p_minutes);

  foreach v_assignment in array p_assignment_ids loop
    if not exists (select 1 from public.coding_vscode_assignments a where a.id = v_assignment and a.is_published = true and a.language = 'python') then
      raise exception 'Published Python question not found';
    end if;

    insert into public.coding_vscode_assignment_batches (
      assignment_id, batch_id, is_unlocked, unlocked_at, locked_at, live_until, updated_at, updated_by
    ) values (
      v_assignment, p_batch_id, true, now(), null, v_until, now(), auth.uid()
    )
    on conflict (assignment_id, batch_id)
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
  where ab.batch_id = p_batch_id and ab.assignment_id = any(p_assignment_ids);
end;
$$;

create or replace function public.end_coding_live_class(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_kaveri_staff() then raise exception 'Teacher access required'; end if;
  update public.coding_vscode_assignment_batches
  set is_unlocked = false, locked_at = now(), live_until = now(), updated_at = now(), updated_by = auth.uid()
  where batch_id = p_batch_id and is_unlocked = true and (live_until is null or live_until > now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.request_coding_assignment_access(
  p_assignment_id uuid,
  p_batch_id uuid,
  p_reason text default null
)
returns table(request_id uuid, request_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student' and coalesce(p.is_active, true) = true) then
    raise exception 'Only active student accounts can request access';
  end if;
  if not exists (
    select 1 from public.batch_students bs
    join public.batches b on b.id = bs.batch_id
    join public.coding_vscode_assignment_batches ab on ab.batch_id = bs.batch_id
    where bs.student_id = auth.uid() and bs.status = 'active' and b.status = 'active'
      and bs.batch_id = p_batch_id and ab.assignment_id = p_assignment_id
  ) then raise exception 'This question is not part of your class history'; end if;

  insert into public.coding_vscode_access_requests (
    student_id, assignment_id, batch_id, status, reason, requested_at, decided_at, decided_by, access_until, updated_at
  ) values (
    auth.uid(), p_assignment_id, p_batch_id, 'pending', nullif(trim(coalesce(p_reason,'')),''), now(), null, null, null, now()
  )
  on conflict (student_id, assignment_id, batch_id)
  do update set status = 'pending', reason = excluded.reason, requested_at = now(), decided_at = null,
                decided_by = null, access_until = null, updated_at = now()
  returning id, status into v_id, v_status;

  return query select v_id, v_status;
end;
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
begin
  if not public.is_kaveri_staff() then raise exception 'Teacher access required'; end if;
  if p_approve and (p_minutes < 5 or p_minutes > 1440) then raise exception 'Temporary access must be between 5 and 1440 minutes'; end if;

  update public.coding_vscode_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_at = now(), decided_by = auth.uid(),
      access_until = case when p_approve then now() + make_interval(mins => p_minutes) else null end,
      updated_at = now()
  where id = p_request_id;
  if not found then raise exception 'Access request not found'; end if;
end;
$$;

drop function if exists public.get_my_coding_classroom_assignments();
create function public.get_my_coding_classroom_assignments()
returns table(
  database_id uuid, assignment_key text, title text, topic text, language text, file_name text,
  marks numeric, updated_at timestamptz, is_unlocked boolean, batch_id uuid, batch_name text,
  question text, starter_code text, visible_tests jsonb, access_source text, access_until timestamptz,
  request_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select a.id as database_id, a.assignment_key, a.title, a.topic, a.language, a.file_name,
           a.marks, a.updated_at, b.id as batch_id, b.name as batch_name, a.question, a.starter_code,
           ab.is_unlocked, ab.live_until, ar.status as request_status, ar.access_until as grant_until,
           (ab.is_unlocked = true and (ab.live_until is null or ab.live_until > now())) as batch_live,
           (ar.status = 'approved' and ar.access_until is not null and ar.access_until > now()) as personal_live,
           row_number() over (
             partition by a.id
             order by ((ab.is_unlocked = true and (ab.live_until is null or ab.live_until > now())) or
                       (ar.status = 'approved' and ar.access_until is not null and ar.access_until > now())) desc,
                      bs.enrolled_at desc, b.name
           ) as rn
    from public.batch_students bs
    join public.batches b on b.id = bs.batch_id and b.status = 'active'
    join public.coding_vscode_assignment_batches ab on ab.batch_id = b.id
    join public.coding_vscode_assignments a on a.id = ab.assignment_id and a.is_published = true and a.language = 'python'
    left join public.coding_vscode_access_requests ar on ar.student_id = auth.uid() and ar.assignment_id = a.id and ar.batch_id = b.id
    where bs.student_id = auth.uid() and bs.status = 'active'
  )
  select e.database_id, e.assignment_key, e.title, e.topic, e.language, e.file_name, e.marks, e.updated_at,
         (e.batch_live or e.personal_live) as is_unlocked, e.batch_id, e.batch_name,
         case when (e.batch_live or e.personal_live) then e.question else null end,
         case when (e.batch_live or e.personal_live) then coalesce(e.starter_code, '') else null end,
         case when (e.batch_live or e.personal_live) then coalesce((
           select jsonb_agg(jsonb_build_array(t.input_text, t.expected_output) order by t.position)
           from public.coding_vscode_test_cases t where t.assignment_id = e.database_id and t.is_hidden = false
         ), '[]'::jsonb) else '[]'::jsonb end,
         case when e.batch_live then 'live_class' when e.personal_live then 'temporary_access' else 'locked' end,
         case when e.batch_live then e.live_until when e.personal_live then e.grant_until else null end,
         e.request_status
  from eligible e where e.rn = 1 order by e.updated_at, e.title;
$$;

drop policy if exists vscode_assignments_student_read_published on public.coding_vscode_assignments;
create policy vscode_assignments_student_read_published
on public.coding_vscode_assignments
for select to authenticated
using (
  is_published = true and (
    exists (
      select 1 from public.coding_vscode_assignment_batches cab
      join public.batch_students bs on bs.batch_id = cab.batch_id
      join public.batches b on b.id = cab.batch_id
      where cab.assignment_id = coding_vscode_assignments.id and cab.is_unlocked = true
        and (cab.live_until is null or cab.live_until > now()) and bs.student_id = auth.uid()
        and bs.status = 'active' and b.status = 'active'
    ) or exists (
      select 1 from public.coding_vscode_access_requests ar
      join public.batch_students bs on bs.batch_id = ar.batch_id
      join public.batches b on b.id = ar.batch_id
      where ar.assignment_id = coding_vscode_assignments.id and ar.student_id = auth.uid()
        and ar.status = 'approved' and ar.access_until > now() and bs.student_id = auth.uid()
        and bs.status = 'active' and b.status = 'active'
    )
  )
);

drop policy if exists vscode_test_cases_student_visible on public.coding_vscode_test_cases;
create policy vscode_test_cases_student_visible
on public.coding_vscode_test_cases
for select to authenticated
using (
  is_hidden = false and exists (
    select 1 from public.coding_vscode_assignments a
    where a.id = coding_vscode_test_cases.assignment_id and a.is_published = true and (
      exists (
        select 1 from public.coding_vscode_assignment_batches cab
        join public.batch_students bs on bs.batch_id = cab.batch_id
        join public.batches b on b.id = cab.batch_id
        where cab.assignment_id = a.id and cab.is_unlocked = true
          and (cab.live_until is null or cab.live_until > now()) and bs.student_id = auth.uid()
          and bs.status = 'active' and b.status = 'active'
      ) or exists (
        select 1 from public.coding_vscode_access_requests ar
        join public.batch_students bs on bs.batch_id = ar.batch_id
        join public.batches b on b.id = ar.batch_id
        where ar.assignment_id = a.id and ar.student_id = auth.uid() and ar.status = 'approved'
          and ar.access_until > now() and bs.student_id = auth.uid() and bs.status = 'active' and b.status = 'active'
      )
    )
  )
);

revoke all on function public.start_coding_live_class(uuid, uuid[], integer) from public;
revoke all on function public.end_coding_live_class(uuid) from public;
revoke all on function public.request_coding_assignment_access(uuid, uuid, text) from public;
revoke all on function public.decide_coding_access_request(uuid, boolean, integer) from public;
revoke all on function public.get_my_coding_classroom_assignments() from public;

grant execute on function public.start_coding_live_class(uuid, uuid[], integer) to authenticated;
grant execute on function public.end_coding_live_class(uuid) to authenticated;
grant execute on function public.request_coding_assignment_access(uuid, uuid, text) to authenticated;
grant execute on function public.decide_coding_access_request(uuid, boolean, integer) to authenticated;
grant execute on function public.get_my_coding_classroom_assignments() to authenticated;
