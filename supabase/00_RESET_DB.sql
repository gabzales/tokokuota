-- ⚠️ HANYA UNTUK PROJECT SUPABASE BARU/KOSONG (belum ada data asli). Ini MENGHAPUS SEMUA tabel dan data di schema public.
-- Gunanya: migrasi sempat jalan setengah / dijalankan dua kali sehingga error "already exists" beruntun.
-- Cara pakai: Run file ini SATU KALI, lalu Run supabase/ALL_MIGRATIONS.sql SATU KALI (jangan diulang).
-- Tidak menyentuh user di Authentication (kalau ada user lama, hapus lewat Authentication → Users).

drop trigger if exists enforce_invite_on_signup on auth.users;
drop trigger if exists on_auth_user_created on auth.users;

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
