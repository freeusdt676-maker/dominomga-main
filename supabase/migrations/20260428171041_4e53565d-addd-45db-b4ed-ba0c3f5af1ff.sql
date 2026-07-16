UPDATE public.profiles 
SET account_status = 'pending'::account_status 
WHERE user_id IN ('b24a8af3-77a3-43d9-854e-e8e888941184', '3c316a85-268c-496c-991e-4e4c48aab51c');