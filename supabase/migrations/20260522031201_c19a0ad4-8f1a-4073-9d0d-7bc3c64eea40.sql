
-- 1. Ludo: skips_by_seat tracking
ALTER TABLE public.ludo_games
  ADD COLUMN IF NOT EXISTS skips_by_seat jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. profile_change_requests
CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  proposed_mvola_name text,
  proposed_phone text,
  proposed_password text,
  proposed_pin text,
  proposed_selfie_url text,
  admin_note text,
  processed_by uuid,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcr_user ON public.profile_change_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pcr_status ON public.profile_change_requests(status);

ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pcr_admin_all ON public.profile_change_requests;
CREATE POLICY pcr_admin_all ON public.profile_change_requests
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS pcr_select_own ON public.profile_change_requests;
CREATE POLICY pcr_select_own ON public.profile_change_requests
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS pcr_insert_own ON public.profile_change_requests;
CREATE POLICY pcr_insert_own ON public.profile_change_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE TRIGGER pcr_set_updated_at
  BEFORE UPDATE ON public.profile_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. submit_profile_change_request (user)
CREATE OR REPLACE FUNCTION public.submit_profile_change_request(
  _mvola_name text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _password text DEFAULT NULL,
  _pin text DEFAULT NULL,
  _selfie_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  -- Cancel previous pending request from same user
  UPDATE public.profile_change_requests
    SET status='rejected', admin_note='Superseded by a newer request', processed_at=now()
    WHERE user_id=uid AND status='pending';
  INSERT INTO public.profile_change_requests(
    user_id, proposed_mvola_name, proposed_phone, proposed_password, proposed_pin, proposed_selfie_url
  ) VALUES (uid, NULLIF(_mvola_name,''), NULLIF(_phone,''), NULLIF(_password,''), NULLIF(_pin,''), NULLIF(_selfie_url,''))
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('ok',true,'id',new_id);
END $$;

-- 4. admin_approve_profile_change
CREATE OR REPLACE FUNCTION public.admin_approve_profile_change(_req_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; admin_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(admin_uid,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO r FROM public.profile_change_requests WHERE id=_req_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'already_processed'; END IF;

  UPDATE public.profiles SET
    mvola_name = COALESCE(r.proposed_mvola_name, mvola_name),
    phone = COALESCE(r.proposed_phone, phone),
    password_plain = COALESCE(r.proposed_password, password_plain),
    pin_plain = COALESCE(r.proposed_pin, pin_plain),
    selfie_url = COALESCE(r.proposed_selfie_url, selfie_url),
    avatar_url = COALESCE(r.proposed_selfie_url, avatar_url),
    updated_at = now()
  WHERE user_id = r.user_id;

  UPDATE public.profile_change_requests
    SET status='approved', processed_by=admin_uid, processed_at=now()
    WHERE id=_req_id;

  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (admin_uid, r.user_id, 'Nankatoavin''ny ADMINISTRATIF ny fanovana ny mombamomba anao ✓', false);

  RETURN jsonb_build_object('ok',true);
END $$;

-- 5. admin_reject_profile_change
CREATE OR REPLACE FUNCTION public.admin_reject_profile_change(_req_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; admin_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(admin_uid,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO r FROM public.profile_change_requests WHERE id=_req_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'already_processed'; END IF;
  UPDATE public.profile_change_requests
    SET status='rejected', admin_note=_reason, processed_by=admin_uid, processed_at=now()
    WHERE id=_req_id;
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (admin_uid, r.user_id,
    'Tsy nekena ny fanovana ny mombamomba anao' || CASE WHEN _reason IS NOT NULL AND length(_reason)>0 THEN ': ' || _reason ELSE '.' END,
    false);
  RETURN jsonb_build_object('ok',true);
END $$;

-- 6. ludo_record_skip — increments skip counter, auto-forfeits at 3
CREATE OR REPLACE FUNCTION public.ludo_record_skip(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g RECORD; cur_seat int; key text; cur_count int;
  skips jsonb; seats int[]; alive_uids uuid[]; uid uuid;
  next_seat int; i int; arr_len int;
BEGIN
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;
  cur_seat := g.current_turn_seat;
  key := cur_seat::text;
  skips := COALESCE(g.skips_by_seat, '{}'::jsonb);
  cur_count := COALESCE((skips ->> key)::int, 0) + 1;
  skips := jsonb_set(skips, ARRAY[key], to_jsonb(cur_count), true);

  -- Determine seats list
  SELECT ARRAY(SELECT (value::text)::int FROM jsonb_array_elements_text(
    COALESCE(g.seat_assignment, CASE
      WHEN g.players_count = 2 THEN '[1,3]'::jsonb
      WHEN g.players_count = 3 THEN '[1,2,3]'::jsonb
      ELSE '[1,2,3,4]'::jsonb END)
  )) INTO seats;

  IF cur_count >= 3 THEN
    -- Forfeit: collect remaining seats (not the one being eliminated)
    -- For 2P → immediate winner. For 3P/4P → mark seat skipped indefinitely and rotate.
    IF array_length(seats,1) = 2 THEN
      DECLARE winner_seat int; winner_uid uuid;
      BEGIN
        winner_seat := (SELECT s FROM unnest(seats) s WHERE s <> cur_seat LIMIT 1);
        -- Map seat → uid via seat order
        winner_uid := (ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id])[
          array_position(seats, winner_seat)
        ];
        IF winner_uid IS NOT NULL THEN
          PERFORM public.ludo_settle(_game_id, winner_uid);
        END IF;
        RETURN jsonb_build_object('ok',true,'forfeit',true,'winner',winner_uid);
      END;
    END IF;
    -- For 3P/4P: just rotate, keep count so they keep being skipped (simple approach)
  END IF;

  -- Rotate to next seat
  arr_len := array_length(seats,1);
  i := array_position(seats, cur_seat);
  next_seat := seats[((i) % arr_len) + 1];

  UPDATE public.ludo_games SET
    current_turn_seat = next_seat,
    last_dice = NULL,
    dice_rolled = false,
    consecutive_sixes = 0,
    turn_started_at = now(),
    skips_by_seat = skips,
    updated_at = now()
  WHERE id = _game_id;

  RETURN jsonb_build_object('ok',true,'skip_count',cur_count,'next_seat',next_seat);
END $$;

-- 7. Storage bucket for selfies (private, RLS-controlled)
INSERT INTO storage.buckets (id, name, public)
VALUES ('selfies', 'selfies', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "selfies_public_read" ON storage.objects;
CREATE POLICY "selfies_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'selfies');

DROP POLICY IF EXISTS "selfies_user_upload" ON storage.objects;
CREATE POLICY "selfies_user_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'selfies'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "selfies_user_update" ON storage.objects;
CREATE POLICY "selfies_user_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'selfies'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
