# Supabase — Rastreamento de Reentrega

## 1. Criar o projeto

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
2. Em **Project Settings → API**, copie:
   - `Project URL` → vai em `VITE_SUPABASE_URL`
   - `anon public key` → vai em `VITE_SUPABASE_ANON_KEY`
3. Cole esses valores no arquivo `.env.local` na raiz do projeto (veja `.env.example`).

## 2. Aplicar as migrations

Nessa ordem, no **SQL Editor** do painel do Supabase — cole o conteúdo
inteiro de cada arquivo e clique em **Run** antes de passar para o
próximo:

1. `supabase/migrations/0001_schema_inicial.sql` — autenticação e perfis.
2. `supabase/migrations/0002_reentregas_notas.sql` — a tabela de reentregas
   e o bucket de storage dos prints.
3. `supabase/migrations/0003_perfil_visualizador_enum.sql` — adiciona o
   perfil `visualizador` (somente leitura). **Rode sozinho**, sem colar
   junto com o próximo arquivo (o comentário no topo do arquivo explica o
   motivo).
4. `supabase/migrations/0004_perfil_visualizador_rls.sql` — trava
   criação/edição/exclusão para esse perfil.

Todas usam `create table if not exists` / `create or replace function` /
`add value if not exists`, então rodar de novo por engano não quebra nada
(exceto o cuidado de rodar 0003 e 0004 em execuções separadas, explicado
nos próprios arquivos).

### Opção B — Supabase CLI
```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

## 3. O que as migrations criam

| Objeto | Descrição |
|---|---|
| `usuarios` | Perfil de cada conta (1:1 com `auth.users`) — `administrador` (acesso total, inclui excluir), `operador` (registra/edita, não exclui) ou `visualizador` (só enxerga as reentregas, não cria/edita/exclui nada) |
| Trigger `trg_on_auth_user_created` | Cria a linha em `usuarios` automaticamente no signup/convite (perfil padrão: `operador`) |
| `reentregas_notas` | Reentregas por nota fiscal alinhadas pelo SAC com outro motorista — motorista anterior, motorista atual (nulo enquanto aguarda definição), observação e print opcional. Duas situações: `AGUARDANDO_MOTORISTA` e `REGISTRADA` |
| Bucket de Storage `reentregas-prints` | Bucket **privado** para os prints de conversa. O frontend nunca expõe uma URL pública fixa — sempre gera uma URL assinada temporária (`createSignedUrl`) na hora de exibir a imagem |
| RLS | Habilitado em `usuarios` e `reentregas_notas` — ver políticas no próprio arquivo SQL |

Nenhum dado fictício, usuário de teste ou registro de exemplo é inserido por estes scripts.

## 4. Criar o primeiro usuário administrador

Por segurança, **todo novo cadastro nasce como `operador`**.

1. Em **Authentication → Users → Invite user**, convide a primeira conta
   (ou habilite cadastro público conforme sua política interna).
2. Depois que a conta existir em `auth.users` (e, automaticamente, em
   `public.usuarios`), rode no SQL Editor:

```sql
update public.usuarios
set perfil = 'administrador'
where email = 'email-do-admin@suaempresa.com';
```

3. Esse usuário já pode promover outras contas mais tarde, rodando o mesmo
   comando com o e-mail delas.

Para adicionar membros da equipe do SAC depois: **Authentication → Users →
Invite user** de novo — a conta nasce como `operador` automaticamente.

## 5. Dar acesso somente leitura a alguém (perfil visualizador)

Toda conta nasce `operador`. Para deixar alguém só olhando as reentregas
(sem poder criar, editar ou excluir nada — nem os prints), rode:

```sql
update public.usuarios
set perfil = 'visualizador'
where email = 'email-da-pessoa@suaempresa.com';
```

Isso exige que as migrations `0003` e `0004` já tenham sido aplicadas
(passo 2). Para reverter, basta rodar de novo com `perfil = 'operador'`.

## 6. Autenticação

Este projeto usa **exclusivamente o Supabase Authentication** (e-mail + senha).
Para liberar a recuperação de senha, garanta que em **Authentication → URL
Configuration** o `Site URL` esteja configurado com o domínio do Netlify —
é para lá que o link de redefinição de senha será enviado.
