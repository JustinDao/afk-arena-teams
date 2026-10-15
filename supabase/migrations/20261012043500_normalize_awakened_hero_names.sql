update heroes
set is_awakened = true
where slug like 'awakened-%'
  and not is_awakened;

update heroes
set name = regexp_replace(
  regexp_replace(name, '^Awakened\s+', '', 'i'),
  '\s+\(Awakened\)$',
  '',
  'i'
)
where is_awakened
  and (name ~* '^Awakened\s+' or name ~* '\s+\(Awakened\)$');
