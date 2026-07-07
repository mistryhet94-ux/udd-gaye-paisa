-- Make sure app_users table exists with right structure
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table app_users enable row level security;

-- Allow public read/write (PIN-based auth, no Supabase Auth)
drop policy if exists "public_all_users" on app_users;
create policy "public_all_users" on app_users for all using (true) with check (true);

-- Make sure transactions have user_id column
alter table transactions add column if not exists user_id uuid references app_users(id) on delete set null;

-- Add index for faster user queries
create index if not exists idx_transactions_user_id on transactions(user_id);
