
-- 1) Profiles: replace permissive public SELECT with authenticated-only
DROP POLICY IF EXISTS profiles_select_public ON public.profiles;

CREATE POLICY profiles_select_authenticated
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- Defense-in-depth: never expose plaintext credentials to anon role
REVOKE SELECT (password_plain, pin_plain) ON public.profiles FROM anon;

-- 2) Storage selfies: remove overly-permissive policies, keep path-scoped ones
DROP POLICY IF EXISTS selfies_anyone_insert ON storage.objects;
DROP POLICY IF EXISTS selfies_owner_update ON storage.objects;

-- 3) Fix mutable search_path on remaining functions
ALTER FUNCTION public.ludo_initial_pawns(integer) SET search_path TO 'public';
ALTER FUNCTION public.ludo_initial_pawns_for(jsonb) SET search_path TO 'public';
