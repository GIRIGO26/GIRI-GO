-- v014 (v12.50) – sign in on the phone with a QR code shown on the PC ("Auf dem Handy anmelden")
--
-- The PC (signed in) asks the edge function device-login for a one-time code; the QR holds  https://go.ar-giri.de/#/qr/<id>/<secret>.
-- The phone scans it and shows a two-digit number; the person types that number on the PC to allow it; then the phone gets a one-time sign-in
-- token (no e-mail is sent). This table is the state of these hand-overs – only the service role (the edge function) reads and writes it.
--
--   secret_hash  SHA-256 of the secret in the QR (the secret itself is never stored)
--   status       pending → claimed (phone scanned, number shown) → approved / denied (PC) → used (phone signed in)
--                expired codes simply stay pending/claimed with expires_at in the past; replaced = a newer code of the same person
--   code         the two-digit number shown on the phone; the person types it on the PC (number matching – a phone that is not the
--                person's own cannot be allowed by a careless click, and the PC never learns the number from the server)
--   claim_hash   SHA-256 of a second secret that only the phone which scanned first holds – only that phone can pick up the sign-in
--   device       "iPhone · Safari" etc. (what the PC shows before allowing)
-- Rows are removed after 30 days by the function (they double as a small log of sign-ins by QR).

create table if not exists public.device_logins (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  secret_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'approved', 'denied', 'used', 'replaced')),
  code smallint,
  claim_hash text,
  device text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  decided_at timestamptz,
  used_at timestamptz
);
create index if not exists device_logins_user on public.device_logins (user_id, created_at desc);
alter table public.device_logins enable row level security;
revoke all on public.device_logins from public, anon, authenticated;
-- no policies on purpose: browsers never see this table, they only talk to the edge function device-login
