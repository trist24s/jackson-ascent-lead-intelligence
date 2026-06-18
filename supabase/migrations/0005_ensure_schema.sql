-- V2 completion: guarantee every column the app writes exists, regardless of which
-- earlier migrations were applied. Fully idempotent — safe to run any number of times.
-- Run this if scrapes show "Inserted: 0" with DB errors (a missing column breaks inserts).

alter table prospects add column if not exists industry text;
alter table prospects add column if not exists niche text;
alter table prospects add column if not exists phone text;
alter table prospects add column if not exists email text;
alter table prospects add column if not exists website text;
alter table prospects add column if not exists address text;
alter table prospects add column if not exists city text;
alter table prospects add column if not exists state text;
alter table prospects add column if not exists zip text;
alter table prospects add column if not exists rating numeric;
alter table prospects add column if not exists review_count int;
alter table prospects add column if not exists has_website boolean default false;
alter table prospects add column if not exists business_hours jsonb;
alter table prospects add column if not exists description text;
alter table prospects add column if not exists category text;
alter table prospects add column if not exists roofing_confidence int;
alter table prospects add column if not exists owner_name text;
alter table prospects add column if not exists linkedin_url text;
alter table prospects add column if not exists facebook_url text;
alter table prospects add column if not exists google_profile_url text;
alter table prospects add column if not exists scrape_run_id uuid;
alter table prospects add column if not exists pipeline_stage text default 'New Lead';
alter table prospects add column if not exists qualified boolean default false;
alter table prospects add column if not exists last_scored_at timestamptz;
alter table prospects add column if not exists scraped_at timestamptz default now();
alter table prospects add column if not exists created_at timestamptz default now();
alter table prospects add column if not exists updated_at timestamptz default now();

create index if not exists prospects_scrape_run_id_idx on prospects (scrape_run_id);
create index if not exists prospects_city_idx on prospects (city);

alter table scrape_runs add column if not exists industry text;
alter table scrape_runs add column if not exists updated int default 0;

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_prospect_id_idx on notes (prospect_id);
