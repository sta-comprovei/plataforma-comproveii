// supabase/functions/admin-redefinir-senha/index.ts
// Redefine a senha de um usuário via Admin API (auth.users).
// Nunca escreve diretamente em auth.users via SQL.

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
    const { usuario_id, nova_senha } = await req.json()

    if (!usuario_id || !nova_senha) {
      return new Response(
        JSON.stringify({ erro: 'Campos obrigatórios: usuario_id, nova_senha.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (nova_senha.length < 8) {
      return new Response(
        JSON.stringify({ erro: 'A senha deve ter ao menos 8 caracteres.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verificar que o chamador é administrador
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

    // Redefinir senha via Admin API — única forma suportada pelo Supabase Auth
    const clienteAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error: errAuth } = await clienteAdmin.auth.admin.updateUserById(usuario_id, {
      password: nova_senha,
    })

    if (errAuth) {
      return new Response(
        JSON.stringify({ erro: errAuth.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
