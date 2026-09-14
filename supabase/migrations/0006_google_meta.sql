-- Google enrichment + Meta ads scoring. Idempotent — run once in Supabase SQL Editor.

-- Google Maps enrichment
alter table prospects add column if not exists reviews_distribution jsonb;
alter table prospects add column if not exists images_count int;
alter table prospects add column if not exists permanently_closed boolean default false;
alter table prospects add column if not exists temporarily_closed boolean default false;
alter table prospects add column if not exists latest_review_at timestamptz;

-- Meta ads (manual 1-click scoring)
alter table prospects add column if not exists ads_score int;       -- 0-10, set by you after checking the Ad Library
alter table prospects add column if not exists ads_running boolean; -- are they actively running Meta ads?
alter table prospects add column if not exists ads_notes text;
