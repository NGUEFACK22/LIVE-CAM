-- ============================================================
-- admin_set_credit : crediter / definir le solde de points d'un
-- utilisateur depuis le panneau admin LIVECAM.
--
-- SECURITY DEFINER : contourne ROW LEVEL SECURITY afin qu'un admin
-- puisse modifier le solde de N'IMPORTE quel utilisateur.
--
-- Securite :
--   - L'appelant doit etre un admin (email dans la liste admin) OU
--     le role service_role (appel serveur de confiance).
--   - Par defaut, le droit d'execution est retire a anon et authenticated :
--     seul service_role peut l'appeler (la route admin appelle avec le
--     client service_role apres avoir valide la session admin).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_credit(
  p_email text,
  p_points integer,
  p_action text -- 'add' | 'set'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_existing record;
  v_target_max integer;
  v_target_points integer;
  v_prev_active boolean;
  v_prev_points integer;
  v_prev_max integer;
  v_validity_ms bigint;
  v_base timestamptz;
  v_end timestamptz;
  v_now timestamptz := now();
  v_plan text;
  v_amount numeric;
BEGIN
  -- Garde-fou admin : autorise service_role (appel serveur) ou un email admin.
  IF (auth.role() IS DISTINCT FROM 'service_role') THEN
    IF (lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) NOT IN ('admin@chapcam.live')) THEN
      RAISE EXCEPTION 'Acces refuse';
    END IF;
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'Email invalide';
  END IF;
  IF p_points IS NULL OR p_points < 1 THEN
    RAISE EXCEPTION 'Points invalide (doit etre >= 1)';
  END IF;
  IF p_action IS DISTINCT FROM 'set' THEN
    p_action := 'add';
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT user_id INTO v_user_id
    FROM public.profiles
    WHERE lower(email) = lower(btrim(p_email))
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Aucun compte LIVECAM ne correspond a la cle';
  END IF;

  SELECT * INTO v_existing
  FROM public.subscriptions
  WHERE user_id = v_user_id
  LIMIT 1;

  v_prev_active :=
    v_existing.id IS NOT NULL AND v_existing.is_active
      AND (coalesce(v_existing.end_date, v_existing.expires_at) > v_now);
  v_prev_points := CASE WHEN v_prev_active THEN coalesce(v_existing.points, 0) ELSE 0 END;
  v_prev_max    := CASE WHEN v_prev_active THEN coalesce(v_existing.max_points, v_existing.points, 0) ELSE 0 END;

  v_target_max    := CASE WHEN p_action = 'set' THEN p_points ELSE GREATEST(v_prev_max, v_prev_points + p_points) END;
  v_target_points := CASE WHEN p_action = 'set' THEN LEAST(p_points, v_target_max) ELSE v_prev_points + p_points END;

  v_validity_ms := ceil(v_target_points::numeric / 1000) * 30 * 24 * 60 * 60 * 1000;
  v_base := CASE
    WHEN v_prev_active AND (v_existing.end_date IS NOT NULL OR v_existing.expires_at IS NOT NULL)
      THEN coalesce(v_existing.end_date, v_existing.expires_at)
    ELSE v_now
  END;
  v_end := v_base + (v_validity_ms * interval '1 millisecond');

  v_plan   := coalesce(v_existing.plan, 'manual');
  v_amount := coalesce(v_existing.amount, 0);

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET user_id = v_user_id,
        email = lower(btrim(p_email)),
        plan = v_plan,
        amount = v_amount,
        status = 'active',
        points = v_target_points,
        max_points = v_target_max,
        is_active = true,
        start_date = v_now,
        end_date = v_end,
        expires_at = v_end
    WHERE user_id = v_user_id;
  ELSE
    INSERT INTO public.subscriptions (
      user_id, email, plan, amount, status,
      points, max_points, is_active, start_date, end_date, expires_at
    ) VALUES (
      v_user_id, lower(btrim(p_email)), v_plan, v_amount, 'active',
      v_target_points, v_target_max, true, v_now, v_end, v_end
    );
  END IF;

  -- On met a jour aussi profiles (email + solde) si une ligne existe.
  UPDATE public.profiles
  SET email = lower(btrim(p_email)),
      points = v_target_points,
      max_points = v_target_max,
      plan = v_plan
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'action', p_action,
    'points', v_target_points,
    'max_points', v_target_max,
    'end_date', v_end
  );
END;
$$;

-- Retire le droit d'execution public : seul service_role (via la route admin)
-- ou un admin authentifie (valide par la route) peuvent appeler.
REVOKE ALL ON FUNCTION public.admin_set_credit(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_credit(text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_credit(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_credit(text, integer, text) TO service_role;
