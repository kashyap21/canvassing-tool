-- ============================================================================
--  Canvassing tool — Supabase schema
--  Run this ONCE in your Supabase project: Dashboard -> SQL Editor -> New query
--  -> paste all of this -> Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The residents table (mirrors the Django Resident model)
-- ---------------------------------------------------------------------------
create table if not exists public.residents (
    id              bigint generated always as identity primary key,
    street_number   text        not null,
    street_name     text        not null,
    unit_no         text        not null default '',
    first_name      text        default '',
    last_name       text        default '',
    cell_number     text        default '',
    email           text        default '',
    supporter       text        not null default 'unknown'
                        check (supporter in ('yes', 'no', 'unknown')),
    number_of_votes integer     not null default 1 check (number_of_votes >= 0),
    lawn_sign       boolean     not null default false,
    newsletter_consent boolean  not null default false,
    comments        text        not null default '',
    created_at      timestamptz not null default now(),
    -- who saved this row (handy when 4 canvassers share one database)
    created_by      uuid        default auth.uid() references auth.users (id)
);

create index if not exists residents_street_name_idx on public.residents (street_name);
create index if not exists residents_created_at_idx  on public.residents (created_at desc);

-- Existing projects may still have these columns marked NOT NULL from an older
-- schema. Keep contact details optional at the database layer too.
alter table public.residents
    alter column first_name drop not null,
    alter column first_name set default '',
    alter column last_name drop not null,
    alter column last_name set default '',
    alter column cell_number drop not null,
    alter column cell_number set default '',
    alter column email drop not null,
    alter column email set default '';

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
--    Data is protected here, NOT by hiding the anon key. With RLS on and these
--    policies, only a SIGNED-IN user can read or write. The public anon key
--    alone can do nothing.
-- ---------------------------------------------------------------------------
alter table public.residents enable row level security;

drop policy if exists "signed-in can read"   on public.residents;
drop policy if exists "signed-in can insert" on public.residents;
drop policy if exists "signed-in can update" on public.residents;
drop policy if exists "signed-in can delete" on public.residents;

create policy "signed-in can read"   on public.residents
    for select to authenticated using (true);

create policy "signed-in can insert" on public.residents
    for insert to authenticated with check (true);

create policy "signed-in can update" on public.residents
    for update to authenticated using (true) with check (true);

create policy "signed-in can delete" on public.residents
    for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. Distinct street names (powers the "type-ahead" on the Street name field).
--    security invoker => still respects RLS, so only signed-in users can call it.
-- ---------------------------------------------------------------------------
create or replace function public.distinct_streets()
    returns table (street_name text)
    language sql
    stable
    security invoker
    set search_path = public
as $$
    select distinct street_name
    from public.residents
    where street_name <> ''
    order by street_name;
$$;

-- ---------------------------------------------------------------------------
-- 4. Header counters (total residents + total votes) in one round-trip.
-- ---------------------------------------------------------------------------
create or replace function public.resident_stats()
    returns table (total_residents bigint, total_votes bigint)
    language sql
    stable
    security invoker
    set search_path = public
as $$
    select count(*)::bigint,
           coalesce(sum(number_of_votes), 0)::bigint
    from public.residents;
$$;
