-- ============================================================
-- ChapCam — Corrige les contraintes CHECK qui bloquent le
-- crédit automatique après paiement GeniusPay.
--
-- 1) subscriptions.plan n'acceptait PAS 'custom' :
--    la RPC numbers_adjust_points (qui crédite une recharge lors
--    de la PREMIÈRE recharge d'un utilisateur sans ligne
--    subscriptions), insérait plan='custom' → CHECK violation →
--    "solde inaccessible" → paiement reçu, jamais crédité.
-- 2) payment_requests.status n'acceptait PAS 'cancelled' :
--    la réconciliation (cron) ne pouvait pas marquer les paiements
--    annulés/abandonnés (échec silencieux, re-vérification sans fin).
--
-- À exécuter dans le SQL Editor Supabase (PROD et preview).
-- Idempotent (re-exécutable sans risque).
-- ============================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free','unlimited','1day','30days','90days','365days','starter','standard','premium','ultimate','vipdebout','custom'));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free','unlimited','1day','30days','90days','365days','starter','standard','premium','ultimate','vipdebout','custom'));

ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_status_check
  CHECK (status IN ('pending','approved','rejected','cancelled'));

-- Vérification rapide
SELECT
  (SELECT count(*) FROM public.subscriptions WHERE plan = 'custom') AS subscriptions_custom,
  (SELECT count(*) FROM public.profiles WHERE plan = 'custom') AS profiles_custom,
  (SELECT count(*) FROM public.payment_requests WHERE status = 'cancelled') AS requests_cancelled;