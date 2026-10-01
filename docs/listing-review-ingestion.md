# Listing review ingestion

Schema is owned by **qualico-platform PR #102**. This repository does not contain a migration. Do not add another SQL file here; a second version would collide with that platform migration.

The scraper probes PostgREST OpenAPI and fails the Browser_Task when any required column is missing. It does not browse, and it does not return `ok: true`, until the contract below is present.

## Tables the platform migration owns

`puzzlup_reviews` keeps identity, source, and translation columns, with a unique index on `(source, channel_id, product_key, source_review_id)`:

- `source`, `channel_id`, `product_id`, `asin`, `product_key`, `source_review_id`
- `review_title`, `review_body`, `star_rating`, `review_date`, `source_url`, `reviewer_name`, `verified_purchase`, `helpful_votes`, `country`, `scraped_at`
- `original_language`, `review_title_en`, `review_body_en`, `translated_at`, `translation_provider`, `translation_model`, `translation_version`, `translation_status`

Policy is not stored on this table. Ingestion omits `human_decision`, `human_decision_note`, and `human_decision_at` so a re-run cannot overwrite a person's decision.

`listing_review_coverage` stores one outcome per run, source, channel, product, and star 1–4. Unique key: `(run_id, source, channel_id, product_key, star_rating)`. `empty` means that star page was recognized and retrieval was exhausted. A missing row is unknown, not zero.

`puzzlup_review_policy_assessments` stores versioned assessments. Upsert conflict target: `source,channel_id,product_key,source_review_id,policy_version,model,model_version`.

Columns written:

- `status`, `categories` (`text[]`), `rationale`, `evidence_quotes` (`text[]`), `confidence`, `source_urls` (`text[]`)
- `policy_version`, `model`, `model_version`

The original evidence quote is stored as the single element of `evidence_quotes`. The same review plus the same policy version, model, and model version is upserted in place. A change to any of those three inserts another row. Human decision columns are never included in that upsert. `helpful_votes` on `puzzlup_reviews` is the production column; ingestion does not write `helpful_count`.

## Translation

English text is copied into the English columns with `translation_status = not_required`. A successful approved-provider result is written with `translation_status = translated`. Pending or failed translation omits the English and provider columns, so a previous translation remains. No provider is configured in this repo. An environment variable does not authorize a call.

## Local worker

The executor on Tim's PC does not download these scripts from GitHub. They are listed in `NEVER_DOWNLOAD_FROM_GITHUB`, and the helper modules are loaded from the same `scripts/` directory.

After the qualicoagents change is on the revision that machine uses:

1. `git pull` in `C:\Users\Tim\playwright-render-service`.
2. Confirm qualico-platform PR #102 is applied. Until then the task fails with a schema reason and does not browse.
3. Run `node scripts/register-browser-tasks.js` once. That syncs `listing-review-scrape` into `Browser_Task_Registry`.
4. Restart `node scripts/playwright-task-executor.js`. The process reads the manifest into its task map at startup. A running process keeps the old map.

Then queue `listing-review-scrape`. Optional `actions[0]` may set `channel_ids`, `asins`, and `max_pages`. The task is failed when schema readiness is false or when review, assessment, or coverage persistence fails.
