-- ============================================================
-- ChapCam Numbers — stockage unifié Supabase.
--
-- Solde UNIQUE = subscriptions.points (1 point = 20 FCFA), partagé entre :
--   - les vidéos (Live Swap, 1 point = 1 seconde),
--   - l'achat de numéros virtuels (prix FCFA converti en points).
--
-- À EXÉCUTER UNE FOIS dans le SQL Editor Supabase (ou via psql) :
--   psql "$SUPABASE_DB_URL" -f supabase/numbers-unified.sql
--
-- Plus aucun DATABASE_URL / Neon requis : tout vit dans la base Supabase.
-- ============================================================

-- Activations de numéros virtuels (achats de SIM).
create table if not exists public.numbers_activations (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  provider text not null default 'five_sim',
  provider_order text not null,
  country_code text not null,
  service_slug text not null,
  service_label text not null,
  phone_e164 text not null,
  price_xof integer not null default 0,
  cost_usd numeric not null default 0,
  status text not null default 'waiting'
    check (status in ('waiting', 'received', 'cancelled', 'expired')),
  code text,
  full_sms text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz
);

create index if not exists numbers_activations_user_idx
  on public.numbers_activations (user_id, created_at desc);
create index if not exists numbers_activations_waiting_idx
  on public.numbers_activations (status, created_at asc);
create index if not exists numbers_activations_order_idx
  on public.numbers_activations (provider_order);

-- Journal des mouvements de l'utilisateur (dépôts, achats, remboursements).
create table if not exists public.numbers_wallet_tx (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null check (kind in ('deposit', 'purchase', 'refund')),
  amount_xof bigint not null,
  method text not null default 'points',
  reference text,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create index if not exists numbers_wallet_tx_user_idx
  on public.numbers_wallet_tx (user_id, created_at desc);

-- Anti double-remboursement : une seule ligne 'refund' par (user, référence).
create unique index if not exists numbers_refund_once_idx
  on public.numbers_wallet_tx (user_id, reference)
  where kind = 'refund' and reference is not null;

-- RLS : lecture réservée au propriétaire ; les écritures passent UNIQUEMENT
-- par service_role (createAdminClient), conformément au verrouillage existant.
alter table public.numbers_activations enable row level security;
alter table public.numbers_wallet_tx enable row level security;

drop policy if exists numbers_activations_select_own on public.numbers_activations;
create policy numbers_activations_select_own
  on public.numbers_activations for select
  using (auth.uid() = user_id);

drop policy if exists numbers_wallet_tx_select_own on public.numbers_wallet_tx;
create policy numbers_wallet_tx_select_own
  on public.numbers_wallet_tx for select
  using (auth.uid() = user_id);

-- RPC admin : statistiques agrégées de la plateforme Numéros (service_role).
create or replace function public.numbers_admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if (auth.role() is distinct from 'service_role') then
    raise exception 'acces refuse';
  end if;
  select jsonb_build_object(
    'users', (
      select count(distinct user_id) from (
        select user_id from public.numbers_activations
        union
        select user_id from public.numbers_wallet_tx
      ) u
    ),
    'total_balance_xof', (
      select coalesce(sum(points), 0) * 20 from public.subscriptions
    ),
    'deposits_xof', (
      select coalesce(sum(amount_xof), 0) from public.numbers_wallet_tx where kind = 'deposit'
    ),
    'spend_xof', (
      select coalesce(-sum(amount_xof), 0) from public.numbers_wallet_tx where kind = 'purchase'
    ),
    'refunds_xof', (
      select coalesce(sum(amount_xof), 0) from public.numbers_wallet_tx where kind = 'refund'
    ),
    'activations_total', (
      select count(*) from public.numbers_activations
    ),
    'activations_received', (
      select count(*) from public.numbers_activations where status = 'received'
    ),
    'activations_waiting', (
      select count(*) from public.numbers_activations where status = 'waiting'
    )
  )
  into v;
  return v;
end;
$$;

revoke all on function public.numbers_admin_stats() from public;
revoke all on function public.numbers_admin_stats() from anon;
revoke all on function public.numbers_admin_stats() from authenticated;
grant execute on function public.numbers_admin_stats() to service_role;

-- ------------------------------------------------------------
-- RPC atomiques du solde unifié (service_role uniquement).
-- ------------------------------------------------------------

-- Applique un mouvement (+/-) de points de façon ATOMIQUE : une seule
-- instruction UPDATE (aucune course CAS côté client), gestion des
-- abonnements sans ligne, refus de tout solde négatif (jamais persisté).
-- Renvoie le nouveau solde en points.
create or replace function public.numbers_adjust_points(p_user_id uuid, p_delta integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new bigint;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user unknown';
  end if;

  update public.subscriptions
     set points = coalesce(points, 0) + p_delta
   where user_id = p_user_id
  returning points into v_new;

  if v_new is null then
    -- Aucune ligne d'abonnement : un débit est impossible (solde 0).
    if p_delta < 0 then
      raise exception 'POINTS_INSUFFICIENT';
    end if;
    insert into public.subscriptions
      (id, user_id, plan, points, max_points, status, is_active, started_at)
    values
      (gen_random_uuid(), p_user_id, 'custom', p_delta, p_delta, 'active', true, now())
    returning points into v_new;
  elsif v_new < 0 then
    -- On ne persiste JAMAIS un solde négatif : retour à 0 puis échec.
    update public.subscriptions set points = 0 where user_id = p_user_id;
    raise exception 'POINTS_INSUFFICIENT';
  end if;

  return v_new;
end;
$$;

revoke all on function public.numbers_adjust_points(uuid, integer) from public;
revoke all on function public.numbers_adjust_points(uuid, integer) from anon;
revoke all on function public.numbers_adjust_points(uuid, integer) from authenticated;
grant execute on function public.numbers_adjust_points(uuid, integer) to service_role;

-- Remboursement IDEMPOTENT et ATOMIQUE : le crédit de points et le verrou
-- anti-double-remboursement s'exécutent dans la MÊME transaction (un seul
-- appel RPC = une seule transaction). Si le crédit échoue, le verrou n'est
-- pas persisté (rollback global : aucune perte). L'index unique
-- numbers_refund_once_idx (kind='refund', référence) empêche tout second
-- crédit. Renvoie true si appliqué, false si déjà remboursé.
create or replace function public.numbers_refund_once(p_user_id uuid, p_reference text, p_amount_xof bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer;
begin
  v_points := round(p_amount_xof::numeric / 20.0);
  if v_points <= 0 then
    return false;
  end if;

  begin
    insert into public.numbers_wallet_tx
      (user_id, kind, amount_xof, method, reference, status)
    values
      (p_user_id, 'refund', p_amount_xof, 'points', p_reference, 'completed');
  exception when unique_violation then
    return false; -- déjà remboursé (la tentative est rollbackée)
  end;

  perform public.numbers_adjust_points(p_user_id, v_points);
  return true;
end;
$$;

revoke all on function public.numbers_refund_once(uuid, text, bigint) from public;
revoke all on function public.numbers_refund_once(uuid, text, bigint) from anon;
revoke all on function public.numbers_refund_once(uuid, text, bigint) from authenticated;
grant execute on function public.numbers_refund_once(uuid, text, bigint) to service_role;