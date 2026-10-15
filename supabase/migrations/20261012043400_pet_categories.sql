alter table pets add column pet_type text;

update pets
set pet_type = case
  when id between 6001 and 6003 then 'basic'
  when id between 6004 and 6026 then 'standard'
  when id between 6027 and 6030 then 'awakened'
end
where id between 6001 and 6030;

do $$
declare
  v_unclassified_ids text;
begin
  select string_agg(id::text, ', ' order by id)
  into v_unclassified_ids
  from pets
  where pet_type is null;

  if v_unclassified_ids is not null then
    raise exception 'Cannot classify pets with IDs: %.', v_unclassified_ids
      using hint = 'Add explicit pet_type mappings for these IDs to this migration, then rerun it.';
  end if;
end $$;

alter table pets
  alter column pet_type set not null,
  add constraint pets_pet_type_check check (pet_type in ('basic', 'standard', 'awakened')),
  drop column is_awakened;
