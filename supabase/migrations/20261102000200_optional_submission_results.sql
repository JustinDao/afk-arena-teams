alter function public.submit_lineup_with_ascension(jsonb)
  rename to submit_lineup_with_required_results;

revoke all on function public.submit_lineup_with_required_results(jsonb) from public, anon, authenticated;

update public.game_modes as mode
set config = jsonb_set(
  mode.config,
  '{result_fields}',
  (
    select coalesce(
      jsonb_agg(
        case
          when jsonb_typeof(field.value) = 'object'
            then jsonb_set(field.value, '{required}', 'false'::jsonb, true)
          else field.value
        end
        order by field.ordinality
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(mode.config -> 'result_fields') with ordinality as field(value, ordinality)
  ),
  true
)
where jsonb_typeof(mode.config -> 'result_fields') = 'array';

create function public.submit_lineup_with_ascension(p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_payload jsonb := p_payload;
  v_result jsonb;
  v_stored_result jsonb;
  v_submission_id bigint;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Lineup submission must be an object.';
  end if;
  if p_payload ? 'result' and jsonb_typeof(p_payload -> 'result') not in ('object', 'null') then
    raise exception 'Lineup results must be an object.';
  end if;

  v_result := case
    when jsonb_typeof(p_payload -> 'result') = 'object' then p_payload -> 'result'
    else '{}'::jsonb
  end;
  v_stored_result := v_result;

  if p_payload ->> 'mode_slug' in ('twisted-realm', 'cursed-realm')
    and nullif(v_result ->> 'damage', '') is null then
    v_result := jsonb_set(v_result, '{damage}', '1'::jsonb, true);
    v_stored_result := v_stored_result - 'damage';
  elsif p_payload ->> 'mode_slug' = 'treasure-scramble'
    and nullif(v_result ->> 'placement', '') is null then
    v_result := jsonb_set(
      jsonb_set(v_result, '{placementType}', '"rank"'::jsonb, true),
      '{placement}', '1'::jsonb, true
    );
    v_stored_result := v_stored_result - 'placement' - 'placementType';
  end if;
  v_payload := jsonb_set(v_payload, '{result}', v_result, true);

  if p_payload ->> 'mode_slug' = 'nightmare-corridor'
    and jsonb_typeof(p_payload -> 'formations') = 'array' then
    v_payload := jsonb_set(
      v_payload,
      '{formations}',
      (
        coalesce(
          (
            select jsonb_agg(
              case
                when nullif(formation.value ->> 'time_seconds', '') is null
                  then jsonb_set(formation.value, '{time_seconds}', '1'::jsonb, true)
                else formation.value
              end
              order by formation.ordinality
            )
            from jsonb_array_elements(p_payload -> 'formations') with ordinality as formation(value, ordinality)
          ),
          '[]'::jsonb
        )
      ),
      true
    );
  end if;

  v_submission_id := public.submit_lineup_with_required_results(v_payload);

  update public.submissions
  set result = v_stored_result
  where id = v_submission_id;

  if p_payload ->> 'mode_slug' = 'nightmare-corridor'
    and jsonb_typeof(p_payload -> 'formations') = 'array' then
    update public.formations f
    set result_time_seconds = null
    from jsonb_array_elements(p_payload -> 'formations') with ordinality as formation(value, ordinality)
    where f.submission_id = v_submission_id
      and f.slot_order = formation.ordinality
      and nullif(formation.value ->> 'time_seconds', '') is null;
  end if;

  return v_submission_id;
end;
$$;

revoke all on function public.submit_lineup_with_ascension(jsonb) from public;
grant execute on function public.submit_lineup_with_ascension(jsonb) to authenticated;
