CREATE OR REPLACE FUNCTION public.ludo_initial_pawns(_n int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := '[]'::jsonb; s int; i int;
BEGIN
  FOR s IN 1.._n LOOP
    FOR i IN 0..3 LOOP
      result := result || jsonb_build_array(jsonb_build_object('seat',s,'idx',i,'pos',0));
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

-- Normalize existing in-progress games (replace pos=-1 with pos=0)
UPDATE public.ludo_games
SET pawns = (
  SELECT jsonb_agg(
    CASE WHEN (elem->>'pos')::int < 0
      THEN jsonb_set(elem, '{pos}', '0'::jsonb)
      ELSE elem END
  )
  FROM jsonb_array_elements(pawns) elem
)
WHERE status = 'in_progress'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(pawns) e WHERE (e->>'pos')::int < 0
  );