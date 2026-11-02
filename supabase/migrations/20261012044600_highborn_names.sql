-- Highborn heroes use a (Highborn) name suffix and a highborn- slug prefix, like the awakened heroes.
update heroes set slug = 'highborn-' || slug, name = name || ' (Highborn)'
where id in (185, 199, 207, 212, 219, 226, 234, 240, 246, 253)
  and slug in ('hildwin', 'lan', 'skylan', 'haelia', 'leviathan', 'kaelon', 'elthara', 'odysseus', 'severin', 'thalassa');
