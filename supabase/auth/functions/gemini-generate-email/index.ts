// ============================================================
// gemini-generate-email — Edge Function
// ============================================================
// Sinh email template (subject + body) qua Gemini API với context
// user riêng. Đọc credit pool từ app_settings.gemini_credit_pool.
//
// Response: JSON { subject, body } — không streaming (Supabase proxy
// không reliably forward SSE). Client show loading state trong lúc chờ.
//
// Output format từ model (plain text với markers):
//   ===SUBJECT===
//   <subject>
//   ===BODY===
//   <body>
//   ===END===
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Tone = 'formal' | 'casual' | 'friendly';

interface GenerateInput {
  tone: Tone;
  current_subject?: string;
  current_body?: string;
}

interface GeminiKeyEntry {
  name?: string;
  key: string;
}

interface UserContext {
  senderDisplayName: string;
  senderSignature: string;
  leadCount: number;
  templates: Array<{ name: string; subject: string; body: string }>;
  campaigns: Array<{ name: string; description: string | null }>;
}

// ============================================================
// Load credit pool
// ============================================================
async function loadPool(admin: ReturnType<typeof createClient>): Promise<GeminiKeyEntry[]> {
  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'gemini_credit_pool')
    .maybeSingle();

  if (error) throw new Error(`Load pool failed: ${error.message}`);
  if (!data?.value) return [];

  const row = data.value as { keys?: unknown };
  if (!Array.isArray(row.keys)) return [];

  return row.keys
    .map((k: unknown): GeminiKeyEntry | null => {
      if (typeof k === 'string') return { key: k.trim() };
      if (k && typeof k === 'object' && 'key' in k && typeof (k as { key: unknown }).key === 'string') {
        return { name: (k as { name?: string }).name, key: ((k as { key: string }).key).trim() };
      }
      return null;
    })
    .filter((k): k is GeminiKeyEntry => k !== null && k.key.length > 0);
}

// ============================================================
// Load user context
// ============================================================
async function loadUserContext(userClient: ReturnType<typeof createClient>): Promise<UserContext> {
  const [settingsRes, templatesRes, campaignsRes, leadCountRes] = await Promise.all([
    userClient.from('agency_user_settings').select('sender_display_name, sender_signature').maybeSingle(),
    userClient.from('templates').select('name, subject, body').order('created_at', { ascending: false }).limit(10),
    userClient.from('campaigns').select('name, description').order('created_at', { ascending: false }).limit(3),
    userClient.from('leads').select('id', { count: 'exact', head: true }).is('deleted_at', null),
  ]);

  return {
    senderDisplayName: settingsRes.data?.sender_display_name ?? 'You',
    senderSignature: settingsRes.data?.sender_signature ?? '',
    leadCount: leadCountRes.count ?? 0,
    templates: (templatesRes.data ?? []) as UserContext['templates'],
    campaigns: (campaignsRes.data ?? []) as UserContext['campaigns'],
  };
}

// ============================================================
// Build prompt
// ============================================================
const TONE_INSTRUCTIONS: Record<Tone, string> = {
  formal: 'business-like, professional tone. No contractions. Direct value proposition.',
  casual: 'conversational, contractions OK, shorter sentences, feels like a human peer wrote it.',
  friendly: 'warm, empathetic, personal, feels like reaching out to a friend or acquaintance.',
};

function buildPrompt(tone: Tone, ctx: UserContext, current: { subject?: string; body?: string }): string {
  const templatesSection = ctx.templates.length > 0
    ? ctx.templates.map((t, i) => `[${i + 1}] "${t.name}" | Subject: ${t.subject} | Body: ${t.body.slice(0, 150)}`).join('\n')
    : '(none)';

  const campaignsSection = ctx.campaigns.length > 0
    ? ctx.campaigns.map((c, i) => `[${i + 1}] ${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n')
    : '(none)';

  const currentSection = (current.subject || current.body)
    ? `CURRENT DRAFT (improve, don't rewrite entirely):
Subject: ${current.subject ?? '(none)'}
Body: ${current.body ?? '(none)'}`
    : 'CURRENT DRAFT: (none — create from scratch)';

  return `You are an expert email copywriter for cold outreach and follow-up campaigns.

Generate ONE email template matching the user's tone and style.

RESPONSE FORMAT (STRICT — return ONLY this structure, NO markdown fence, NO explanation):
===SUBJECT===
<subject line, max 80 chars>
===BODY===
<email body plain text with {{variables}} for personalization>
===END===

VARIABLES: {{name}}, {{first_name}}, {{company}}, {{email}}, {{phone}}, {{website}}

TONE: ${tone} — ${TONE_INSTRUCTIONS[tone]}

SENDER: ${ctx.senderDisplayName}
${ctx.senderSignature ? `SIGNATURE: ${ctx.senderSignature}` : ''}
CONTEXT: ${ctx.leadCount} leads in pipeline

RECENT TEMPLATES (style reference, don't copy):
${templatesSection}

CAMPAIGNS:
${campaignsSection}

${currentSection}

RULES:
- Subject: catchy, use {{first_name}} or {{company}} naturally
- Body: 3-5 short paragraphs, clear CTA
- Don't include signature in body (system injects it)
- Match language of user's templates (Vietnamese if they use Vietnamese, English otherwise)
- If no templates exist, default to Vietnamese

Begin with ===SUBJECT=== now.`;
}

// ============================================================
// Call Gemini (non-stream, reliable)
// ============================================================
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const TIMEOUT_MS = 30_000;

interface GeminiResult { subject: string; body: string }

async function callGemini(key: string, prompt: string): Promise<GeminiResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('Gemini trả response rỗng');

    // Parse markers
    const subjectMatch = text.match(/===SUBJECT===\s*([\s\S]*?)(?====BODY===)/);
    const bodyMatch = text.match(/===BODY===\s*([\s\S]*?)(?====END===)/);

    const subject = subjectMatch?.[1]?.trim() ?? '';
    const body = bodyMatch?.[1]?.trim() ?? '';

    if (!subject || !body) {
      throw new Error(`Parse fail. Raw: ${text.slice(0, 200)}`);
    }

    return { subject, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetriable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { status?: number }).status;
  return status === 429 || status === 500 || status === 503 || status === 504 || err.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Handler
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('AGENCY_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured (missing service key)' }, 500);

  // Verify JWT
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Missing auth' }, 401);

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Unauthorized' }, 401);

  // User client: nếu SUPABASE_ANON_KEY có → dùng. Nếu không → dùng service key với filter manual.
  const clientKey = anonKey || serviceKey;
  const userClient = createClient(supabaseUrl, clientKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: GenerateInput;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (!body.tone || !['formal', 'casual', 'friendly'].includes(body.tone)) {
    return json({ error: 'tone must be formal | casual | friendly' }, 400);
  }

  let pool: GeminiKeyEntry[];
  let userContext: UserContext;
  try {
    [pool, userContext] = await Promise.all([loadPool(adminClient), loadUserContext(userClient)]);
  } catch (err) {
    return json({ error: `Load context: ${err instanceof Error ? err.message : 'failed'}` }, 500);
  }

  if (pool.length === 0) {
    return json({ error: 'Gemini credit pool chưa config. Vào Config → AI Agentic thêm ít nhất 1 key.' }, 400);
  }

  const prompt = buildPrompt(body.tone, userContext, { subject: body.current_subject, body: body.current_body });

  // Try ALL keys, shuffle, delay 2s between 429 retries
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const errors: string[] = [];

  for (let i = 0; i < shuffled.length; i++) {
    const entry = shuffled[i];
    try {
      const result = await callGemini(entry.key, prompt);
      return json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      errors.push(`[${entry.name ?? `key${i + 1}`}] ${msg}`);
      if (isRetriable(err) && i < shuffled.length - 1) {
        await sleep(2000);
      }
    }
  }

  return json({ error: 'Tất cả Gemini key đều fail. Thử lại sau.', details: errors }, 429);
});
