-- Close old forever-unlocked targets so coding access is live-session based.
update public.coding_vscode_assignment_batches
set is_unlocked = false,
    locked_at = now(),
    live_until = now(),
    updated_at = now()
where is_unlocked = true
  and live_until is null;

drop function if exists public.get_coding_vscode_assignment_targets();
create function public.get_coding_vscode_assignment_targets()
returns table(
  id uuid,
  assignment_id uuid,
  batch_id uuid,
  is_unlocked boolean,
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
  if not public.is_kaveri_staff() then
    raise exception 'Teacher access required';
  end if;

  return query
  select ab.id, ab.assignment_id, ab.batch_id, ab.is_unlocked, ab.live_until,
         ab.unlocked_at, ab.locked_at, ab.updated_at, ab.updated_by, ab.created_at
  from public.coding_vscode_assignment_batches ab
  order by ab.created_at;
end;
$$;

revoke all on function public.get_coding_vscode_assignment_targets() from public;
grant execute on function public.get_coding_vscode_assignment_targets() to authenticated;
