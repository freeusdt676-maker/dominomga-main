
-- Account status enum
DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('pending','active','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status public.account_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS selfie_url text,
  ADD COLUMN IF NOT EXISTS password_plain text,
  ADD COLUMN IF NOT EXISTS pin_plain text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- Storage bucket for selfies (public read so admin & profile can display)
INSERT INTO storage.buckets (id, name, public)
VALUES ('selfies','selfies', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "selfies_public_read" ON storage.objects;
CREATE POLICY "selfies_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'selfies');

DROP POLICY IF EXISTS "selfies_anyone_insert" ON storage.objects;
CREATE POLICY "selfies_anyone_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'selfies');

DROP POLICY IF EXISTS "selfies_owner_update" ON storage.objects;
CREATE POLICY "selfies_owner_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'selfies' AND auth.uid() IS NOT NULL);

-- Update handle_new_user to capture selfie + plain creds + pending status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, mvola_name, phone, birth_date, gender, selfie_url, password_plain, pin_plain, avatar_url, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'mvola_name', 'Joueur'),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    NULLIF(NEW.raw_user_meta_data->>'birth_date','')::date,
    NULLIF(NEW.raw_user_meta_data->>'gender','')::public.gender,
    NULLIF(NEW.raw_user_meta_data->>'selfie_url',''),
    NULLIF(NEW.raw_user_meta_data->>'password_plain',''),
    NULLIF(NEW.raw_user_meta_data->>'pin_plain',''),
    NULLIF(NEW.raw_user_meta_data->>'selfie_url',''),
    'pending'::public.account_status
  );
  INSERT INTO public.wallets (user_id, balance) VALUES (NEW.id, 0);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'player');
  RETURN NEW;
END;
$function$;

-- Make sure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Existing accounts: auto-activate so current users still work
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending' AND created_at < now();

-- Admin approval RPC
CREATE OR REPLACE FUNCTION public.approve_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles
    SET account_status = 'active', approved_at = now(), approved_by = auth.uid()
    WHERE user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.block_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles SET account_status = 'blocked' WHERE user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END $$;
