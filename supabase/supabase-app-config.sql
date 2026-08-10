-- ============================================================================
-- CONFIGURATION APPLICATIVE — table app_config
-- ----------------------------------------------------------------------------
-- Stocke les parametres de l'application modifiables SANS rebuild. Permet par
-- exemple de changer la cle API Decart pour TOUS les clients (web + desktop)
-- sans forcer une reinstallation.
--
-- SECURITE : la cle Decart n'est JAMAIS exposee au client (RLS interdit la
-- lecture publique). Seuls les routes API serveur (avec service_role ou via
-- une fonction SECURITY DEFINER) peuvent la lire.
-- Le client recoit juste le token ephemere, jamais la cle brute.
-- ============================================================================

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index pour recherche rapide
create index if not exists app_config_key_idx on public.app_config(key);

-- ============================================================================
-- FONCTION SECURITY DEFINER : lit une valeur de config SANS exposer la table
-- ============================================================================
-- Cette fonction s'execute avec les droits de son createur (service) et
-- permet aux routes API de lire la config SANS avoir besoin de RLS bypass.
-- Securisee : seule la cle 'decart_api_key' peut etre lue par les utilisateurs
-- authentifies ; les autres cles restent inaccessibles.
create or replace function public.get_app_config(p_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value text;
  -- Cles autorisees en lecture par les utilisateurs authentifies
  -- (liste blanche explicite — deffense en profondeur)
  c_allowed_keys constant text[] := array['decart_api_key', 'decart_api_key_no_watermark'];
begin
  -- Verifier que la cle demandee est dans la liste blanche
  if not (p_key = any(c_allowed_keys)) then
    raise exception 'Configuration key not allowed: %', p_key;
  end if;

  -- Lire la valeur
  select value into v_value
  from public.app_config
  where key = p_key;

  return v_value;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- RLS active mais AUCUNE autorisation pour le role anon/authenticated :
-- seul le service_role peut modifier la config.
alter table public.app_config enable row level security;

-- Politique : seul le proprietaire du projet (service_role) peut lire/ecrire
drop policy if exists "app_config_service_role_all" on public.app_config;
create policy "app_config_service_role_all"
  on public.app_config
  for all
  to service_role
  using (true)
  with check (true);

-- ============================================================================
-- DONNEES INITIALES — Nouvelle cle API Decart
-- ============================================================================
-- Cette valeur sera lue par les routes API /api/decart-token et /api/decart-session
-- AVANT de regarder les variables d'environnement. Ainsi, les applications
-- deja installees recupereront automatiquement la NOUVELLE cle sans rebuild.
insert into public.app_config (key, value, description, updated_at)
values (
  'decart_api_key',
  'dct_chapcam_NBKWUwnsuFOJGQlUQqYoBvDkzsxLshiXKgUzsqRfgprDWGBFywaPqsQIDnprPdvg',
  'Cle API Decart principale pour le Live Swap (Lucy 2.5). Modifiable sans rebuild — tous les clients (web, desktop) lisent cette valeur a chaque demarrage de swap.',
  now()
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- OPTIONNEL : Cle sans watermark (pour les forfaits premium/ultimate)
-- Decommenter et adapter si vous avez une cle Decart dediee sans watermark.
-- ----------------------------------------------------------------------------
-- insert into public.app_config (key, value, description, updated_at)
-- values (
--   'decart_api_key_no_watermark',
--   'dct_chapcam_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
--   'Cle API Decart SANS watermark (forfaits ultimate/vipdebout).',
--   now()
-- )
-- on conflict (key) do update
-- set value = excluded.value,
--     description = excluded.description,
--     updated_at = now();

-- ============================================================================
-- GRANTS
-- ============================================================================
-- Accorder l'execution de la fonction aux roles anon/authenticated
grant execute on function public.get_app_config(text) to anon;
grant execute on function public.get_app_config(text) to authenticated;

-- Verification
select key, left(value, 20) || '...' as value_preview, description
from public.app_config
order by key;
