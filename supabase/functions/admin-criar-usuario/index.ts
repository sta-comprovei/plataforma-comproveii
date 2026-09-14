// supabase/functions/admin-criar-usuario/index.ts
// Cria usuário em auth.users via Admin API e depois insere em public.usuarios.
// Só pode ser chamada por administradores autenticados.

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
    const { nome, email, senha, perfil } = await req.json()

    // Validações básicas
    if (!nome || !email || !senha || !perfil) {
      return new Response(
        JSON.stringify({ erro: 'Campos obrigatórios: nome, email, senha, perfil.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (senha.length < 8) {
      return new Response(
        JSON.stringify({ erro: 'A senha deve ter ao menos 8 caracteres.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cliente com token do usuário chamador (para validar que é admin)
    const authHeader = req.headers.get('Authorization')!
    const clienteUsuario = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verificar que o chamador é administrador
    const { data: perfisData, error: perfilErr } = await clienteUsuario
      .rpc('fn_meu_perfil')
    if (perfilErr || perfisData !== 'administrador') {
      return new Response(
        JSON.stringify({ erro: 'Acesso restrito a administradores.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cliente service_role para Admin API
    const clienteAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verificar e-mail único em public.usuarios antes de criar
    const { data: existe } = await clienteAdmin
      .from('usuarios')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (existe) {
      return new Response(
        JSON.stringify({ erro: 'Este e-mail já está cadastrado.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Criar em auth.users via Admin API
    const { data: novoAuth, error: errAuth } = await clienteAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: senha,
      email_confirm: true, // confirma e-mail automaticamente (sem email de verificação)
    })

    if (errAuth) {
      return new Response(
        JSON.stringify({ erro: errAuth.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const novoId = novoAuth.user.id

    // 2. Inserir em public.usuarios via RPC (valida regras de negócio)
    const { error: errPublic } = await clienteUsuario.rpc('fn_inserir_em_public_usuarios', {
      p_id:     novoId,
      p_nome:   nome.trim(),
      p_email:  email.toLowerCase().trim(),
      p_perfil: perfil,
    })

    if (errPublic) {
      // Rollback: remover de auth.users se a inserção em public falhou
      await clienteAdmin.auth.admin.deleteUser(novoId)
      return new Response(
        JSON.stringify({ erro: errPublic.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ id: novoId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ erro: 'Erro interno: ' + (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
