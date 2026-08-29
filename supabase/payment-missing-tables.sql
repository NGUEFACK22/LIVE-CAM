-- ChapCam — Tables manquantes pour paiement (à exécuter sur nouveau projet qmoljckzxpjospsylmkl)
-- Ce fichier crée les tables utilisées par lib/fulfillment.ts et le client de
-- paiement GeniusPay.
-- qui ne sont pas dans supabase/init.sql

-- processed_payments : idempotence des crédits (token = reference GeniusPay)
CREATE TABLE IF NOT EXISTS public.processed_payments (
  token text PRIMARY KEY,
  email text,
  product_id text,
  amount integer,
  credited boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- payment_logs : journal de tous les callbacks/status
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

-- pc_license_machines : machines liées à une licence PC
CREATE TABLE IF NOT EXISTS public.pc_license_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text REFERENCES public.pc_licenses(license_key) ON DELETE CASCADE,
  hardware_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(license_key, hardware_id)
);

-- Étendre payment_requests pour les nouveaux providers (paydunya_token, kind, etc.)
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS paydunya_token text,
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS paid_amount integer,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'paydunya',
  ADD COLUMN IF NOT EXISTS comment text;

-- Index pour les nouvelles colonnes
CREATE INDEX IF NOT EXISTS idx_payment_requests_paydunya_token ON public.payment_requests(paydunya_token);
CREATE INDEX IF NOT EXISTS idx_payment_requests_kind ON public.payment_requests(kind);

-- RLS pour les nouvelles tables (service_role bypass)
ALTER TABLE public.processed_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc_license_machines ENABLE ROW LEVEL SECURITY;

-- Aucune policy publique -> seul service_role peut lire/écrire (via API routes)

-- Vérification
SELECT 'processed_payments' as table, count(*) as rows FROM public.processed_payments
UNION ALL SELECT 'payment_logs', count(*) FROM public.payment_logs
UNION ALL SELECT 'payment_requests', count(*) FROM public.payment_requests;
