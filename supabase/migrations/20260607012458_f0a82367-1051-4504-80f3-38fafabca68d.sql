CREATE OR REPLACE FUNCTION public.spectator_list(_game text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  if _game = 'domino' then
    select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) into r
    from (
      select g.id, g.ticket_number as ticket, g.players_count, g.stake, g.created_at,
             g.round_number as round, g.score_p1, g.score_p2, g.score_p3,
             (select mvola_name from public.profiles where user_id=g.player1_id) as p1,
             (select mvola_name from public.profiles where user_id=g.player2_id) as p2,
             (select mvola_name from public.profiles where user_id=g.player3_id) as p3
      from public.games g
      where g.status = 'in_progress'
    ) t;
  elsif _game = 'ludo' then
    select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) into r
    from (
      select g.id, g.ticket_number as ticket, g.players_count, g.stake, g.created_at,
             (select mvola_name from public.profiles where user_id=g.player1_id) as p1,
             (select mvola_name from public.profiles where user_id=g.player2_id) as p2,
             (select mvola_name from public.profiles where user_id=g.player3_id) as p3,
             (select mvola_name from public.profiles where user_id=g.player4_id) as p4
      from public.ludo_games g
      where g.status = 'in_progress'
    ) t;
  elsif _game = 'petanque' then
    select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) into r
    from (
      select g.id, g.ticket_number as ticket, g.stake, g.created_at,
             g.score_p1, g.score_p2, g.round_number as round,
             (select mvola_name from public.profiles where user_id=g.player1_id) as p1,
             (select mvola_name from public.profiles where user_id=g.player2_id) as p2
      from public.petanque_games g
      where g.status = 'in_progress'
    ) t;
  else
    r := '[]'::jsonb;
  end if;
  return r;
end $function$;

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
      'turn_started_at', g.turn_started_at
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

GRANT EXECUTE ON FUNCTION public.spectator_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spectator_get(text, uuid) TO anon, authenticated;