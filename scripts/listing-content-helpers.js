'use strict';

const REFERENCE_CHANNEL_ID = 22;
const FALLBACK_REFERENCE_CHANNEL_ID = 36;

function decodeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '-').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function normalizeForCompare(text) {
  return decodeHtml(text || '').toLowerCase().replace(/puzzlup/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function textSimilarity(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na && !nb) return 100;
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const wordsA = new Set(na.split(' ').filter(Boolean));
  const wordsB = new Set(nb.split(' ').filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return Math.round((overlap / Math.max(wordsA.size, wordsB.size)) * 100);
}

async function extractAmazonListingContent(page) {
  let title = '';
  const titleSelectors = [
    '#productTitle',
    '#title span',
    '#titleSection h1',
    '#centerCol h1',
    'h1#title',
  ];
  for (const sel of titleSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1500 })) {
        const text = (await loc.textContent()) || '';
        if (text.trim().length > 5) {
          title = decodeHtml(text.trim());
          break;
        }
      }
    } catch (e) { /* try next */ }
  }
  if (!title) {
    try {
      const og = await page.locator('meta[property="og:title"]').getAttribute('content');
      if (og) title = decodeHtml(og);
    } catch (e) { /* no og:title */ }
  }

  let bullets = [];
  try {
    const items = await page.locator('#feature-bullets ul li:not(.aok-hidden) span.a-list-item').allTextContents();
    bullets = items.map((b) => decodeHtml(b)).filter((b) => b.length > 2);
  } catch (e) { /* no bullets */ }

  let description = '';
  try {
    const parts = [];
    const prodDesc = await page.locator('#productDescription, #productDescription_feature_div').innerText({ timeout: 2000 }).catch(() => '');
    if (prodDesc) parts.push(prodDesc);
    const aplus = await page.locator('#aplus_feature_div, #aplusBrandStory_feature_div').innerText({ timeout: 2000 }).catch(() => '');
    if (aplus) parts.push(aplus);
    description = decodeHtml(parts.join('\n\n'));
  } catch (e) { /* no description */ }

  return { listing_title: title, bullet_points: bullets, description };
}

function extractBolListingContent(html, productName) {
  let title = productName;
  let description = '';
  let bullets = [];

  const ldJsonBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldJsonBlocks) {
    try {
      const jsonStr = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
      const data = JSON.parse(jsonStr);
      const items = Array.isArray(data['@graph']) ? data['@graph'] : (Array.isArray(data) ? data : [data]);
      for (const item of items) {
        if (item['@type'] === 'ProductGroup' && item.name) title = decodeHtml(item.name);
        if (item['@type'] === 'Product' && item.name) title = decodeHtml(item.name);
        if (item.description) description = decodeHtml(item.description);
        if (item.hasVariant) {
          const variants = Array.isArray(item.hasVariant) ? item.hasVariant : [item.hasVariant];
          for (const v of variants) {
            if (v.name && v.name.toLowerCase().includes(productName.toLowerCase().slice(0, 12))) {
              if (v.name) title = decodeHtml(v.name);
              if (v.description) description = decodeHtml(v.description);
            }
          }
        }
      }
    } catch (e) { /* skip block */ }
  }

  if (!description) {
    const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    if (metaDesc) description = decodeHtml(metaDesc[1]);
  }

  if (bullets.length === 0 && description) {
    bullets = description.split(/[.!?]\s+/).filter((s) => s.length > 20).slice(0, 5);
  }

  return { listing_title: title, bullet_points: bullets, description };
}

function extractWebshopListingContent(html) {
  let title = '';
  const h1 = html.match(/<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([^<]+)/i)
    || html.match(/<h1[^>]*>([^<]+)/i);
  if (h1) title = decodeHtml(h1[1]);

  let description = '';
  const descBlock = html.match(/woocommerce-product-details__short-description[^>]*>([\s\S]*?)<\/div>/i);
  if (descBlock) {
    description = decodeHtml(descBlock[1].replace(/<[^>]+>/g, ' '));
  }
  if (!description) {
    const tabContent = html.match(/id="tab-description"[^>]*>([\s\S]*?)<\/div>/i);
    if (tabContent) description = decodeHtml(tabContent[1].replace(/<[^>]+>/g, ' '));
  }

  let bullets = [];
  const liMatches = html.match(/<li[^>]*>([^<]{10,200})<\/li>/gi) || [];
  bullets = liMatches.slice(0, 8).map((li) => decodeHtml(li.replace(/<[^>]+>/g, ''))).filter(Boolean);

  return { listing_title: title, bullet_points: bullets, description };
}

function pushContentRecord(contentResults, runId, record) {
  const titleStr = record.listing_title || '';
  const bulletsArr = Array.isArray(record.bullet_points) ? record.bullet_points : [];
  const descStr = record.description || '';
  contentResults.push({
    run_id: runId,
    product_id: record.product_id,
    channel_id: record.channel_id,
    channel_name: record.channel_name,
    variant_name: record.variant_name,
    listing_title: titleStr || null,
    bullet_points: bulletsArr,
    description: descStr || null,
    title_char_count: titleStr.length,
    bullet_count: bulletsArr.length,
    description_char_count: descStr.length,
    listing_url: record.listing_url,
    asin: record.asin || null,
    scrape_source: record.scrape_source,
    last_updated: new Date().toISOString(),
  });
}

function buildContentDiscrepancies(contentResults, runId, channels) {
  const discrepancies = [];
  const byProduct = {};
  for (const row of contentResults) {
    if (!byProduct[row.product_id]) byProduct[row.product_id] = [];
    byProduct[row.product_id].push(row);
  }

  for (const rows of Object.values(byProduct)) {
    const reference = rows.find((r) => r.channel_id === REFERENCE_CHANNEL_ID)
      || rows.find((r) => r.channel_id === FALLBACK_REFERENCE_CHANNEL_ID);
    if (!reference) continue;

    const refTitle = reference.listing_title || '';
    const refBullets = reference.bullet_points || [];
    const refDesc = reference.description || '';

    for (const row of rows) {
      if (row.channel_id === reference.channel_id) continue;
      const chName = row.channel_name || channels[row.channel_id]?.name || `CH${row.channel_id}`;

      const checks = [
        { field: 'title', ref: refTitle, cmp: row.listing_title || '', issue: 'title_mismatch' },
        { field: 'bullets', ref: (refBullets || []).join(' | '), cmp: (row.bullet_points || []).join(' | '), issue: 'bullets_mismatch' },
        { field: 'description', ref: refDesc, cmp: row.description || '', issue: 'description_mismatch' },
      ];

      for (const { field, ref, cmp, issue } of checks) {
        if (!ref && !cmp) continue;
        if (!cmp) {
          discrepancies.push({
            run_id: runId,
            product_id: row.product_id,
            variant_name: row.variant_name,
            field,
            reference_channel_id: reference.channel_id,
            reference_channel_name: reference.channel_name,
            compare_channel_id: row.channel_id,
            compare_channel_name: chName,
            reference_value: ref.slice(0, 500) || null,
            compare_value: null,
            similarity_pct: 0,
            severity: 'high',
            issue_type: `missing_${field}`,
            seo_note: `Missing ${field} on ${chName} — hurts SEO indexing and ad relevance.`,
          });
          continue;
        }
        if (!ref) continue;

        const sim = textSimilarity(ref, cmp);
        if (sim < 40) {
          discrepancies.push({
            run_id: runId,
            product_id: row.product_id,
            variant_name: row.variant_name,
            field,
            reference_channel_id: reference.channel_id,
            reference_channel_name: reference.channel_name,
            compare_channel_id: row.channel_id,
            compare_channel_name: chName,
            reference_value: ref.slice(0, 500),
            compare_value: cmp.slice(0, 500),
            similarity_pct: sim,
            severity: sim < 20 ? 'high' : 'medium',
            issue_type: issue,
            seo_note: `${field} on ${chName} differs strongly from reference (${sim}% match).`,
          });
        } else if (field === 'title' && (cmp.length < 30 || cmp.length > 200)) {
          discrepancies.push({
            run_id: runId,
            product_id: row.product_id,
            variant_name: row.variant_name,
            field,
            reference_channel_id: reference.channel_id,
            reference_channel_name: reference.channel_name,
            compare_channel_id: row.channel_id,
            compare_channel_name: chName,
            reference_value: ref.slice(0, 500),
            compare_value: cmp.slice(0, 500),
            similarity_pct: sim,
            severity: 'low',
            issue_type: 'title_length',
            seo_note: `Title length ${cmp.length} chars on ${chName} — aim for 80–150 for Amazon SEO.`,
          });
        }
      }
    }
  }

  return discrepancies;
}

async function writeListingContentToSupabase(supabase, contentResults, dbLog) {
  if (contentResults.length === 0) {
    console.log('\n⚠️ No listing content to write');
    await dbLog('content-write', 'warn', '0 content records — scraper may be v1.0 or extraction failed');
    return;
  }
  console.log(`\n📝 Writing ${contentResults.length} listing content records...`);
  await dbLog('content-write', 'info', `Upserting ${contentResults.length} content records`);
  const { error } = await supabase
    .from('listing_content_puzzlup')
    .upsert(contentResults, { onConflict: 'product_id,channel_id,variant_name' });
  if (error) {
    console.log(`❌ Listing content upsert failed: ${error.message}`);
    await dbLog('content-write', 'error', error.message);
  } else {
    console.log(`✅ ${contentResults.length} listing content records upserted`);
    await dbLog('content-write', 'success', `${contentResults.length} records`);
  }
}

async function writeContentDiscrepanciesToSupabase(supabase, discrepancies, dbLog) {
  if (discrepancies.length === 0) {
    console.log('\n⚠️ No content discrepancies to write');
    return;
  }
  console.log(`\n🔍 Writing ${discrepancies.length} content discrepancies...`);
  const { error } = await supabase.from('listing_content_discrepancies').insert(discrepancies);
  if (error) {
    console.log(`❌ Discrepancies insert failed: ${error.message}`);
    await dbLog('content-disc', 'error', error.message);
  } else {
    console.log(`✅ ${discrepancies.length} discrepancies written`);
    await dbLog('content-disc', 'success', `${discrepancies.length} records`);
  }
}

module.exports = {
  REFERENCE_CHANNEL_ID,
  FALLBACK_REFERENCE_CHANNEL_ID,
  decodeHtml,
  extractAmazonListingContent,
  extractBolListingContent,
  extractWebshopListingContent,
  pushContentRecord,
  buildContentDiscrepancies,
  writeListingContentToSupabase,
  writeContentDiscrepanciesToSupabase,
};
