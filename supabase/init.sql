-- ============================================================
-- ChapCam — Schéma DB complet pour Supabase Local
-- Ce fichier est exécuté automatiquement au premier démarrage
-- du container PostgreSQL (docker-compose up)
-- ============================================================

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- 2. TABLES PRINCIPALES
-- ---------------------------------------------------------------------

-- Profils utilisateurs (points, plan, etc.)
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

-- Abonnements (compatibilité)
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

-- Avatars utilisateurs
CREATE TABLE IF NOT EXISTS user_avatars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  is_custom boolean DEFAULT true,
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Accès Live (fenêtres payantes + essai)
CREATE TABLE IF NOT EXISTS live_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_seconds_remaining integer DEFAULT 120,  -- 2 min essai
  pending_windows integer DEFAULT 0,
  active_window_expires_at timestamptz,
  trial_last_beat_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Transactions de swap (historique)
CREATE TABLE IF NOT EXISTS swap_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  points_used integer DEFAULT 0,
  frames_processed integer DEFAULT 0,
  processing_time_ms integer DEFAULT 0,
  status text DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  created_at timestamptz DEFAULT now()
);

-- Sessions de swap (durée, points)
CREATE TABLE IF NOT EXISTS swap_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  duration_seconds integer DEFAULT 0,
  points_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Abonnements Voice (produit distinct)
CREATE TABLE IF NOT EXISTS voice_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  seconds_remaining integer DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Activité utilisateur (tracking)
CREATE TABLE IF NOT EXISTS user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active timestamptz DEFAULT now(),
  current_page text
);

-- Demandes d'installation (app desktop)
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

-- Licences PC (ChapCam Desktop - achat unique à vie)
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

-- Liens de paiement Wave (admin editable)
CREATE TABLE IF NOT EXISTS wave_links (
  plan text PRIMARY KEY,
  label text NOT NULL,
  amount integer NOT NULL,
  wave_url text DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

-- Demandes de paiement (validation admin)
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

-- Logs admin
CREATE TABLE IF NOT EXISTS admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  payment_request_id uuid,
  admin_email text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. INDEX POUR PERFORMANCES
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 4. SEED DATA - Liens Wave (4 formules)
-- ---------------------------------------------------------------------
INSERT INTO wave_links (plan, label, amount, wave_url) VALUES
  ('starter',  'Starter',  10000, ''),
  ('standard', 'Standard', 25000, ''),
  ('premium',  'Premium',  50000, ''),
  ('ultimate', 'Ultimate', 85000, '')
ON CONFLICT (plan) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. RLS (Row Level Security) - SÉCURITÉ CÔTÉ BASE
-- ---------------------------------------------------------------------

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

-- Profils : user voit/édite le sien
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Abonnements : user voit le sien
CREATE POLICY "subscriptions_select_own" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subscriptions_insert_own" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subscriptions_update_own" ON subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- Avatars : user gère les siens
CREATE POLICY "avatars_all_own" ON user_avatars FOR ALL USING (auth.uid() = user_id);

-- Live Access : user voit le sien
CREATE POLICY "live_access_select_own" ON live_access FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "live_access_upsert_own" ON live_access FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "live_access_update_own" ON live_access FOR UPDATE USING (auth.uid() = user_id);

-- Transactions : user voit les siennes
CREATE POLICY "swap_transactions_select_own" ON swap_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "swap_transactions_insert_own" ON swap_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Sessions : user voit les siennes
CREATE POLICY "swap_sessions_select_own" ON swap_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "swap_sessions_insert_own" ON swap_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Voice : user voit le sien
CREATE POLICY "voice_subscriptions_select_own" ON voice_subscriptions FOR SELECT USING (auth.uid() = user_id);

-- Activity : user gère la sienne
CREATE POLICY "activity_all_own" ON user_activity FOR ALL USING (auth.uid() = user_id);

-- Installation requests : user voit les siennes
CREATE POLICY "install_requests_select_own" ON installation_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "install_requests_insert_own" ON installation_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- PC Licenses : user voit les siennes
CREATE POLICY "pc_licenses_select_own" ON pc_licenses FOR SELECT USING (auth.uid() = user_id);

-- Wave Links : lecture publique (pour afficher les prix)
CREATE POLICY "wave_links_public_read" ON wave_links FOR SELECT USING (true);

-- Payment requests & admin logs : AUCUNE policy publique (géré par service_role uniquement)
-- Les API utilisent la clé service_role qui bypass RLS

-- ---------------------------------------------------------------------
-- 6. TRIGGERS - Auto-création profil + timestamps
-- ---------------------------------------------------------------------

-- Auto-créer profil, subscription, live_access à l'inscription
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

-- Trigger updated_at automatique
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_avatars_updated_at BEFORE UPDATE ON user_avatars FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER live_access_updated_at BEFORE UPDATE ON live_access FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER voice_subscriptions_updated_at BEFORE UPDATE ON voice_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER installation_requests_updated_at BEFORE UPDATE ON installation_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wave_links_updated_at BEFORE UPDATE ON wave_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();