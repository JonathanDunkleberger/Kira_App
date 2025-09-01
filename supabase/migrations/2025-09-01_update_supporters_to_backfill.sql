-- Update RPC to rely on entitlements for Stripe customer ID and stop referencing profiles
create or replace function public.supporters_to_backfill()
returns table(user_id uuid, email text) as $$
  select u.id as user_id, u.email
  from public.entitlements e
  join auth.users u on u.id = e.user_id
  where e.plan = 'supporter' and (e.stripe_customer_id is null or length(e.stripe_customer_id) = 0);
$$ language sql stable security definer;
