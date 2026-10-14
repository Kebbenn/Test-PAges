-- Database online di Radar Nicchie (Supabase, piano gratuito).
-- Copia tutto questo testo in Supabase > SQL Editor > New query, poi premi "Run".
-- Crea la tabella delle ricerche: ogni persona vede, salva e cancella solo le proprie.

create table if not exists public.ricerche (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  creato timestamptz not null default now(),
  ricerca text not null,
  impostazioni jsonb,
  riassunto jsonb,
  video jsonb not null
);

alter table public.ricerche enable row level security;

drop policy if exists "vedo le mie ricerche" on public.ricerche;
drop policy if exists "salvo le mie ricerche" on public.ricerche;
drop policy if exists "cancello le mie ricerche" on public.ricerche;

create policy "vedo le mie ricerche" on public.ricerche
  for select using (auth.uid() = user_id);
create policy "salvo le mie ricerche" on public.ricerche
  for insert with check (auth.uid() = user_id);
create policy "cancello le mie ricerche" on public.ricerche
  for delete using (auth.uid() = user_id);

create index if not exists ricerche_utente_data on public.ricerche (user_id, creato desc);
