-- ============================================================================
-- ChapCam (LIVECAM) — MIGRATION UNIQUE POUR SUPABASE CLOUD
-- ----------------------------------------------------------------------------
-- Le projet cloud qmoljckzxpjospsylmkl n'avait AUCUNE table applicative.
-- Ce script consolide, de facon IDEMPOTENTE (re-executable sans risque) :
--   1) Toutes les tables de supabase/init.sql (profiles, user_avatars,
--      subscriptions, live_access, swap_*, voice_subscriptions, user_activity,
--      installation_requests, pc_licenses, wave_links, payment_requests,
--      admin_logs) + index + RLS + triggers
--   2) app_config (supabase/supabase-app-config.sql) + get_app_config()
--   3) Tables paiement (supabase/payment-missing-tables.sql)
--   4) Bucket Storage 'avatars' + policies storage.objects (upload par l'user
--      dans son dossier <user_id>/...)
--   5) Backfill profiles/subscriptions/live_access pour les users EXISTANTS
--
-- A EXECUTER : Supabase Dashboard > SQL Editor > nouvelle requete > coller
-- TOUT ce fichier > Run. Resultat attendu : 2 lignes de verification finales.
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. TABLES PRINCIPALES
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  points integer DEFAULT 0,
  max_points integer DEFAULT 0,
  plan text DEFAULT 'free' CHECK (plan IN ('free','unlimited','1day','30days','90days','365days','starter','premium','ultimate','vipdebout')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text DEFAULT 'free' CHECK (plan IN ('free','unlimited','1day','30days','90days','365days','starter','premium','ultimate','vipdebout')),
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  points integer DEFAULT 0,
  max_points integer DEFAULT 0,
  amount integer,
  status text,
  start_date timestamptz,
  end_date timestamptz,
  email text
);

CREATE TABLE IF NOT EXISTS user_avatars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  is_custom boolean DEFAULT true,
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_seconds_remaining integer DEFAULT 120,
  pending_windows integer DEFAULT 0,
  active_window_expires_at timestamptz,
  trial_last_beat_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swap_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  points_used integer DEFAULT 0,
  frames_processed integer DEFAULT 0,
  processing_time_ms integer DEFAULT 0,
  status text DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swap_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  duration_seconds integer DEFAULT 0,
  points_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  seconds_remaining integer DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active timestamptz DEFAULT now(),
  current_page text
);

CREATE TABLE IF NOT EXISTS installation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  platform text CHECK (platform IN ('windows','mac','linux')),
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','sent')),
  download_token text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pc_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  license_key text NOT NULL UNIQUE,
  hardware_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wave_links (
  plan text PRIMARY KEY,
  label text NOT NULL,
  amount integer NOT NULL,
  wave_url text DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone_number text NOT NULL,
  plan text NOT NULL,
  amount integer NOT NULL,
  wave_transaction_reference text NOT NULL UNIQUE,
  screenshot_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  user_id uuid,
  created_at timestamptz DEFAULT now(),
  validated_at timestamptz
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  payment_request_id uuid,
  admin_email text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 3. TABLES PAIEMENT (idempotence + extension payment_requests)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.processed_payments (
  token text PRIMARY KEY,
  email text,
  product_id text,
  amount integer,
  credited boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text,
  token text,
  transaction_id text,
  email text,
  product_id text,
  amount integer,
  status text,
  credited boolean,
  credit_kind text,
  user_linked boolean,
  failure_reason text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pc_license_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text REFERENCES public.pc_licenses(license_key) ON DELETE CASCADE,
  hardware_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(license_key, hardware_id)
);

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS paydunya_token text,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS paid_amount integer,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'paydunya',
  ADD COLUMN IF NOT EXISTS comment text;

ALTER TABLE public.payment_requests
  ALTER COLUMN wave_transaction_reference DROP NOT NULL;

-- ============================================================================
-- 4. CONFIG APPLICATIVE (app_config + fonction securisee)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS app_config_key_idx ON public.app_config(key);

CREATE OR REPLACE FUNCTION public.get_app_config(p_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value text;
  c_allowed_keys CONSTANT text[] := array['decart_api_key', 'decart_api_key_no_watermark'];
BEGIN
  IF NOT (p_key = ANY(c_allowed_keys)) THEN
    RAISE EXCEPTION 'Configuration key not allowed: %', p_key;
  END IF;

  SELECT value INTO v_value
  FROM public.app_config
  WHERE key = p_key;

  RETURN v_value;
END;
$$;

ALTER TABLE public.app_config DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_config_service_role_all" ON public.app_config;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_config_service_role_all"
  ON public.app_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT EXECUTE ON FUNCTION public.get_app_config(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_config(text) TO authenticated;

INSERT INTO public.app_config (key, value, description, updated_at)
VALUES (
  'decart_api_key',
  'dct_moi_HbgQYSUpZSaSZgzIiUNHGyFCjrQyNHDVuMHBRiGlYNjLRWowKBjQQRpoCyNuvuwO',
  'Cle API Decart principale pour le Live Swap (Lucy 2.5). Modifiable sans rebuild.',
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

-- ============================================================================
-- 5. INDEX
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_avatars_user_id ON user_avatars(user_id);
CREATE INDEX IF NOT EXISTS idx_swap_transactions_user_id ON swap_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_swap_sessions_user_id ON swap_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_installation_requests_user_id ON installation_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pc_licenses_user_id ON pc_licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_pc_licenses_email ON pc_licenses(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_licenses_key ON pc_licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_payment_requests_email ON payment_requests(email);
CREATE INDEX IF NOT EXISTS idx_payment_requests_phone ON payment_requests(phone_number);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created ON payment_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_paydunya_token ON public.payment_requests(paydunya_token);
CREATE INDEX IF NOT EXISTS idx_payment_requests_kind ON public.payment_requests(kind);

-- ============================================================================
-- 6. SEED DATA - Liens de paiement
-- ============================================================================
INSERT INTO wave_links (plan, label, amount, wave_url) VALUES
  ('starter',  'Starter',  10000, ''),
  ('standard', 'Standard', 25000, ''),
  ('premium',  'Premium',  50000, ''),
  ('ultimate', 'Ultimate', 85000, '')
ON CONFLICT (plan) DO NOTHING;

-- ============================================================================
-- 7. RLS - SÉCURITÉ CÔTÉ BASE
-- ============================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE wave_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_license_machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "subscriptions_select_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON subscriptions;
CREATE POLICY "subscriptions_select_own" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subscriptions_insert_own" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subscriptions_update_own" ON subscriptions FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "avatars_all_own" ON user_avatars;
CREATE POLICY "avatars_all_own" ON user_avatars FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "live_access_select_own" ON live_access;
DROP POLICY IF EXISTS "live_access_upsert_own" ON live_access;
DROP POLICY IF EXISTS "live_access_update_own" ON live_access;
CREATE POLICY "live_access_select_own" ON live_access FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "live_access_upsert_own" ON live_access FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "live_access_update_own" ON live_access FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "swap_transactions_select_own" ON swap_transactions;
DROP POLICY IF EXISTS "swap_transactions_insert_own" ON swap_transactions;
CREATE POLICY "swap_transactions_select_own" ON swap_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "swap_transactions_insert_own" ON swap_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "swap_sessions_select_own" ON swap_sessions;
DROP POLICY IF EXISTS "swap_sessions_insert_own" ON swap_sessions;
CREATE POLICY "swap_sessions_select_own" ON swap_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "swap_sessions_insert_own" ON swap_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "voice_subscriptions_select_own" ON voice_subscriptions;
CREATE POLICY "voice_subscriptions_select_own" ON voice_subscriptions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "activity_all_own" ON user_activity;
CREATE POLICY "activity_all_own" ON user_activity FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "install_requests_select_own" ON installation_requests;
DROP POLICY IF EXISTS "install_requests_insert_own" ON installation_requests;
CREATE POLICY "install_requests_select_own" ON installation_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "install_requests_insert_own" ON installation_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "pc_licenses_select_own" ON pc_licenses;
CREATE POLICY "pc_licenses_select_own" ON pc_licenses FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "wave_links_public_read" ON wave_links;
CREATE POLICY "wave_links_public_read" ON wave_links FOR SELECT USING (true);

-- ============================================================================
-- 8. STORAGE - Bucket 'avatars' + POLICIES
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  15728640,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lecture publique des objets du bucket avatars
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- Upload/Update/Delete : chaque utilisateur dans SON dossier <user_id>/...
DROP POLICY IF EXISTS "avatars_crud_own" ON storage.objects;
CREATE POLICY "avatars_crud_own"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- 9. TRIGGERS - Auto-création profil + timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, points, max_points, plan)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url', 0, 0, 'free')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, points, max_points)
  VALUES (NEW.id, 'free', 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.live_access (user_id, trial_seconds_remaining)
  VALUES (NEW.id, 120)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
DROP TRIGGER IF EXISTS user_avatars_updated_at ON user_avatars;
DROP TRIGGER IF EXISTS live_access_updated_at ON live_access;
DROP TRIGGER IF EXISTS voice_subscriptions_updated_at ON voice_subscriptions;
DROP TRIGGER IF EXISTS installation_requests_updated_at ON installation_requests;
DROP TRIGGER IF EXISTS wave_links_updated_at ON wave_links;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_avatars_updated_at BEFORE UPDATE ON user_avatars FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER live_access_updated_at BEFORE UPDATE ON live_access FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER voice_subscriptions_updated_at BEFORE UPDATE ON voice_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER installation_requests_updated_at BEFORE UPDATE ON installation_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wave_links_updated_at BEFORE UPDATE ON wave_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 10. BACKFILL - comptes EXISTANTS (le trigger ne couvre que les nouveaux)
-- ============================================================================
INSERT INTO public.profiles (id, email, full_name, points, max_points, plan)
SELECT id, email, raw_user_meta_data->>'full_name', 0, 0, 'free'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, plan, points, max_points)
SELECT id, 'free', 0, 0
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.live_access (user_id, trial_seconds_remaining)
SELECT id, 120
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- VERIFICATION FINALE
-- ============================================================================
SELECT 'profiles'          AS "table", count(*) FROM public.profiles
UNION ALL SELECT 'user_avatars', count(*) FROM public.user_avatars
UNION ALL SELECT 'subscriptions', count(*) FROM public.subscriptions
UNION ALL SELECT 'payment_requests', count(*) FROM public.payment_requests
UNION ALL SELECT 'processed_payments', count(*) FROM public.processed_payments
UNION ALL SELECT 'payment_logs', count(*) FROM public.payment_logs
UNION ALL SELECT 'app_config', count(*) FROM public.app_config
ORDER BY 1;

SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id = 'avatars';