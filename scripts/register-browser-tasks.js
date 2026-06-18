/**
 * Sync browser-automation-manifest.json → Browser_Task_Registry
 * Run: node scripts/register-browser-tasks.js
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const MANIFEST_PATH = path.join(__dirname, 'browser-automation-manifest.json');

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=representation',
};

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function toRegistryRow(entry) {
  const queue = entry.queue || {};
  return {
    task_type: entry.task_type,
    display_name: entry.title,
    description: `${entry.summary} ${entry.description}`.trim(),
    script_name: entry.script_name,
    available: entry.available !== false,
    requires_running: 'playwright-task-executor.js on Tim PC',
    example_payload: {
      agent_name: 'manual-ui',
      task_type: entry.task_type,
      url: queue.url || 'https://app.flieber.com',
      actions: queue.actions ?? [],
      credentials_key: queue.credentials_key ?? null,
      status: 'pending',
      priority: queue.priority ?? 5,
    },
  };
}

async function upsert(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Browser_Task_Registry?on_conflict=task_type`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${row.task_type}: HTTP ${res.status} ${body.substring(0, 300)}`);
  return JSON.parse(body);
}

async function disableTaskType(taskType) {
  await fetch(`${SUPABASE_URL}/rest/v1/Browser_Task_Registry?task_type=eq.${taskType}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ available: false }),
  });
}

(async () => {
  const manifest = loadManifest();
  let count = 0;

  for (const entry of manifest.automations) {
    const row = await upsert(toRegistryRow(entry));
    console.log('✅', entry.task_type, '→', row[0]?.id || 'ok');
    count++;
  }

  for (const entry of manifest.helpers.filter((h) => h.runnable && h.task_type)) {
    const row = await upsert(toRegistryRow(entry));
    console.log('✅ helper', entry.task_type, '→', row[0]?.id || 'ok');
    count++;
  }

  for (const entry of manifest.removed || []) {
    if (entry.task_type) await disableTaskType(entry.task_type);
  }
  await disableTaskType('amazon-buyer-messages');

  console.log(`\nSynced ${count} runnable automations from manifest v${manifest.version}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
