// ============================================================
// Research Hub v4 — API layer (bridge-based)
// Uses window.tasklet.invokeTool() for all calls
// ============================================================

import type { SourceId, ResultItem } from '../types';

// --- Parse execute_sql result (extracts JSON array from result string) ---
function parseSqlResult(res: unknown): Array<Record<string, unknown>> {
  try {
    if (Array.isArray(res)) return res;
    const data = res as Record<string, unknown>;
    if (data?.rows && Array.isArray(data.rows)) return data.rows;
    const resultStr = (data?.result || '') as string;
    if (!resultStr) return [];
    // Extract JSON array from the result string (between [ and ])
    const match = resultStr.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  } catch { return []; }
}

// --- HTML entity decoder ---
function decodeHtml(html: string): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

// --- Keyword extraction for internal tools ---
const STOP_WORDS = new Set([
  'de','het','een','van','in','op','aan','met','voor','naar','door','uit',
  'en','of','maar','als','dan','nog','wel','niet','geen','wat','wie','waar',
  'wanneer','hoe','is','zijn','was','waren','wordt','werden','heeft','hebben',
  'had','hadden','kan','kunnen','kon','mag','mogen','moet','moeten','zal',
  'zou','wil','willen','doe','doen','ga','gaan','kom','komen','al','ook',
  'er','hier','daar','dit','dat','deze','die','ons','onze','ik','je','we',
  'wij','zij','hun','mijn','jouw','the','a','an','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would',
  'could','should','may','might','can','to','of','in','for','on','with',
  'at','by','from','about','into','through','during','before','after','i',
  'you','he','she','it','we','they','my','your','his','her','its','our',
  'their','this','that','these','those','what','which','who','where','when',
  'how','all','each','every','both','few','more','most','other','some','such',
  'no','not','only','own','same','so','than','too','very','just','because',
  'but','and','or','if','then','else','up','out','off','over','under',
  'again','further','once','already','toegang','tot','via','hebben','heb'
]);

function extractKeywords(query: string): string {
  const words = query.toLowerCase().replace(/[?!.,;:'"()]/g, '').split(/\s+/);
  const keywords = words.filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return keywords.length > 0 ? keywords.slice(0, 5).join(' ') : query;
}

// Helper to call tools via bridge
async function callTool(toolName: string, connectionId: string, args: Record<string, unknown>): Promise<unknown> {
  return window.tasklet.invokeTool({ toolName, connectionId, args });
}

async function callHttpTool(connectionId: string, method: string, url: string, headers: Record<string, string>, body: unknown, timeout?: number): Promise<Record<string, unknown>> {
  // Content-Type is auto-added and blocked in extraHeaders — strip it
  const cleanHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'content-type') cleanHeaders[k] = v;
  }
  const args: Record<string, unknown> = {
    method,
    url,
    body: JSON.stringify(body)
  };
  if (Object.keys(cleanHeaders).length > 0) args.extraHeaders = cleanHeaders;
  if (timeout) args.timeout = timeout;
  const res = await callTool('remote_http_call', connectionId, args);
  return (res as Record<string, unknown>) || {};
}

// ============================================================
// EXTERNAL SOURCES
// ============================================================

async function fetchPerplexityModel(query: string, model: 'sonar' | 'sonar-pro' | 'sonar-deep-research'): Promise<ResultItem[]> {
  const timeout = model === 'sonar-deep-research' ? 300 : model === 'sonar-pro' ? 180 : 30;
  const res = await callHttpTool('conn_j0wpcjv8ce3v6cxx29ps', 'POST',
    'https://api.perplexity.ai/chat/completions',
    { 'Content-Type': 'application/json' },
    { model, messages: [{ role: 'user', content: query }] },
    timeout
  );
  const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
  const choices = (body?.choices || (res as Record<string, unknown>).choices) as Array<Record<string, unknown>> | undefined;
  const answer = (choices?.[0]?.message as Record<string, unknown>)?.content as string || '';
  const citations = ((body?.citations || (res as Record<string, unknown>).citations) as string[]) || [];
  if (!answer) return [];
  const items: ResultItem[] = [{ title: 'Antwoord', content: answer, type: 'answer', citations: citations.length > 0 ? citations : undefined }];
  if (citations.length > 0) {
    const sourceList = citations.map((url, i) => `${i + 1}. ${url}`).join('\n');
    items.push({ title: 'Bronnen', content: sourceList, type: 'source-list' });
  }
  return items;
}

export async function fetchPerplexityFast(query: string): Promise<ResultItem[]> {
  return fetchPerplexityModel(query, 'sonar');
}

export async function fetchPerplexityDeep(query: string): Promise<ResultItem[]> {
  return fetchPerplexityModel(query, 'sonar-pro');
}

export async function fetchPerplexityResearch(query: string): Promise<ResultItem[]> {
  return fetchPerplexityModel(query, 'sonar-deep-research');
}

export async function fetchGeminiDeep(query: string): Promise<ResultItem[]> {
  const res = await callHttpTool('conn_8mf96sd17a4ve49fmtp2', 'POST',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {},
    {
      contents: [{ parts: [{ text: `Je bent een gespecialiseerde research analist. Beantwoord de volgende vraag uitgebreid en diepgaand, met meerdere perspectieven, concrete voorbeelden, statistieken, en een samenvatting van de belangrijkste inzichten. Gebruik max 800 woorden:\n\n${query}` }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.2 }
    },
    120
  );
  const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
  const candidates = (body?.candidates || (res as Record<string, unknown>).candidates) as Array<Record<string, unknown>> | undefined;
  const candidate = candidates?.[0] as Record<string, unknown> | undefined;
  const content = (candidate?.content as Record<string, unknown>);
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  const answer = (parts?.[0]?.text as string) || '';
  const groundingMetadata = candidate?.groundingMetadata as Record<string, unknown> | undefined;
  const groundingChunks = (groundingMetadata?.groundingChunks || []) as Array<Record<string, unknown>>;
  const sources = groundingChunks
    .map((c) => {
      const web = c.web as Record<string, unknown> | undefined;
      return web ? { title: (web.title as string) || '', url: (web.uri as string) || '' } : null;
    })
    .filter(Boolean) as Array<{ title: string; url: string }>;
  if (!answer) return [];
  const results: ResultItem[] = [{ title: 'Gemini Deep Research (Google Search)', content: answer.substring(0, 2000), type: 'answer' }];
  for (const src of sources.slice(0, 6)) {
    if (src.url) results.push({ title: src.title || src.url, content: '', url: src.url });
  }
  return results;
}

export async function fetchFirecrawl(query: string): Promise<ResultItem[]> {
  const res = await callHttpTool('conn_7cnwyw7q4ykqfdb54z0x', 'POST',
    'https://api.firecrawl.dev/v1/search',
    { 'Content-Type': 'application/json' },
    { query, limit: 5 }
  );
  const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
  const data = (body?.data || (res as Record<string, unknown>).data) as Array<Record<string, unknown>> || [];
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.map((item) => ({
    title: (item.title || 'Web result') as string,
    content: ((item.description || (item.markdown as string)?.substring(0, 150) || '') as string).replace(/\s+/g, ' ').substring(0, 150),
    url: item.url as string
  }));
}

export async function fetchGemini(query: string): Promise<ResultItem[]> {
  const res = await callHttpTool('conn_8mf96sd17a4ve49fmtp2', 'POST',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    {},
    {
      contents: [{ parts: [{ text: `Beantwoord bondig in max 300 woorden, gebruik concrete namen, adressen en Google Maps links waar relevant: ${query}` }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { maxOutputTokens: 800 }
    }
  );
  const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
  const candidates = (body?.candidates || (res as Record<string, unknown>).candidates) as Array<Record<string, unknown>> | undefined;
  const candidate = candidates?.[0] as Record<string, unknown> | undefined;
  const content = (candidate?.content as Record<string, unknown>);
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  const answer = (parts?.[0]?.text as string) || '';
  // Extract grounding sources if available
  const groundingMetadata = candidate?.groundingMetadata as Record<string, unknown> | undefined;
  const groundingChunks = (groundingMetadata?.groundingChunks || []) as Array<Record<string, unknown>>;
  const sources = groundingChunks
    .map((c) => {
      const web = c.web as Record<string, unknown> | undefined;
      return web ? { title: (web.title as string) || '', url: (web.uri as string) || '' } : null;
    })
    .filter(Boolean) as Array<{ title: string; url: string }>;
  if (!answer) return [];
  const results: ResultItem[] = [{ title: 'Gemini Antwoord (Google Search)', content: answer.substring(0, 1200), type: 'answer' }];
  // Add grounding sources as separate items
  for (const src of sources.slice(0, 4)) {
    if (src.url) results.push({ title: src.title || src.url, content: '', url: src.url });
  }
  return results;
}

export async function fetchClaude(query: string): Promise<ResultItem[]> {
  try {
    const res = await callHttpTool('conn_zbr9g639g6g466mmde8k', 'POST',
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': 'process.env.CLAUDE_API_KEY', 'anthropic-version': '2023-06-01' },
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: `Beantwoord bondig in max 200 woorden: ${query}` }]
      }
    );
    const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
    const content = (body?.content || []) as Array<Record<string, unknown>>;
    const answer = (content[0]?.text as string) || '';
    if (!answer) return [];
    return [{ title: 'Claude Antwoord', content: answer.substring(0, 800), type: 'answer' }];
  } catch (e) {
    console.error('Claude error:', e);
    return [];
  }
}

export async function fetchExa(query: string): Promise<ResultItem[]> {
  const res = await window.tasklet.invokeTool({
    toolName: 'remote_http_call',
    connectionId: 'conn_mn2jr6h8am06yhamtgxh',
    args: {
      method: 'POST',
      url: 'https://api.exa.ai/search',
      body: JSON.stringify({ query, numResults: 5, useAutoprompt: true, type: 'neural', contents: { text: { maxCharacters: 2000 } } })
    }
  }) as Record<string, unknown>;
  const body = (res.body || res) as Record<string, unknown>;
  const results = (body.results || []) as Array<Record<string, unknown>>;
  if (!Array.isArray(results) || results.length === 0) return [];
  return results.map((item) => {
    const raw = decodeHtml(((item.text || item.snippet || item.highlight || '') as string).replace(/\s+/g, ' ').trim());
    const domain = item.url ? new URL(item.url as string).hostname.replace('www.', '') : '';
    return {
      title: (item.title || domain || 'Exa result') as string,
      content: raw.substring(0, 800) + (raw.length > 800 ? '…' : ''),
      url: item.url as string
    };
  });
}

export async function fetchTavily(query: string): Promise<ResultItem[]> {
  const res = await window.tasklet.invokeTool({
    toolName: 'remote_http_call',
    connectionId: 'conn_sz4v59nwy6b2kfp81agh',
    args: {
      method: 'POST',
      url: 'https://api.tavily.com/search',
      body: JSON.stringify({ query, max_results: 5, include_answer: true })
    }
  }) as Record<string, unknown>;
  const body = (res.body || res) as Record<string, unknown>;
  const items: ResultItem[] = [];
  const answer = body.answer as string | undefined;
  if (answer) items.push({ title: 'Samenvatting', content: answer.substring(0, 300), type: 'answer' });
  const results = (body.results || []) as Array<Record<string, unknown>>;
  if (Array.isArray(results)) {
    results.forEach((item) => {
      const raw = decodeHtml(((item.content || item.snippet || '') as string).replace(/\s+/g, ' ').trim());
      items.push({
        title: (item.title || 'Web result') as string,
        content: raw.substring(0, 150) + (raw.length > 150 ? '…' : ''),
        url: item.url as string
      });
    });
  }
  return items;
}


export async function fetchApollo(query: string): Promise<ResultItem[]> {
  const items: ResultItem[] = [];
  // Search organizations
  try {
    const orgRes = await window.tasklet.invokeTool({
      toolName: 'apollo_io-organization-search',
      connectionId: 'conn_dc078ynk6c45wc65sj64',
      args: { organizationName: query }
    }) as Record<string, unknown>;
    const orgs = (orgRes.organizations || orgRes.accounts || []) as Array<Record<string, unknown>>;
    if (Array.isArray(orgs)) {
      orgs.slice(0, 5).forEach((org) => {
        const name = (org.name || 'Unknown') as string;
        const domain = (org.primary_domain || org.website_url || '') as string;
        const industry = (org.industry || '') as string;
        const employees = (org.estimated_num_employees || '') as string;
        const desc = [industry, employees ? `~${employees} employees` : '', domain].filter(Boolean).join(' · ');
        items.push({ title: name, content: desc || 'Company found in Apollo', url: domain ? `https://${domain}` : undefined });
      });
    }
  } catch { /* skip org search errors */ }
  // Search people
  try {
    const pplRes = await window.tasklet.invokeTool({
      toolName: 'apollo_io-people-search',
      connectionId: 'conn_dc078ynk6c45wc65sj64',
      args: { personTitles: [query] }
    }) as Record<string, unknown>;
    const people = (pplRes.people || pplRes.contacts || []) as Array<Record<string, unknown>>;
    if (Array.isArray(people)) {
      people.slice(0, 5).forEach((p) => {
        const name = ((p.first_name || '') as string + ' ' + (p.last_name || '') as string).trim();
        const title = (p.title || '') as string;
        const org = (p.organization_name || '') as string;
        items.push({ title: name || 'Contact', content: [title, org].filter(Boolean).join(' @ ') });
      });
    }
  } catch { /* skip people search errors */ }
  return items;
}

export async function fetchHunter(query: string): Promise<ResultItem[]> {
  // Hunter.io — domain search (credits may be exhausted)
  const domain = query.includes('.') ? query : `${query.toLowerCase().replace(/\s+/g, '')}.com`;
  try {
    const res = await window.tasklet.invokeTool({
      toolName: 'remote_http_call',
      connectionId: 'conn_mb1r3qd7cqhnf7qj32db',
      args: {
        method: 'GET',
        url: `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5`
      }
    }) as Record<string, unknown>;
    const body = (res.body || res) as Record<string, unknown>;
    const data = (body.data || {}) as Record<string, unknown>;
    const emails = (data.emails || []) as Array<Record<string, unknown>>;
    if (!Array.isArray(emails) || emails.length === 0) {
      return [{ title: `Hunter: ${domain}`, content: '⚠️ Geen emails gevonden (credits mogelijk op tot 10 juni 2026)' }];
    }
    return emails.map((e) => ({
      title: ((e.first_name || '') as string + ' ' + (e.last_name || '') as string).trim() || (e.value as string),
      content: `${e.value} · ${e.type || 'unknown'} · confidence: ${e.confidence || '?'}%`,
      url: `mailto:${e.value}`
    }));
  } catch {
    return [{ title: `Hunter: ${domain}`, content: '⚠️ Credits uitgeput tot 10 juni 2026' }];
  }
}

// ============================================================
// INTERNAL SOURCES
// ============================================================

export async function fetchGmailCompany(query: string): Promise<ResultItem[]> {
  try {
    const res = await callTool('gmail_search_threads', 'conn_rqbhxnbt4b242v34h9hh', { query: query, maxResults: 5, readMask: ['date','participants','subject','bodySnippet'] });
    const data = res as Record<string, unknown>;
    const threads = (data?.threads || res) as Array<Record<string, unknown>>;
    if (!Array.isArray(threads) || threads.length === 0) return [];
    return threads.slice(0, 5).map((t) => {
      const msgs = t.messages as Array<Record<string, unknown>> | undefined;
      const msg = msgs?.[0] || {};
      const subject = (msg.subject || t.subject || 'No subject') as string;
      const from = (msg.from || t.from || '') as string;
      const rawDate = (msg.date || msg.internalDate || t.date || '') as string;
      const snippet = (msg.bodySnippet || msg.snippet || t.snippet || '') as string;
      const threadId = (t.threadId || t.id || '') as string;
      // Clean date
      let dateStr = '';
      if (rawDate) {
        try { dateStr = new Date(rawDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { dateStr = rawDate.substring(0, 16); }
      }
      return {
        title: decodeHtml(subject),
        content: decodeHtml(snippet).substring(0, 120),
        url: threadId ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : undefined,
        date: dateStr ? `${decodeHtml(from).split('<')[0].trim()} · ${dateStr}` : decodeHtml(from).split('<')[0].trim(),
        type: 'email' as const
      };
    });
  } catch { return []; }
}

export async function fetchGmailPersonal(query: string): Promise<ResultItem[]> {
  try {
    const res = await callTool('gmail_search_threads', 'conn_s2eddrsyrmg8hkhe3qsg', { query: query, maxResults: 5, readMask: ['date','participants','subject','bodySnippet'] });
    const data = res as Record<string, unknown>;
    const threads = (data?.threads || res) as Array<Record<string, unknown>>;
    if (!Array.isArray(threads) || threads.length === 0) return [];
    return threads.slice(0, 5).map((t) => {
      const msgs = t.messages as Array<Record<string, unknown>> | undefined;
      const msg = msgs?.[0] || {};
      const subject = (msg.subject || t.subject || 'No subject') as string;
      const from = (msg.from || t.from || '') as string;
      const rawDate = (msg.date || msg.internalDate || t.date || '') as string;
      const snippet = (msg.bodySnippet || msg.snippet || t.snippet || '') as string;
      const threadId = (t.threadId || t.id || '') as string;
      let dateStr = '';
      if (rawDate) {
        try { dateStr = new Date(rawDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { dateStr = rawDate.substring(0, 16); }
      }
      return {
        title: decodeHtml(subject),
        content: decodeHtml(snippet).substring(0, 120),
        url: threadId ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : undefined,
        date: dateStr ? `${decodeHtml(from).split('<')[0].trim()} · ${dateStr}` : decodeHtml(from).split('<')[0].trim(),
        type: 'email' as const
      };
    });
  } catch { return []; }
}

export async function fetchSlack(query: string): Promise<ResultItem[]> {
  try {
    const res = await callTool('slack_search_messages', 'conn_4syh5zxa3g8xm552sp6r', { query: query, count: 5 });
    const data = res as Record<string, unknown>;
    const messages = data?.messages as Record<string, unknown> | undefined;
    const matches = (messages?.matches || data?.matches || res) as Array<Record<string, unknown>>;
    if (!Array.isArray(matches) || matches.length === 0) return [];
    return matches.slice(0, 5).map((m) => {
      const channel = m.channel as Record<string, unknown> | undefined;
      return {
        title: `#${channel?.name || 'channel'} — ${m.username || 'unknown'}`,
        content: (m.text || '') as string,
        url: m.permalink as string
      };
    });
  } catch { return []; }
}

export async function fetchDrive(query: string): Promise<ResultItem[]> {
  try {
    // Drive API requires query syntax: fullText contains 'term'
    // Escape single quotes in the query string
    const escaped = query.replace(/'/g, "\\'");
    const driveQuery = `fullText contains '${escaped}'`;
    const res = await callTool('google_drive_search_documents', 'conn_zhj70cc89xscszt6ktwj', {
      query: driveQuery,
      corpora: 'allDrives',
      limit: 8
    });
    const data = res as Record<string, unknown>;
    const files = (data?.files || res) as Array<Record<string, unknown>>;
    if (!Array.isArray(files) || files.length === 0) return [];
    return files.slice(0, 8).map((f) => {
      const name = (f.name || f.title || 'Untitled') as string;
      const mime = (f.mimeType || '') as string;
      const lastMod = (f.lastModified || f.modifiedTime || '') as string;
      const modBy = (f.lastModifiedBy || '') as string;
      const mimeLabel = mime.includes('spreadsheet') ? '📊 Spreadsheet' :
                        mime.includes('document') ? '📝 Document' :
                        mime.includes('presentation') ? '📽️ Presentatie' :
                        mime.includes('pdf') ? '📄 PDF' :
                        mime.includes('folder') ? '📁 Map' :
                        mime.includes('image') ? '🖼️ Afbeelding' : '📎 Bestand';
      let dateStr = '';
      if (lastMod) {
        try { dateStr = new Date(lastMod).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { dateStr = ''; }
      }
      const parts = [mimeLabel, modBy, dateStr].filter(Boolean);
      return {
        title: name,
        content: parts.join(' · '),
        url: (f.link || f.webViewLink || f.webContentLink) as string
      };
    });
  } catch { return []; }
}

export async function fetchCalendar(query: string): Promise<ResultItem[]> {
  try {
    const res = await callTool('google_calendar_search_events', 'conn_q9ea16csh2f7k9sg5pam', { query: query });
    const data = res as Record<string, unknown>;
    const events = (data?.events || (Array.isArray(res) ? res : [])) as Array<Record<string, unknown>>;
    if (!Array.isArray(events) || events.length === 0) return [];
    return events.slice(0, 5).map((ev) => {
      return {
        title: (ev.title || ev.summary || 'No title') as string,
        content: [
          ev.start ? new Date(ev.start as string).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '',
          ev.location || '',
          ((ev.description as string) || '').substring(0, 150)
        ].filter(Boolean).join(' — '),
        url: (ev.htmlLink || ev.meetLink) as string
      };
    });
  } catch { return []; }
}

export async function fetchAsana(query: string): Promise<ResultItem[]> {
  try {
    const res = await callTool('search_tasks', 'conn_2z8xyfmew8sjd41a69qk', { text: query, limit: 5, opt_fields: 'name,gid,assignee.name,due_on,notes' });
    const data = res as Record<string, unknown>;
    const tasks = (data?.data || res) as Array<Record<string, unknown>>;
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    return tasks.slice(0, 5).map((t) => {
      const assignee = t.assignee as Record<string, unknown> | undefined;
      return {
        title: (t.name || 'Untitled task') as string,
        content: [
          assignee?.name || '',
          t.due_on || '',
          ((t.notes as string) || '').substring(0, 150)
        ].filter(Boolean).join(' — '),
        url: t.gid ? `https://app.asana.com/0/0/${t.gid}` : undefined
      };
    });
  } catch { return []; }
}

export async function fetchNotion(query: string): Promise<ResultItem[]> {
  try {
    // Use AI semantic search with highlights — searches Notion + connected sources (Gmail, Drive, Slack, etc.)
    const res = await callTool('notion-search', 'conn_1ykn33de2j69hkpfvg5r', {
      query,
      query_type: 'internal',
      page_size: 8,
      max_highlight_length: 400
    });
    const data = res as Record<string, unknown>;
    const results = (data?.results || res) as Array<Record<string, unknown>>;
    if (!Array.isArray(results) || results.length === 0) return [];

    return results.slice(0, 8).map((r) => {
      const title = (r.title || 'Untitled') as string;
      const highlight = (r.highlight || '') as string;
      const url = (r.url || '') as string;
      const sourceType = (r.type || '') as string;
      const timestamp = (r.timestamp || '') as string;

      // Source badge for clarity
      const badge = sourceType === 'page' ? '📄' :
                    sourceType === 'gmail' ? '📧' :
                    sourceType === 'google-drive' ? '📁' :
                    sourceType === 'slack' ? '💬' : '🔗';

      return {
        title: `${badge} ${title}`,
        content: highlight || `(${sourceType} result — no preview)`,
        url: url || undefined,
        date: timestamp || undefined
      };
    });
  } catch { return []; }
}

// ── Claude helper for Supabase intelligence ──
async function callClaudeText(model: string, maxTokens: number, prompt: string): Promise<string> {
  try {
    const res = await callTool('remote_http_call', 'conn_zbr9g639g6g466mmde8k', {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      extraHeaders: {
        'x-api-key': 'process.env.CLAUDE_API_KEY',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    return String((res as any)?.body?.content?.[0]?.text || '');
  } catch { return ''; }
}

function extractJsonObject(text: string): any | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

function renderRow(row: Record<string, unknown>, maxFields = 20, maxLen = 300): string {
  return Object.entries(row)
    .filter(([, v]) => v !== null && v !== '' && String(v).trim() !== '')
    .slice(0, maxFields)
    .map(([k, v]) => `**${k}**: ${String(typeof v === 'object' ? JSON.stringify(v) : v).substring(0, maxLen)}`)
    .join('\n');
}

const SUPA_CONN = 'conn_xmaq9bngsgw6e19jxcjn';
const SUPA_PROJECT = 'zlteahycfmpiaxdbnlvr';

async function runSql(sql: string): Promise<Record<string, unknown>[]> {
  const res = await callTool('execute_sql', SUPA_CONN, { project_id: SUPA_PROJECT, query: sql });
  return parseSqlResult(res);
}

export async function fetchSupabase(query: string): Promise<ResultItem[]> {
  const items: ResultItem[] = [];
  try {

    // ══════════════════════════════════════════════════════════════════
    // 🧠 INTELLIGENCE IN — Claude deeply analyses the question first
    // ══════════════════════════════════════════════════════════════════

    // Step 1A: Load the intelligence map from supabase_schema_map
    // This gives Claude rich AI-generated descriptions per table instead of bare names
    const mapRows = await runSql(
      `SELECT table_name, description, tags, questions_it_answers
       FROM supabase_schema_map
       ORDER BY table_name`
    );

    // Build a compact index: "table_name: description [tags]"
    const tableIndex = mapRows.map(r => {
      const desc = String(r.description || '').substring(0, 200);
      const tags = Array.isArray(r.tags) ? (r.tags as string[]).join(',') : String(r.tags || '');
      return `• ${r.table_name} [${tags}]: ${desc}`;
    }).join('\n');

    const allTableNames = mapRows.map(r => String(r.table_name || '')).filter(Boolean);

    // Step 1B: Claude IN — full question analysis with rich table context
    const inAnalysis = await callClaudeText('claude-sonnet-4-6', 1200,
`You are the intelligence layer for Qualico's company database. Qualico is a Belgian company selling Puzzlup puzzle products (mats, boards, trays, bags) and developing AI agents. Their database tracks: products, purchase orders, invoices, payments, inventory, cap table, loans, M&A research, ad campaigns, bank transactions, and more.

USER QUESTION: "${query}"

AVAILABLE TABLES WITH AI-GENERATED DESCRIPTIONS:
${tableIndex}

YOUR TASK — answer in JSON:
1. "intent": what is the user REALLY asking for? (1 sentence, be specific)
2. "enriched_query": a richer version of the question that makes the data need explicit (e.g. "what is the total unpaid amount on purchase orders?" instead of "openstaande POs")
3. "mode": "analytical" (needs aggregation/counting/summing/listing) OR "keyword" (looking up a specific named entity or ID)
   DEFAULT TO "analytical" for any question starting with hoeveel/wat/welke/wie/toon/lijst/totaal/overzicht/what/how many/which/list/show
4. "entity_type": the business concept being asked about (e.g. "Purchase Orders", "Products", "Investeerders")
5. "tables": array of 2-6 table names from the list above that are MOST relevant. Only include tables that actually exist in the list.
6. "key_filters": any specific filters you can infer (e.g. {"status": "unpaid", "date_range": "2025"})
7. "explanation": one sentence in Dutch summarizing what you understood

Return ONLY valid JSON. No markdown.`);

    let mode = 'analytical';
    let entityType = 'data';
    let enrichedQuery = query;
    let searchKeywords: string[] = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    let targetTables: string[] = [];
    let explanation = '';
    let keyFilters: Record<string, string> = {};

    const intent = extractJsonObject(inAnalysis);
    if (intent) {
      mode = intent.mode === 'keyword' ? 'keyword' : 'analytical';
      entityType = intent.entity_type || entityType;
      enrichedQuery = intent.enriched_query || query;
      explanation = intent.explanation || '';
      keyFilters = intent.key_filters || {};
      if (intent.search_keywords?.length) searchKeywords = intent.search_keywords;
      targetTables = (intent.tables || []).filter((t: string) => allTableNames.includes(t));
    }

    // Safety net: question-style queries are always analytical
    if (/^\s*(hoeveel|wat|welke|wie|waar|wanneer|lijst|toon|geef|som|totaal|overzicht|how many|how much|what|which|who|list|show|count|total)\b/i.test(query) || /\?\s*$/.test(query)) {
      mode = 'analytical';
    }

    // Heuristic fallback if Claude picked no tables
    if (targetTables.length === 0) {
      const q = query.toLowerCase();
      const candidates: string[] = [];
      if (/\bpo\b|purchase|leverancier|supplier|openstaand/i.test(q)) candidates.push('PO_Purchases','PO_Payments','PO_Product_Lines');
      else if (/transfer|\bto\b/i.test(q)) candidates.push('Transfer_Orders','TO_Product_Lines');
      else if (/product|ean|sku|mat|board|tray|bag|puzzl|gift/i.test(q)) candidates.push('Puzzlup_Product_Info','Product_Name_Mapping');
      else if (/invoice|factuur|cogs/i.test(q)) candidates.push('COGS_Invoices','COGS_Pending_Invoices');
      else if (/payment|betaling|bank/i.test(q)) candidates.push('Bank_Payments_KBC_Revolut','PO_Payments');
      else if (/inventory|stock|voorraad/i.test(q)) candidates.push('Inventory_Levels','Inventory_Snapshots');
      else if (/investeerder|cap.table|aandeel/i.test(q)) candidates.push('cap_table');
      else candidates.push('Puzzlup_Product_Info','PO_Purchases','COGS_Invoices','Research');
      targetTables = candidates.filter(t => allTableNames.includes(t));
    }
    if (targetTables.length === 0) return items;

    // Show the Intelligence IN card
    items.push({
      title: `🧠 Vraaganalyse — ${entityType}`,
      content: `**Begrepen:** ${explanation}\n\n**Verrijkte zoekopdracht:** ${enrichedQuery}\n**Modus:** ${mode === 'analytical' ? '📊 Analytisch (berekening/aggregatie)' : '🔍 Keyword (specifieke entiteit zoeken)'}\n**Tabellen:** ${targetTables.join(', ')}${Object.keys(keyFilters).length > 0 ? '\n**Filters:** ' + JSON.stringify(keyFilters) : ''}`
    });

    // ══════════════════════════════════════════════════════════════════
    // ⚡ MIDDLE — Fetch schema + run SQL
    // ══════════════════════════════════════════════════════════════════

    // Step 2: Fetch REAL column schemas + sample rows for selected tables
    const safeList = targetTables.slice(0, 8).map(t => `'${t.replace(/'/g, "''")}'`).join(',');
    const [colRows, ...sampleResults] = await Promise.all([
      runSql(`SELECT table_name, column_name, data_type FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name IN (${safeList})
              ORDER BY table_name, ordinal_position`),
      ...targetTables.slice(0, 8).map(t =>
        runSql(`SELECT * FROM "${t.replace(/"/g, '')}" LIMIT 4`).catch(() => [] as Record<string, unknown>[])
      )
    ]);

    const tableGroups = new Map<string, Array<{col: string; dtype: string}>>();
    for (const r of colRows) {
      const t = String(r.table_name || '');
      const c = String(r.column_name || '');
      if (!t || !c) continue;
      if (!tableGroups.has(t)) tableGroups.set(t, []);
      tableGroups.get(t)!.push({ col: c, dtype: String(r.data_type || '') });
    }

    // Also grab the AI descriptions for selected tables to enrich the SQL prompt
    const tableDescriptions = new Map<string, string>();
    for (const r of mapRows) {
      if (targetTables.includes(String(r.table_name))) {
        tableDescriptions.set(String(r.table_name), String(r.description || ''));
      }
    }

    // Build a grounded schema with descriptions + sample values
    const schemaText = targetTables.slice(0, 8).map((t, i) => {
      const cols = (tableGroups.get(t) || []).map(c => `${c.col} (${c.dtype})`).join(', ');
      const desc = tableDescriptions.get(t) || '';
      const samples = (sampleResults[i] || []).slice(0, 2).map(row =>
        '  sample: ' + JSON.stringify(Object.fromEntries(
          Object.entries(row).slice(0, 14).map(([k, v]) => [k, String(v ?? '').substring(0, 70)])
        ))
      ).join('\n');
      return `TABLE "${t}":
  purpose: ${desc}
  columns: ${cols}
${samples}`;
    }).join('\n\n');

    // Collect raw query results for Claude OUT synthesis
    const rawResultsForSynthesis: Array<{label: string; rows: Record<string, unknown>[];}> = [];

    // ── MODE A: ANALYTICAL — Claude writes SQL ──
    if (mode === 'analytical') {
      const sqlGenPrompt = (extra: string) =>
`You are a senior Postgres analyst for Qualico (Belgian board game / puzzle company). Write SQL to answer the user's question.

Original question: "${query}"
Enriched question: "${enrichedQuery}"
${Object.keys(keyFilters).length > 0 ? 'Inferred filters: ' + JSON.stringify(keyFilters) : ''}

REAL DATABASE SCHEMA (descriptions + columns + sample rows — use ONLY these tables and columns):

${schemaText}
${extra}
RULES:
- Postgres syntax only. Double-quote ALL table names (case-sensitive): "PO_Purchases", "cap_table", etc.
- Use ONLY columns visible in the schema above. Never invent columns.
- Study sample values carefully to determine correct filter values (status strings, boolean flags, date formats).
- For "open/outstanding/unpaid": look at boolean columns like fully_paid, or status columns with values like "pending" visible in samples.
- LIMIT 50. COALESCE nullable numerics to 0. Round money to 2 decimals.
- Generate 1-3 queries: ideally a summary (totals/counts) AND a detail breakdown.

Return ONLY JSON: {"queries":[{"label":"Dutch label for result","sql":"SELECT ..."}]}`;

      let sqlPlan = extractJsonObject(await callClaudeText('claude-sonnet-4-6', 1800, sqlGenPrompt('')));
      let queries: Array<{label: string; sql: string}> = sqlPlan?.queries || [];
      let gotData = false;

      for (const q of queries.slice(0, 3)) {
        let rows: Record<string, unknown>[] = [];
        let lastError = '';
        try {
          rows = await runSql(q.sql);
        } catch (e) {
          lastError = String((e as any)?.message || e).substring(0, 600);
        }

        // Self-repair: give Claude one chance to fix on error or empty result
        if (rows.length === 0) {
          const repairPrompt = sqlGenPrompt(
`\nPREVIOUS ATTEMPT FAILED:
SQL: ${q.sql}
${lastError ? 'ERROR: ' + lastError : 'RESULT: 0 rows. Filters are probably too strict. Re-examine sample values and fix the WHERE clause.'}
Write ONE corrected query. Return ONLY JSON: {"queries":[{"label":"...", "sql":"..."}]}\n`);
          const repaired = extractJsonObject(await callClaudeText('claude-sonnet-4-6', 900, repairPrompt));
          const fixedSql = repaired?.queries?.[0]?.sql;
          if (fixedSql) {
            try { rows = await runSql(fixedSql); } catch { /* give up */ }
          }
        }

        if (rows.length > 0) {
          gotData = true;
          rawResultsForSynthesis.push({ label: q.label, rows: rows.slice(0, 30) });

          const allRows = rows.slice(0, 30);
          if (allRows.length <= 5) {
            allRows.forEach(row => {
              const fields = renderRow(row);
              if (fields) items.push({ title: `📊 ${q.label}`, content: fields });
            });
          } else {
            const cols = Object.keys(allRows[0]).filter(k =>
              allRows.some(r => r[k] !== null && r[k] !== '' && String(r[k]).trim() !== '')
            ).slice(0, 10);
            const rowLines = allRows.map((row, idx) => {
              const vals = cols.map(c => {
                const v = row[c];
                if (v === null || v === undefined || String(v).trim() === '') return '—';
                return String(v).substring(0, 80);
              });
              return `${idx + 1}. ${vals.join(' · ')}`;
            });
            items.push({
              title: `📊 ${q.label} (${rows.length} rijen)`,
              content: `**${cols.join(' | ')}**\n\n${rowLines.join('\n')}`
            });
          }
        } else {
          items.push({ title: `📊 ${q.label}`, content: '⚠️ Geen resultaten gevonden — ook na automatische correctie.' });
        }
      }

      // ══════════════════════════════════════════════════════════════════
      // 🧠 INTELLIGENCE OUT — Claude synthesizes a conversational answer
      // ══════════════════════════════════════════════════════════════════
      if (gotData && rawResultsForSynthesis.length > 0) {
        const dataForSynthesis = rawResultsForSynthesis.map(r =>
          `## ${r.label}\n${JSON.stringify(r.rows.slice(0, 20), null, 1).substring(0, 3000)}`
        ).join('\n\n');

        const synthesisAnswer = await callClaudeText('claude-sonnet-4-6', 1000,
`You are the intelligence output layer for Qualico's company database. Your job is to take raw database results and turn them into a clear, conversational answer — like a smart CFO assistant.

ORIGINAL QUESTION: "${query}"
WHAT WE UNDERSTOOD: ${explanation} (${enrichedQuery})

RAW DATABASE RESULTS:
${dataForSynthesis}

TASK:
Write a clear, conversational answer in Dutch (or English if the question was in English) that:
1. Directly answers what was asked — lead with the key number/fact
2. Highlights the most important insights (totals, outliers, trends)
3. Mentions any caveats or things to be aware of (e.g. "dit zijn alleen ongefactureerde bedragen")
4. Suggests 1-2 useful follow-up questions if relevant
Keep it concise (max 200 words). Use bullet points for lists. Be like a smart colleague, not a robot.`);

        if (synthesisAnswer) {
          items.push({
            title: `💬 Antwoord`,
            content: synthesisAnswer
          });
        }
      }

      if (gotData) return items.slice(0, 60);
      // No analytical data → fall through to keyword search
    }

    // ── MODE B: KEYWORD SEARCH ──
    await Promise.all(Array.from(tableGroups.entries()).map(async ([tbl, columns]) => {
      try {
        const textCols = columns
          .filter(c => ['text','character varying','varchar','name','json','jsonb'].includes(c.dtype))
          .map(c => c.col).slice(0, 12);
        const numCols = columns
          .filter(c => ['numeric','integer','bigint','double precision','real'].includes(c.dtype))
          .map(c => c.col).slice(0, 5);

        if (textCols.length === 0 && numCols.length === 0) return;

        const keywordConditions = searchKeywords.slice(0, 5).map(kw => {
          const eKw = kw.replace(/'/g, "''");
          const parts: string[] = [];
          if (textCols.length > 0) parts.push(textCols.map(c => `"${c}"::text ILIKE '%${eKw}%'`).join(' OR '));
          const numVal = parseFloat(kw);
          if (!isNaN(numVal) && numCols.length > 0) parts.push(numCols.map(c => `"${c}" = ${numVal}`).join(' OR '));
          return parts.length > 0 ? `(${parts.join(' OR ')})` : null;
        }).filter(Boolean);

        if (keywordConditions.length === 0) return;

        const andWhere = keywordConditions.join(' AND ');
        const orWhere = keywordConditions.join(' OR ');

        let rows: Record<string, unknown>[] = [];
        if (searchKeywords.length > 1) {
          const andRes = await callTool('execute_sql', SUPA_CONN, {
            project_id: SUPA_PROJECT,
            query: `SELECT * FROM "${tbl}" WHERE ${andWhere} LIMIT 10`
          });
          rows = parseSqlResult(andRes);
        }
        if (rows.length === 0) {
          const orRes = await callTool('execute_sql', SUPA_CONN, {
            project_id: SUPA_PROJECT,
            query: `SELECT * FROM "${tbl}" WHERE ${orWhere} LIMIT 10`
          });
          rows = parseSqlResult(orRes);
        }

        rows.forEach(row => {
          const fields = Object.entries(row)
            .filter(([, v]) => v !== null && v !== '' && String(v).trim() !== '')
            .slice(0, 18)
            .map(([k, v]) => {
              const val = typeof v === 'object' ? JSON.stringify(v).substring(0, 250) : String(v).substring(0, 250);
              return `**${k}**: ${val}`;
            }).join('\n');
          if (fields) {
            rawResultsForSynthesis.push({ label: tbl, rows: [row] });
            items.push({ title: `📊 ${tbl}`, content: fields });
          }
        });
      } catch { /* skip */ }
    }));

    // Claude OUT for keyword results too
    if (rawResultsForSynthesis.length > 0) {
      const dataForSynthesis = rawResultsForSynthesis.slice(0, 10).map(r =>
        `## ${r.label}\n${JSON.stringify(r.rows, null, 1).substring(0, 2000)}`
      ).join('\n\n');

      const synthesisAnswer = await callClaudeText('claude-sonnet-4-6', 800,
`You are the intelligence output layer for Qualico's company database. Summarize the search results below into a clear, useful answer.

ORIGINAL QUESTION: "${query}"

RAW RESULTS:
${dataForSynthesis}

Write a concise, conversational answer in Dutch (max 150 words). Lead with the key finding. Mention caveats if relevant.`);

      if (synthesisAnswer) {
        items.push({ title: `💬 Antwoord`, content: synthesisAnswer });
      }
    }

    return items.slice(0, 60);
  } catch { return []; }
}

// ============================================================
// APOLLO COMPANY ENRICHMENT — get verified business data
// ============================================================

interface ApolloCompanyData {
  name: string;
  website?: string;
  phone?: string;
  city?: string;
  country?: string;
  industry?: string;
  employeeCount?: string;
  description?: string;
  linkedinUrl?: string;
  founded?: number;
}

async function extractCompanyNames(query: string, allResults: Record<string, ResultItem[]>): Promise<string[]> {
  // Collect text from all results
  const textParts: string[] = [];
  for (const [, items] of Object.entries(allResults)) {
    for (const item of items) {
      if (item.title) textParts.push(item.title);
      if (item.content) textParts.push(item.content.substring(0, 100));
    }
  }
  const allText = textParts.join(' ').substring(0, 3000);

  try {
    const res = await callHttpTool('conn_j0wpcjv8ce3v6cxx29ps', 'POST',
      'https://api.perplexity.ai/chat/completions',
      { 'Content-Type': 'application/json' },
      {
        model: 'sonar',
        messages: [{
          role: 'user',
          content: `Extract ONLY company/business/brand names from this text. Return ONLY a JSON array of strings, max 5 companies. No explanation, no markdown, just the JSON array. If no companies found, return [].

Query: ${query}
Text: ${allText}`
        }]
      }
    );
    const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
    const choices = (body?.choices || (res as Record<string, unknown>).choices) as Array<Record<string, unknown>> | undefined;
    const content = ((choices?.[0]?.message as Record<string, unknown>)?.content as string) || '[]';
    // Parse the JSON array from the response
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      const names = JSON.parse(match[0]) as string[];
      // Never enrich the workspace's own company via Apollo
      const OWN_COMPANY = ['qualico', 'qualico bv', 'qualico b.v.'];
      return names
        .filter(n => typeof n === 'string' && n.length > 1)
        .filter(n => !OWN_COMPANY.includes(n.toLowerCase().trim()))
        .slice(0, 5);
    }
    return [];
  } catch {
    return [];
  }
}

// Gemini enrichment — get real local info (address, phone, hours) per company
async function enrichWithGemini(companyNames: string[], userQuery: string): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const lookups = companyNames.map(async (name) => {
    try {
      const prompt = `Geef voor "${name}" de volgende info (als beschikbaar, anders weglaten):
- Exacte straatnaam + huisnummer + stad (voor de locatie in context van: ${userQuery.substring(0, 100)})
- Telefoonnummer
- Openingsuren
- Website URL
Geef ALLEEN verified echte data. Formaat: key: value per lijn. Geen uitleg.`;
      const res = await callHttpTool('conn_8mf96sd17a4ve49fmtp2', 'POST',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
        {},
        {
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }]
        }
      );
      const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
      const candidates = (body?.candidates || (res as Record<string, unknown>).candidates) as Array<Record<string, unknown>> | undefined;
      const text = ((candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string || '';
      if (text) results[name] = text.substring(0, 400);
    } catch { /* skip */ }
  });
  await Promise.all(lookups);
  return results;
}

async function enrichWithApollo(companyNames: string[]): Promise<ApolloCompanyData[]> {
  const results: ApolloCompanyData[] = [];
  // Look up each company in parallel
  const lookups = companyNames.map(async (name) => {
    try {
      const res = await window.tasklet.invokeTool({ toolName: 'apollo_io-organization-search', connectionId: 'conn_dc078ynk6c45wc65sj64', args: { qOrganizationName: name } });
      const data = res as Record<string, unknown>;
      const orgs = (data.organizations || data.accounts || []) as Array<Record<string, unknown>>;
      if (orgs.length > 0) {
        // Prefer a Belgian company if multiple results — avoid wrong country match
        const belgianOrg = orgs.find(o => {
          const country = ((o.country as string) || '').toLowerCase();
          const website = ((o.website_url as string) || '').toLowerCase();
          return country.includes('belg') || website.includes('.be');
        });
        const org = belgianOrg || orgs[0];
        const result: ApolloCompanyData = {
          name: (org.name as string) || name,
        };
        if (org.website_url) result.website = org.website_url as string;
        if (org.phone) result.phone = org.phone as string;
        if (org.primary_phone) result.phone = (org.primary_phone as Record<string, unknown>)?.number as string || org.primary_phone as string;
        if (org.city || org.country) result.city = [org.city, org.state, org.country].filter(Boolean).join(', ');
        if (org.industry) result.industry = org.industry as string;
        if (org.estimated_num_employees) result.employeeCount = String(org.estimated_num_employees);
        if (org.short_description) result.description = (org.short_description as string).substring(0, 200);
        if (org.linkedin_url) result.linkedinUrl = org.linkedin_url as string;
        if (org.founded_year) result.founded = org.founded_year as number;
        results.push(result);
      }
    } catch { /* skip failed lookups */ }
  });
  await Promise.all(lookups);
  return results;
}

function formatApolloDataForPrompt(companies: ApolloCompanyData[]): string {
  if (companies.length === 0) return '';
  const blocks = companies.map(c => {
    const lines = [`**${c.name}**`];
    if (c.website) lines.push(`- 🌐 Website: ${c.website}`);
    if (c.phone) lines.push(`- 📞 Telefoon: ${c.phone}`);
    if (c.city) lines.push(`- 📍 Locatie: ${c.city}`);
    if (c.linkedinUrl) lines.push(`- 💼 LinkedIn: ${c.linkedinUrl}`);
    if (c.industry) lines.push(`- 🏭 Sector: ${c.industry}`);
    if (c.employeeCount) lines.push(`- 👥 Werknemers: ~${c.employeeCount}`);
    if (c.founded) lines.push(`- 📅 Opgericht: ${c.founded}`);
    if (c.description) lines.push(`- 📝 ${c.description}`);
    return lines.join('\n');
  });
  return `\n\nAPOLLO.IO BEDRIJFSDATA (dit zijn HQ/firmographic gegevens — combineer met adres/telefoon uit andere bronnen voor winkels/locaties):\n${blocks.join('\n\n')}`;
}

// ============================================================
// UNIFIED ANSWER — synthesize via Perplexity + Apollo enrichment
// ============================================================

export async function synthesizeAnswer(query: string, allResults: Record<string, ResultItem[]>, selectedSources: string[] = []): Promise<{ text: string; citations: string[] }> {
  const contextParts: string[] = [];
  // Build numbered source list with REAL URLs from our results
  const realSources: Array<{ num: number; title: string; url: string; source: string }> = [];
  let sourceNum = 1;

  for (const [source, items] of Object.entries(allResults)) {
    if (items.length === 0) continue;
    const lines: string[] = [];
    for (const item of items) {
      if (item.url) {
        realSources.push({ num: sourceNum, title: item.title, url: item.url, source });
        lines.push(`- ${item.title}: ${item.content?.substring(0, 400)} (bron: ${item.url})`);
        sourceNum++;
      } else {
        lines.push(`- ${item.title}: ${item.content?.substring(0, 400)}`);
      }
    }
    contextParts.push(`[Bron: ${source}]\n${lines.join('\n')}`);
  }
  if (contextParts.length === 0) return { text: 'Geen resultaten gevonden in de geselecteerde bronnen.', citations: [] };

  // Build the real citations array (indexed by number)
  const realCitations = realSources.map(s => s.url);

  // STEP 2: Extract company names and enrich via Apollo (only if selected) + Gemini in parallel
  const apolloEnabled = selectedSources.includes('apollo');
  let apolloSection = '';
  let geminiSection = '';
  try {
    const companyNames = await extractCompanyNames(query, allResults);
    if (companyNames.length > 0) {
      const [apolloData, geminiData] = await Promise.all([
        apolloEnabled ? enrichWithApollo(companyNames) : Promise.resolve([]),
        enrichWithGemini(companyNames, query)
      ]);
      apolloSection = formatApolloDataForPrompt(apolloData);
      if (Object.keys(geminiData).length > 0) {
        const blocks = Object.entries(geminiData).map(([name, info]) => `**${name}**\n${info}`);
        geminiSection = `\n\nGEMINI LOKALE DATA (adres, telefoon, openingsuren via Google Search — gebruik dit voor lokale/winkel info):\n${blocks.join('\n\n')}`;
      }
    }
  } catch { /* enrichment is optional, continue without */ }

  const prompt = `Je bent een senior research analist. Geef een professioneel antwoord EXACT in het volgende 4-secties format.

CRUCIALE REGELS:
- Voor bedrijfsinfo: gebruik ALTIJD de Apollo-data als die beschikbaar is — die is geverifieerd
- URLs moeten ECHT zijn — uit bronnen of Apollo-data. Verzin NOOIT URLs of contactinfo
- GEEN genummerde referenties zoals [1], [2], [3] — die zijn VERBODEN
- GEEN inline links in de Samenvatting sectie — die moet puur clean tekst zijn (geen URLs)
- Links ALLEEN in de Bedrijven & Merken sectie (bij 🌐 Website) en in Praktisch Advies (enkel als het echt een nuttige URL is, bv. official website of Google Maps link)
- Antwoord in het Nederlands als de vraag Nederlands is
- Maak het scanbaar: korte zinnen, bullet points

JE MOET EXACT DEZE 4 SECTIES GEBRUIKEN (met exact deze headers):

## 📋 Samenvatting
Kernboodschap in 3-5 bullet points. Wat is het antwoord op de vraag? Belangrijkste inzichten.

## 🏢 Bedrijven & Merken
Per bedrijf/winkel een informatieblok. Gebruik ALLE beschikbare bronnen voor dit blok — Apollo voor B2B-data, maar haal adres/telefoon/openingsuren VOORAL uit Gemini, Perplexity en andere bronnen als die beschikbaar zijn.
**Bedrijfsnaam**
- 🌐 Website: echte URL (uit Apollo of bronnen — klikbare link)
- 📞 Telefoon: echt nummer (uit bronnen of Apollo)
- 📍 Locatie: specifiek straat + huisnummer + stad als die in de bronnen staat — NIET gewoon de stad alleen. Maak een Google Maps zoeklink met bedrijfsnaam + adres: [📍 Bekijk op Google Maps](https://www.google.com/maps/search/BEDRIJFSNAAM+STRAAT+HUISNUMMER+STAD) — vervang spaties door + en gebruik echte data. Als je alleen de bedrijfsnaam + stad weet: [📍 Zoek op Google Maps](https://www.google.com/maps/search/BEDRIJFSNAAM+STAD)
- 🕐 Openingsuren: indien gevonden in bronnen
- 🏭 Sector: branche
- 📝 Omschrijving: korte samenvatting
(Laat velden WEG als er echt geen data is — toon NOOIT "niet beschikbaar" of "onbekend")
BELANGRIJK: Voor bekende winkelketens en merken ZIJN er adressen en telefoonnummers in de brondata — zoek die goed op en gebruik ze!
Als er geen bedrijven relevant zijn, schrijf "Geen specifieke bedrijven gevonden in de resultaten."

## 💡 Praktisch Advies
Concrete, actionable tips en aanbevelingen. Wat kan de gebruiker DOEN met deze info? Stappen, tips, do's/don'ts.

## 📌 Conclusie
2-3 zinnen eindconclusie. Kernboodschap + eventueel vervolgstap.

BELANGRIJK: Gebruik ALLEEN deze 4 secties, geen andere headers. Elke sectie MOET aanwezig zijn.

Vraag: ${query}

Bronnen:
${contextParts.join('\n\n')}${apolloSection}${geminiSection}

Geef nu je antwoord in exact het 4-secties format:`;

  // Truncate prompt to avoid oversized requests (max ~8000 chars of context)
  const maxContextLen = 8000;
  const truncatedContext = contextParts.join('\n\n').substring(0, maxContextLen);
  const finalPrompt = prompt.replace(contextParts.join('\n\n'), truncatedContext);

  // Try Perplexity first, Claude as fallback
  const tryPerplexity = async (): Promise<string | null> => {
    try {
      const res = await callHttpTool('conn_j0wpcjv8ce3v6cxx29ps', 'POST',
        'https://api.perplexity.ai/chat/completions',
        {},
        { model: 'perplexity/sonar', messages: [{ role: 'user', content: finalPrompt }] },
        60
      );
      const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
      const choices = (body?.choices || (res as Record<string, unknown>).choices) as Array<Record<string, unknown>> | undefined;
      const text = ((choices?.[0]?.message as Record<string, unknown>)?.content as string) || null;
      return text;
    } catch {
      return null;
    }
  };

  const tryClaudeFallback = async (): Promise<string> => {
    try {
      const res = await callHttpTool('conn_zbr9g639g6g466mmde8k', 'POST',
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': 'process.env.CLAUDE_API_KEY', 'anthropic-version': '2023-06-01' },
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: finalPrompt }]
        },
        60
      );
      const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
      const content = (body?.content || (res as Record<string, unknown>).content) as Array<Record<string, unknown>> | undefined;
      return (content?.[0]?.text as string) || 'Kon geen samenvatting genereren.';
    } catch {
      return 'Samenvatting niet beschikbaar. Probeer de zoekopdracht opnieuw.';
    }
  };

  const text = (await tryPerplexity()) ?? (await tryClaudeFallback());
  // IGNORE Perplexity's own citations — use our real source URLs instead
  return { text, citations: realCitations };
}

// ============================================================
// FOLLOW-UP — chat on top of research results
// ============================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
}

export async function followUpAnswer(
  originalQuery: string,
  sourceContext: string,
  chatHistory: ChatMessage[],
  followUpQuestion: string,
  realCitations: string[]
): Promise<{ text: string; citations: string[] }> {
  // Build message history for Perplexity
  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content: `Je bent een research assistant. De gebruiker heeft eerder gezocht naar: "${originalQuery}". Hier is de context van de gevonden bronnen:\n\n${sourceContext.substring(0, 4000)}\n\nBELANGRIJK: Beantwoord vervolgvragen UITSLUITEND op basis van deze context. Doe GEEN eigen zoekopdrachten. Gebruik GEEN genummerde referenties zoals [1], [2] — die zijn verboden. Als je naar een bron verwijst, gebruik dan een inline markdown link: [domeinnaam](url). Voeg GEEN eigen bronnen toe. Antwoord in het Nederlands als de gebruiker Nederlands spreekt.`
    }
  ];

  // Add chat history
  for (const msg of chatHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add the new question
  messages.push({ role: 'user', content: followUpQuestion });

  try {
    const res = await callHttpTool('conn_j0wpcjv8ce3v6cxx29ps', 'POST',
      'https://api.perplexity.ai/chat/completions',
      {},
      { model: 'sonar', messages }
    );
    const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
    const choices = (body?.choices || (res as Record<string, unknown>).choices) as Array<Record<string, unknown>> | undefined;
    const text = ((choices?.[0]?.message as Record<string, unknown>)?.content as string) || 'Kon geen antwoord genereren.';
    // IGNORE Perplexity's own citations — use the real ones from initial search
    return { text, citations: realCitations };
  } catch {
    return { text: 'Antwoord niet beschikbaar.', citations: [] };
  }
}

// ============================================================
// QUERY PLANNER — AI analyzes the question per source
// ============================================================

export async function planQueries(
  userQuestion: string,
  selectedSources: string[]
): Promise<Record<string, string>> {
  const sourceDescriptions: Record<string, string> = {
    perplexity_fast: 'Fast web search AI — best for quick answers, general knowledge, how-to questions',
    perplexity_deep: 'Deep web search AI (sonar-pro) — best for thorough research, complex questions, detailed analysis',
    perplexity_research: 'Multi-step AI research (sonar-deep-research) — autonomous web research with multiple search rounds, citations and synthesis. Takes 1-3 minutes.',
    gemini_deep: 'Gemini Deep Research (gemini-2.5-flash + Google Search) — detailed analysis with grounding, multiple sources, 800+ words.',
    exa: 'Neural web search — best for finding specific companies, articles, research papers',
    tavily: 'Web search with answers — best for factual lookups, structured data, comparisons',
    firecrawl: 'Web scraper — best for finding specific web pages, company websites, documentation',
    gemini: 'Google AI — best for analysis, reasoning, technical questions',
    apollo: 'B2B database — searches companies and people. Query should be a company name OR job title, keep it short (1-3 words)',
    hunter: 'Email finder — searches by domain name. Query should be a domain like "company.com"',
    gmail_company: 'Company Gmail (tim@qualico.be) — search email threads. Use short keywords, no full sentences',
    gmail_personal: 'Personal Gmail (huybrechtstim@gmail.com) — search email threads. Use short keywords',
    slack: 'Slack messages — search workspace messages. Use 2-4 keywords',
    drive: 'Google Drive — searches file CONTENT (fullText). Use 2-4 keywords that would appear IN the documents',
    calendar: 'Google Calendar — search events. Use short keywords related to meeting topics',
    asana: 'Asana tasks — search task names and descriptions. Use 2-4 keywords',
    notion: 'Notion AI semantic search — searches across Notion pages AND connected sources (Gmail, Drive, Slack). Understands questions. Use a natural language query or key concepts',
    supabase: 'Qualico bedrijfsdatabase — 187 tabellen (POs, producten, voorraad, financiën, M&A, cap table…). Stel vragen in gewone taal.',
  };

  const sourceList = selectedSources
    .map(s => `- "${s}": ${sourceDescriptions[s] || 'search tool'}`)
    .join('\n');

  const prompt = `You are a research query planner. A user asked a question, and you need to generate the OPTIMAL search query for each selected source. Each source has different strengths — tailor the query to get the best results from each.

RULES:
- For email/slack/drive/calendar/asana: use 2-5 SHORT keywords (no full sentences, no stopwords)
- For apollo: use just the company name or a very short job title
- For hunter: use just a domain like "company.com"
- For perplexity_fast/perplexity_deep/perplexity_research: full question optimized for real-time web search
- For gemini_deep: detailed research question with context for deep analysis
- For gemini: use a Google-style query. If the question is about local businesses, shops, or places — ALWAYS append "adres telefoonnummer openingsuren" to the query so Google Search returns specific addresses and contact info
- For exa/tavily/firecrawl: use search-engine style queries
- Always return valid JSON, nothing else
- If a source doesn't make sense for this question, still provide a reasonable query attempt

User question: "${userQuestion}"

Selected sources:
${sourceList}

Return a JSON object mapping source id to its optimized query string. Example:
{"gmail_company": "Amazon API access", "perplexity": "How to get Amazon Advertising API access quickly", "apollo": "Amazon"}

JSON response:`;

  try {
    const res = await callHttpTool('conn_j0wpcjv8ce3v6cxx29ps', 'POST',
      'https://api.perplexity.ai/chat/completions',
      {},
      { model: 'sonar', messages: [{ role: 'user', content: prompt }], temperature: 0.1 }
    );
    const body = (res as Record<string, unknown>).body as Record<string, unknown> | undefined;
    const choices = (body?.choices || (res as Record<string, unknown>).choices) as Array<Record<string, unknown>> | undefined;
    const answer = ((choices?.[0]?.message as Record<string, unknown>)?.content as string) || '';

    // Extract JSON from response (might have markdown code fences)
    const jsonMatch = answer.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
      // Ensure all selected sources have a query (fallback to original)
      const result: Record<string, string> = {};
      selectedSources.forEach(s => {
        result[s] = parsed[s] || userQuestion;
      });
      return result;
    }
  } catch { /* fallback below */ }

  // Fallback: use original question for all
  const fallback: Record<string, string> = {};
  selectedSources.forEach(s => { fallback[s] = userQuestion; });
  return fallback;
}

// ============================================================
// SOURCE REGISTRY
// ============================================================

export const SOURCE_FETCHERS: Record<string, (query: string) => Promise<ResultItem[]>> = {
  perplexity_fast: fetchPerplexityFast,
  perplexity_deep: fetchPerplexityDeep,
  perplexity_research: fetchPerplexityResearch,
  gemini_deep: fetchGeminiDeep,
  exa: fetchExa,
  tavily: fetchTavily,
  firecrawl: fetchFirecrawl,
  gemini: fetchGemini,
  claude: fetchClaude,
  apollo: fetchApollo,
  hunter: fetchHunter,
  gmail_company: fetchGmailCompany,
  gmail_personal: fetchGmailPersonal,
  slack: fetchSlack,
  drive: fetchDrive,
  calendar: fetchCalendar,
  asana: fetchAsana,
  notion: fetchNotion,
  supabase: fetchSupabase,
};
