-- V3.1: link each prospect to the scrape run that last touched it, so the
-- dashboard can show "current search only" vs the full database. Idempotent.

alter table prospects add column if not exists scrape_run_id uuid;
create index if not exists prospects_scrape_run_id_idx on prospects (scrape_run_id);
create index if not exists prospects_city_idx on prospects (city);
