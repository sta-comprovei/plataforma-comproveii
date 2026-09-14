// supabase/functions/admin-atualizar-email/index.ts
// Atualiza e-mail via Admin API (auth.users) e depois em public.usuarios.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { usuario_id, novo_email } = await req.json()

    if (!usuario_id || !novo_email) {
      return new Response(
        JSON.stringify({ erro: 'Campos obrigatórios: usuario_id, novo_email.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const authHeader = req.headers.get('Authorization')!
    const clienteUsuario = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: perfil } = await clienteUsuario.rpc('fn_meu_perfil')
    if (perfil !== 'administrador') {
      return new Response(
        JSON.stringify({ erro: 'Acesso restrito a administradores.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const emailNormalizado = novo_email.toLowerCase().trim()

    const clienteAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Atualizar em auth.users via Admin API
    const { error: errAuth } = await clienteAdmin.auth.admin.updateUserById(usuario_id, {
      email: emailNormalizado,
    })

    if (errAuth) {
      return new Response(
        JSON.stringify({ erro: errAuth.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Atualizar em public.usuarios via RPC (valida unicidade)
    const { error: errPublic } = await clienteUsuario.rpc('fn_atualizar_email_usuario', {
      p_id:    usuario_id,
      p_email: emailNormalizado,
    })

    if (errPublic) {
      return new Response(
        JSON.stringify({ erro: errPublic.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ erro: 'Erro interno: ' + (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
