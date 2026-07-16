CREATE OR REPLACE FUNCTION public.spectator_get(_game text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if _game = 'domino' then
    select jsonb_build_object(
      'id', g.id, 'ticket', g.ticket_number, 'status', g.status,
      'board', g.board_state, 'current_turn', g.current_turn,
      'p1_id', g.player1_id, 'p2_id', g.player2_id, 'p3_id', g.player3_id,
      'p1_name', (select mvola_name from public.profiles where user_id=g.player1_id),
      'p2_name', (select mvola_name from public.profiles where user_id=g.player2_id),
      'p3_name', (select mvola_name from public.profiles where user_id=g.player3_id),
      'p1_count', coalesce(jsonb_array_length(g.player1_hand), 0),
      'p2_count', coalesce(jsonb_array_length(g.player2_hand), 0),
      'p3_count', coalesce(jsonb_array_length(g.player3_hand), 0),
      'boneyard_count', coalesce(jsonb_array_length(g.boneyard), 0),
      'score_p1', g.score_p1, 'score_p2', g.score_p2, 'score_p3', g.score_p3,
      'players_count', g.players_count, 'mode', g.game_mode,
      'round', g.round_number, 'last_reason', g.last_reason,
      'turn_started_at', g.turn_started_at,
      'reveal_until', g.reveal_until,
      'p1_hand', case when
        (g.reveal_until is not null and g.reveal_until > now())
        or (coalesce(g.passes,0) > 0 and g.turn_started_at is not null and g.turn_started_at > now() - interval '3 seconds')
        or (g.status = 'in_progress' and g.current_turn is null and g.last_reason is not null and position('DATINANDRO' in g.last_reason) = 0)
        then g.player1_hand else null end,
      'p2_hand', case when
        (g.reveal_until is not null and g.reveal_until > now())
        or (coalesce(g.passes,0) > 0 and g.turn_started_at is not null and g.turn_started_at > now() - interval '3 seconds')
        or (g.status = 'in_progress' and g.current_turn is null and g.last_reason is not null and position('DATINANDRO' in g.last_reason) = 0)
        then g.player2_hand else null end,
      'p3_hand', case when
        (g.reveal_until is not null and g.reveal_until > now())
        or (coalesce(g.passes,0) > 0 and g.turn_started_at is not null and g.turn_started_at > now() - interval '3 seconds')
        or (g.status = 'in_progress' and g.current_turn is null and g.last_reason is not null and position('DATINANDRO' in g.last_reason) = 0)
        then g.player3_hand else null end
    ) into r
    from public.games g where g.id = _id and g.status = 'in_progress';
  elsif _game = 'ludo' then
    select jsonb_build_object(
      'id', g.id, 'ticket', g.ticket_number, 'status', g.status,
      'pawns', g.pawns, 'current_turn_seat', g.current_turn_seat,
      'last_dice', g.last_dice, 'dice_rolled', g.dice_rolled,
      'players_count', g.players_count,
      'p1_name', (select mvola_name from public.profiles where user_id=g.player1_id),
      'p2_name', (select mvola_name from public.profiles where user_id=g.player2_id),
      'p3_name', (select mvola_name from public.profiles where user_id=g.player3_id),
      'p4_name', (select mvola_name from public.profiles where user_id=g.player4_id),
      'seat_assignment', g.seat_assignment,
      'turn_started_at', g.turn_started_at
    ) into r
    from public.ludo_games g where g.id = _id and g.status = 'in_progress';
  elsif _game = 'petanque' then
    select jsonb_build_object(
      'id', g.id, 'ticket', g.ticket_number, 'status', g.status,
      'state', g.state, 'current_turn', g.current_turn,
      'score_p1', g.score_p1, 'score_p2', g.score_p2, 'round', g.round_number,
      'p1_id', g.player1_id, 'p2_id', g.player2_id,
      'p1_name', (select mvola_name from public.profiles where user_id=g.player1_id),
      'p2_name', (select mvola_name from public.profiles where user_id=g.player2_id),
      'turn_started_at', g.turn_started_at
    ) into r
    from public.petanque_games g where g.id = _id and g.status = 'in_progress';
  else
    r := null;
  end if;
  return r;
end $function$;