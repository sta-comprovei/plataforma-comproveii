# Supabase — Rastreamento de Reentrega

## 1. Criar o projeto

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
2. Em **Project Settings → API**, copie:
   - `Project URL` → vai em `VITE_SUPABASE_URL`
   - `anon public key` → vai em `VITE_SUPABASE_ANON_KEY`
3. Cole esses valores no arquivo `.env.local` na raiz do projeto (veja `.env.example`).

## 2. Aplicar as migrations

As migrations devem ser aplicadas **em ordem numérica**, do arquivo mais
antigo ao mais recente (`0001_schema_inicial.sql` → ... → o último arquivo
em `supabase/migrations/`). Cada uma é incremental: apenas adiciona/ajusta
o necessário, sem remover nada das anteriores — todas usam `create table
if not exists`, `create or replace function`, etc., então rodar uma
migration que já foi aplicada antes não quebra nada.

Se este é um projeto Supabase **novo** (primeira vez), rode todos os
arquivos, na ordem, do 0001 até o mais recente. Se você já tinha esta
plataforma rodando e só quer aplicar uma atualização (ex.: o módulo de
Reentregas), rode apenas os arquivos novos que ainda não passaram pelo seu
projeto — o nome do arquivo já diz sua posição.

### Opção A — SQL Editor (mais simples, sem precisar de linha de comando)
1. No painel do Supabase, abra **SQL Editor**.
2. Abra cada arquivo de `supabase/migrations/`, na ordem numérica, cole o
   conteúdo inteiro no editor e clique em **Run**. Confira que não apareceu
   erro antes de passar para o próximo arquivo.
3. Repita até chegar ao último arquivo da pasta.

### Opção B — Supabase CLI
```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

## 3. O que as migrations criam

| Objeto | Descrição |
|---|---|
| `usuarios` | Perfil/permissão de cada conta (1:1 com `auth.users`) |
| `motoristas` | Cadastro da frota: código único (case-insensitive), nome, CPF opcional (validado e único quando preenchido), situação |
| `operacoes` | Operação diária de entrega (Etapa 3): data, motorista (com snapshot de código/nome), tipo, rota, placa, entregas previstas/realizadas, percentual gerado automaticamente, cronologia (início/finalização), status, divergência, observações, usuário de criação/última alteração. Coluna `ativa` (Etapa 5) classifica automaticamente cada linha em "Operação do Dia" (`true`) ou "Histórico Operacional" (`false`) |
| `metas_lead_time` | Meta de Lead Time por categoria (Etapa 4), em minutos. 3 linhas fixas (DF, Adega, Filial) populadas com os valores padrão do requisito (8h/4h/5 dias) — `ON CONFLICT DO NOTHING`, preserva customizações em reaplicações da migration |
| `historico_auditoria` | Registro permanente de auditoria: quem alterou, quando e o que mudou. Nunca apagado automaticamente. |
| `historico_importacoes` | Log permanente de toda tentativa de importação de arquivo (Etapa 8) — sucesso, erro de validação ou bloqueio por duplicata. Nunca apagado automaticamente. |
| `arquivos_importados_controle` | Índice de deduplicação por hash SHA-256 do conteúdo do arquivo (não pelo nome) — write-once, sem policy de UPDATE/DELETE para ninguém |
| Trigger `trg_on_auth_user_created` | Cria a linha em `usuarios` automaticamente no signup (perfil padrão: `operador`) |
| Trigger `trg_operacoes_before_write` | Calcula `lead_time_min`, valida motorista (existente e ativo) na criação, preenche `usuario_criacao`/`usuario_ultima_alteracao` automaticamente, e (Etapa 5) classifica `ativa` — `false` quando status indica conclusão E data/hora de finalização estão preenchidas, `true` em qualquer outro caso |
| Trigger `trg_motoristas_before_write` | Normaliza código/nome e valida CPF (dígito verificador) antes de gravar |
| Trigger `trg_metas_lead_time_before_write` | Preenche `usuario_ultima_alteracao` e `updated_at` a cada alteração de meta |
| Trigger `trg_historico_importacoes_before_insert` | Preenche `usuario_id`/`nome_usuario` automaticamente a partir do usuário autenticado (mesmo padrão de `operacoes.usuario_criacao`) |
| Trigger `trg_auditoria_motoristas` / `trg_auditoria_usuarios` / `trg_auditoria_operacoes` / `trg_auditoria_metas_lead_time` / `trg_auditoria_historico_importacoes` | Registra automaticamente toda criação/edição/inativação/reativação/exclusão em `historico_auditoria` |
| `reentregas_notas` (migration 0027) | Reentregas por nota fiscal alinhadas pelo SAC com outro motorista — motorista anterior, motorista atual (nulo enquanto aguarda definição), observação e print opcional. Duas situações: `AGUARDANDO_MOTORISTA` e `REGISTRADA` |
| Bucket de Storage `reentregas-prints` (migration 0027) | Bucket **privado** para os prints de conversa anexados às reentregas. O frontend nunca expõe uma URL pública fixa — sempre gera uma URL assinada temporária (`createSignedUrl`) na hora de exibir a imagem |
| RLS | Habilitado em todas as tabelas — ver políticas no próprio arquivo SQL |

Nenhum dado fictício, usuário de teste ou registro de exemplo é inserido por estes scripts. As 3 linhas de `metas_lead_time` são parâmetros de configuração do sistema (explicitamente citados no requisito da Etapa 4), não registros operacionais simulados — equivalentes aos valores fixos dos enums `tipo_operacao`/`status_operacao` já criados na migration 0001. A migration 0006 não insere nenhum dado — apenas recalcula (backfill cirúrgico, só nas linhas que realmente mudam) a classificação `ativa` de operações já existentes. A migration 0007 também não insere nenhum dado — as duas tabelas começam vazias, populadas apenas por importações reais realizadas pelos usuários.

### Auditando uma nova tabela em etapas futuras

A função `fn_registrar_auditoria()` é genérica — para auditar uma tabela nova
(ex.: uma futura tabela de configurações), basta executar:

```sql
drop trigger if exists trg_auditoria_NOME_DA_TABELA on public.NOME_DA_TABELA;
create trigger trg_auditoria_NOME_DA_TABELA
  after insert or update or delete on public.NOME_DA_TABELA
  for each row execute function public.fn_registrar_auditoria();
```

Nenhuma alteração na função em si é necessária.

## 4. Criar o primeiro usuário administrador

Por segurança, **todo novo cadastro nasce como `operador`**. Para promover o primeiro administrador:

1. Crie a conta normalmente (tela de login → "Entre em contato com o administrador" é só texto institucional; o cadastro de conta em si acontece via Supabase Auth — convide o usuário pelo painel do Supabase em **Authentication → Users → Invite user**, ou habilite signup conforme sua política interna).
2. Depois que a conta existir em `auth.users` (e, automaticamente, em `public.usuarios`), rode no SQL Editor:

```sql
update public.usuarios
set perfil = 'administrador'
where email = 'email-do-admin@suaempresa.com';
```

3. A partir daí, esse usuário pode promover outros diretamente pela tela **Configurações → Usuários** dentro da plataforma (a ser implementada em etapa futura) ou via SQL Editor.

## 5. Autenticação

Este projeto usa **exclusivamente o Supabase Authentication** (e-mail + senha). Não há login mock, não há usuários `admin/admin`. Para liberar a recuperação de senha, garanta que em **Authentication → URL Configuration** o `Site URL` esteja configurado corretamente — o link de redefinição de senha será enviado para esse domínio.
