-- Disposable historical replay fixture ONLY, not deployable SQL.
-- Models just enough Supabase Storage catalog tables for the historical
-- migration that inserts the product-images bucket and configures RLS.
-- This does not start or emulate a functioning Storage API.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner_id text
);
alter table storage.objects enable row level security;
