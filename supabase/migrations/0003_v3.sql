-- V3: roofing qualification confidence + owner/profile research fields.
-- Safe / idempotent on an existing database.

alter table prospects add column if not exists roofing_confidence int;
alter table prospects add column if not exists owner_name text;
alter table prospects add column if not exists linkedin_url text;
alter table prospects add column if not exists facebook_url text;
alter table prospects add column if not exists google_profile_url text;
