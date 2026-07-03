-- Add users table
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table app_users enable row level security;
create policy "public_all_users" on app_users for all using (true) with check (true);

-- Add user_id to transactions (nullable so existing data isn't broken)
alter table transactions add column if not exists user_id uuid references app_users(id) on delete set null;

-- Insert two default users (change PINs as you like)
insert into app_users (name, pin) values
  ('Het', '1234'),
  ('Vishakha', '5678');
