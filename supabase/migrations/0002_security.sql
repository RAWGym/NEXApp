-- Шифрование анкет KYC и подтверждение входа по коду
alter table public.users add column if not exists kyc_enc text;
alter table public.login_codes add column if not exists pin text;
alter table public.login_codes add column if not exists ip_hash text;
