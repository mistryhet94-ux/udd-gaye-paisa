-- Add payment method to transactions
alter table transactions add column if not exists payment_method text default 'cash' check (payment_method in ('cash', 'bank'));

-- Set existing transactions to 'cash' by default
update transactions set payment_method = 'cash' where payment_method is null;
