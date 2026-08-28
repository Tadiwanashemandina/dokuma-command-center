-- Phase 1 Finance module seed data. Run once after 0012-0017 migrations
-- (via `supabase db query -f supabase/seed_finance.sql --linked`) — not
-- wired into supabase/seed.sql's automatic db-push seeding since re-running
-- would duplicate rows (same caveat already documented in the README for
-- the main seed file).

insert into public.finance_accounts (name, type, currency, opening_balance, current_balance, is_active) values
  ('Dokuma Operating Account', 'bank', 'USD', 50000, 50000, true),
  ('Dokuma Petty Cash', 'cash', 'USD', 2000, 2000, true),
  ('EcoCash Merchant', 'mobile-money', 'USD', 5000, 5000, true);

-- ~25 days of ordinary transactions on the Operating Account so the
-- unusual-transaction baseline (30-day trailing average) has real data.
insert into public.finance_transactions (account_id, date, type, amount, category, counterparty, description, is_dlap, dlap_share_pct, source)
select
  (select id from public.finance_accounts where name = 'Dokuma Operating Account'),
  current_date - n,
  case when n % 3 = 0 then 'credit' else 'debit' end,
  (400 + (n * 17) % 600)::numeric,
  case when n % 4 = 0 then 'DLAP conveyancer fees' else 'Operating expenses' end,
  case when n % 4 = 0 then 'Independent Conveyancer Network' else 'Various' end,
  'Routine transaction ' || n,
  (n % 4 = 0),
  case when n % 4 = 0 then 15.0 else null end,
  'manual'
from generate_series(1, 25) as n;

-- One deliberately oversized transaction today — well over 2x the ~$650
-- trailing average above — so the daily report's unusual-transaction flag
-- has something real to catch during verification.
insert into public.finance_transactions (account_id, date, type, amount, category, counterparty, description, source)
values (
  (select id from public.finance_accounts where name = 'Dokuma Operating Account'),
  current_date,
  'debit',
  9500,
  'Equipment purchase',
  'Regional IT Suppliers',
  'Bulk laptop purchase for the Bulawayo onboarding team',
  'manual'
);

-- A little activity on the other two accounts too, so Cash Position isn't a
-- one-account demo.
insert into public.finance_transactions (account_id, date, type, amount, category, counterparty, description, source) values
  ((select id from public.finance_accounts where name = 'Dokuma Petty Cash'), current_date - 2, 'debit', 85, 'Office supplies', 'Local vendor', 'Stationery', 'manual'),
  ((select id from public.finance_accounts where name = 'Dokuma Petty Cash'), current_date - 1, 'debit', 40, 'Transport', 'Taxi', 'Client visit transport', 'manual'),
  ((select id from public.finance_accounts where name = 'EcoCash Merchant'), current_date - 3, 'credit', 1200, 'Client payment', 'Independent Conveyancer Network', 'Mobile money receipt', 'manual'),
  ((select id from public.finance_accounts where name = 'EcoCash Merchant'), current_date - 1, 'debit', 300, 'Vendor payment', 'Local supplier', 'Mobile money payout', 'manual');

insert into public.finance_creditors (name, amount_owed, due_date, status, notes) values
  ('Regional IT Suppliers', 9500, current_date + 14, 'outstanding', 'Bulk laptop purchase, Net 30 terms.'),
  ('Harare Office Landlord', 1800, current_date + 5, 'outstanding', 'Monthly office rent.'),
  ('Zesa Holdings', 420, current_date - 3, 'partially_paid', 'Electricity — partial payment made.');

insert into public.finance_payment_notices (period, payee, amount, due_date, status, notes) values
  (to_char(current_date, 'FMMonth YYYY'), 'Regional IT Suppliers', 9500, current_date + 14, 'scheduled', null),
  (to_char(current_date, 'FMMonth YYYY'), 'Harare Office Landlord', 1800, current_date + 5, 'scheduled', null),
  (to_char(current_date, 'FMMonth YYYY'), 'Zesa Holdings', 210, current_date + 10, 'sent', 'Remaining balance after partial payment.');
