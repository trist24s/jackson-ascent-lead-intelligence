-- V2: call intelligence, descriptions, categories, notes, and updated pipeline stages.
-- Safe to run on an existing database (idempotent guards throughout).

alter table prospects add column if not exists business_hours jsonb;
alter table prospects add column if not exists description text;
alter table prospects add column if not exists category text;

-- Migrate any old stage values, then switch the allowed set to the V2 names.
alter table prospects drop constraint if exists prospects_pipeline_stage_check;
update prospects set pipeline_stage = 'Researched' where pipeline_stage = 'Researching';
update prospects set pipeline_stage = 'Won'        where pipeline_stage = 'Closed Won';
update prospects set pipeline_stage = 'Lost'       where pipeline_stage = 'Closed Lost';
alter table prospects add constraint prospects_pipeline_stage_check
  check (pipeline_stage in (
    'New Lead','Researched','Qualified','Contacted','Follow Up',
    'Interested','Discovery Call','Proposal Sent','Won','Lost'
  ));

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_prospect_id_idx on notes (prospect_id);
