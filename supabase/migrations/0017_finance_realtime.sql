-- Tables aren't broadcast over Supabase Realtime until explicitly added to
-- the publication. This is what the Cash Position panel's client-side
-- `postgres_changes` subscription needs to receive UPDATE events at all.
alter publication supabase_realtime add table public.finance_accounts;
