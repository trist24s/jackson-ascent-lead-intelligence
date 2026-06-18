import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

// Maps one Apify Google-Places item into Prospect fields sourced from the scrape.
// IMPORTANT: this returns ONLY scrape-owned fields. It never includes
// qualified / pipeline_stage / scores, so re-scraping a known business refreshes
// its contact data without wiping the agency's CRM work.
function mapItem(item, scrapeRun) {
  return {
    place_id: item.placeId,
    name: item.title,
    industry: scrapeRun.industry || scrapeRun.niche || 'roofing',
    niche: scrapeRun.niche,
    phone: item.phone ?? '',
    email: item.emails?.[0] ?? '',
    website: item.website ?? '',
    address: item.address ?? '',
    city: item.city ?? scrapeRun.city ?? '',
    state: item.state ?? '',
    zip: item.postalCode ?? '',
    rating: typeof item.totalScore === 'number' ? item.totalScore : null,
    review_count: typeof item.reviewsCount === 'number' ? item.reviewsCount : null,
    has_website: !!item.website,
    scraped_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { scrape_run_id } = await req.json();
    if (!scrape_run_id) return Response.json({ error: 'scrape_run_id required' }, { status: 400 });

    // Load the ScrapeRun record
    const runs = await base44.entities.ScrapeRun.filter({ id: scrape_run_id });
    const scrapeRun = runs[0];
    if (!scrapeRun) return Response.json({ error: 'ScrapeRun not found' }, { status: 404 });

    // Already done — return current state
    if (scrapeRun.status === 'complete' || scrapeRun.status === 'failed') {
      return Response.json({ status: scrapeRun.status, inserted: scrapeRun.inserted, updated: scrapeRun.updated, skipped: scrapeRun.skipped, error_message: scrapeRun.error_message });
    }

    const token = Deno.env.get('APIFY_TOKEN');
    const runId = scrapeRun.run_id;

    // Poll Apify for run status
    const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    if (!runRes.ok) {
      return Response.json({ status: 'running' });
    }
    const runData = await runRes.json();
    const apifyStatus = runData?.data?.status;

    console.log('[checkAndImportRun] Apify status:', apifyStatus, 'for run:', runId);

    if (!apifyStatus || apifyStatus === 'RUNNING' || apifyStatus === 'READY') {
      return Response.json({ status: 'running' });
    }

    if (apifyStatus !== 'SUCCEEDED') {
      await base44.entities.ScrapeRun.update(scrapeRun.id, {
        status: 'failed',
        error_message: `Apify run status: ${apifyStatus}`,
        completed_at: new Date().toISOString(),
      });
      return Response.json({ status: 'failed', error_message: `Apify run status: ${apifyStatus}` });
    }

    // Fetch dataset
    const datasetId = runData?.data?.defaultDatasetId;
    const dsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&format=json`);
    if (!dsRes.ok) {
      const body = await dsRes.text();
      await base44.entities.ScrapeRun.update(scrapeRun.id, {
        status: 'failed',
        error_message: `Dataset fetch failed: ${dsRes.status} ${body.slice(0, 200)}`,
        completed_at: new Date().toISOString(),
      });
      return Response.json({ status: 'failed' });
    }

    const items = await dsRes.json();
    const capped = (Array.isArray(items) ? items : []).slice(0, scrapeRun.max_results || 50);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const item of capped) {
      if (!item.placeId || !item.title) { skipped++; continue; }
      const fields = mapItem(item, scrapeRun);
      try {
        const existing = await base44.entities.Prospect.filter({ place_id: item.placeId });
        if (existing.length > 0) {
          // Upsert: refresh scrape-sourced data, preserve CRM fields (qualified, stage, scores).
          await base44.entities.Prospect.update(existing[0].id, fields);
          updated++;
        } else {
          await base44.entities.Prospect.create({
            ...fields,
            pipeline_stage: 'New Lead',
            qualified: false,
          });
          inserted++;
        }
      } catch (e) {
        errors.push(`${item.placeId}: ${e.message}`);
      }
    }

    await base44.entities.ScrapeRun.update(scrapeRun.id, {
      status: 'complete',
      inserted,
      updated,
      skipped,
      error_message: errors.join(' | ').slice(0, 500),
      completed_at: new Date().toISOString(),
    });

    return Response.json({ status: 'complete', inserted, updated, skipped });

  } catch (err) {
    console.error('[checkAndImportRun] fatal:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
