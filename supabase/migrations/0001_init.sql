-- Jackson Ascent Lead Intelligence — initial schema
-- Run this in the Supabase SQL editor (or via the Supabase CLI).

create extension if not exists "pgcrypto";

create table if not exists scrape_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  industry text default 'roofing',
  niche text not null,
  city text not null,
  max_results int not null default 50,
  status text not null default 'pending'
    check (status in ('pending','running','complete','failed')),
  inserted int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  place_id text unique not null,
  name text not null,
  industry text default 'roofing',
  niche text,
  phone text,
  email text,
  website text,
  address text,
  city text,
  state text,
  zip text,
  rating numeric,
  review_count int,
  has_website boolean default false,
  -- Scoring + pipeline (filled by later phases)
  website_health_score int,
  agency_fit_score int,
  opportunity_score int,
  recommended_service text,
  priority_level text
    check (priority_level in ('Contact Immediately','High','Medium','Low')),
  score_reasons jsonb default '[]'::jsonb,
  pipeline_stage text default 'New Lead'
    check (pipeline_stage in ('New Lead','Researching','Qualified','Contacted','Follow Up','Interested','Discovery Call','Proposal Sent','Closed Won','Closed Lost')),
  last_scored_at timestamptz,
  scraped_at timestamptz default now(),
  qualified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists prospects_industry_idx on prospects (industry);
create index if not exists prospects_state_idx on prospects (state);
create index if not exists prospects_pipeline_stage_idx on prospects (pipeline_stage);
