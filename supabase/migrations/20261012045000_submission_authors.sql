create or replace function submission_authors()
returns table (submission_id bigint, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, nullif(btrim(p.display_name), '')
  from submissions s
  join profiles p on p.id = s.author_id
  where nullif(btrim(p.display_name), '') is not null;
$$;

revoke all on function submission_authors() from public;
grant execute on function submission_authors() to anon, authenticated;
