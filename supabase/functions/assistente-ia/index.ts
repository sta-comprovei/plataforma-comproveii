/**
 * supabase/functions/assistente-ia/index.ts
 *
 * Proxy seguro para a API Anthropic.
 * A ANTHROPIC_API_KEY fica exclusivamente como secret do Supabase —
 * nunca exposta no bundle do frontend.
 *
 * Deploy:
 *   supabase functions deploy assistente-ia --no-verify-jwt
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const TIMEOUT_MS    = 55_000   // 55 s — abaixo do limite de 60 s da plataforma Supabase

Deno.serve(async (req: Request) => {
  // ── CORS preflight ───────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    // ── Ler body enviado pelo frontend ───────────────────────────────────
    const payload = await req.json()

    // ── Secret — nunca sai do servidor ──────────────────────────────────
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
    if (!apiKey) {
      return new Response(
        JSON.stringify({ erro: 'ANTHROPIC_API_KEY não configurada nos secrets do Supabase.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // ── AbortController para timeout ─────────────────────────────────────
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let anthropicRes: Response
    try {
      anthropicRes = await fetch(ANTHROPIC_URL, {
        method:  'POST',
        signal:  controller.signal,
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      })
    } finally {
      clearTimeout(timer)
    }

    // ── Repassar a resposta da Anthropic para o frontend ─────────────────
    const body = await anthropicRes.text()
    return new Response(body, {
      status:  anthropicRes.status,
      headers: {
        ...CORS,
        'Content-Type': anthropicRes.headers.get('Content-Type') ?? 'application/json',
      },
    })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return new Response(
      JSON.stringify({ erro: isTimeout ? 'Tempo limite excedido (55 s).' : String(err) }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
