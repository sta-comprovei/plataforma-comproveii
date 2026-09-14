// supabase/functions/admin-excluir-usuario/index.ts
// Exclui usuário do sistema:
//   1. Valida regras de negócio (último admin, auto-exclusão) via RPC
//   2. Remove de auth.users via Admin API
//   3. Remove de public.usuarios via RPC
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
    const { usuario_id } = await req.json()

    if (!usuario_id) {
      return new Response(
        JSON.stringify({ erro: 'Campo obrigatório: usuario_id.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cliente com token do usuário chamador
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

    // 1. Validar regras de negócio (último admin, auto-exclusão)
    const { error: errValidacao } = await clienteUsuario.rpc('fn_validar_exclusao_usuario', {
      p_usuario_id: usuario_id,
    })

    if (errValidacao) {
      return new Response(
        JSON.stringify({ erro: errValidacao.message }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1b. Buscar snapshot do usuário em public.usuarios para salvar na lixeira
    const { data: snapshotUsuario } = await clienteUsuario
      .from('usuarios')
      .select('*')
      .eq('id', usuario_id)
      .single()

    // 1c. Identificar nome do admin que está executando a ação
    const { data: adminData } = await clienteUsuario.from('usuarios').select('nome, email').eq('id', (await clienteUsuario.auth.getUser()).data.user?.id ?? '').single()
    const nomeAdmin = adminData?.nome || adminData?.email || 'Administrador'

    // 1d. Mover snapshot para a lixeira antes de excluir
    if (snapshotUsuario) {
      const descricao = `Usuário: ${snapshotUsuario.nome} (${snapshotUsuario.email}) [${snapshotUsuario.perfil}]`
      await clienteUsuario.rpc('fn_mover_para_lixeira', {
        p_tabela_origem:    'usuarios',
        p_registro_id:      usuario_id,
        p_descricao:        descricao,
        p_dados_json:       snapshotUsuario,
        p_usuario_exclusao: nomeAdmin,
      })
    }

    // 2. Remover de auth.users via Admin API
    const clienteAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error: errAuth } = await clienteAdmin.auth.admin.deleteUser(usuario_id)

    if (errAuth) {
      return new Response(
        JSON.stringify({ erro: errAuth.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Remover de public.usuarios via RPC
    const { error: errPublic } = await clienteUsuario.rpc('fn_excluir_de_public_usuarios', {
      p_usuario_id: usuario_id,
    })

    if (errPublic) {
      // auth.users já foi removido — logar para investigação manual
      console.error('INCONSISTÊNCIA: auth.users removido mas public.usuarios falhou:', errPublic)
      return new Response(
        JSON.stringify({ erro: 'Usuário removido do Auth mas erro ao limpar dados: ' + errPublic.message }),
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
