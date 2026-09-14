# Deploy — Rastreamento de Reentrega (Netlify + Supabase, sem GitHub)

Este guia cobre o caminho completo para colocar a plataforma no ar sem usar
GitHub: Supabase para banco de dados/autenticação/arquivos, Netlify para o
site, tudo feito manualmente (painel do Supabase + upload no Netlify).

## 1. Supabase — banco de dados

1. Crie um projeto em [supabase.com](https://supabase.com) (se ainda não tiver um).
2. Em **Project Settings → API**, copie o `Project URL` e a `anon public key`.
3. Abra **SQL Editor** no painel do Supabase e rode, **nesta ordem**, os
   dois arquivos de `supabase/migrations/`:
   1. `0001_schema_inicial.sql` — autenticação e perfis de usuário.
   2. `0002_reentregas_notas.sql` — a tabela de reentregas e o bucket de
      storage privado `reentregas-prints` (onde ficam os prints de
      conversa anexados).
   Cole o conteúdo inteiro de cada um e clique em **Run** antes de passar
   para o próximo. Detalhes de cada tabela: veja `supabase/README.md`.
4. Crie o primeiro usuário administrador:
   - Em **Authentication → Users → Invite user**, crie a conta com o
     e-mail que você vai usar.
   - Depois que a conta existir, rode no SQL Editor:
     ```sql
     update public.usuarios set perfil = 'administrador' where email = 'seu-email@exemplo.com';
     ```
   - Para adicionar a equipe do SAC depois, repita o convite — cada conta
     nasce como `operador` automaticamente (registra e edita, mas não
     exclui reentregas).

## 2. Configurar as variáveis de ambiente locais

1. Copie `.env.example` para `.env.local`.
2. Preencha:
   ```
   VITE_SUPABASE_URL=<Project URL copiado no passo 1>
   VITE_SUPABASE_ANON_KEY=<anon public key copiada no passo 1>
   ```

## 3. Gerar o build

Em um terminal, na raiz do projeto:

```bash
npm install
npm run build
```

Isso cria a pasta `dist/` — é ela que vai para o Netlify.

## 4. Publicar no Netlify — sem GitHub

**Opção A — Deploy manual pelo painel (mais simples)**
1. Acesse [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
2. Arraste a pasta `dist/` (gerada no passo 3) para a área de upload.
3. Pronto — o Netlify já serve o site. `netlify.toml` já está configurado
   com o redirect de SPA (`/* → /index.html`), necessário para as rotas do
   React Router funcionarem.
4. Para atualizar depois: rode `npm run build` de novo e arraste a nova
   `dist/` na mesma tela do site (**Deploys → Drag and drop**).

**Opção B — Netlify CLI (permite `netlify deploy` direto da pasta do projeto)**
```bash
npm install -g netlify-cli
netlify login
netlify init        # cria/associa o site, sem precisar de Git
netlify deploy --prod
```
A CLI usa o `command`/`publish` do `netlify.toml` (`npm run build` → `dist`)
automaticamente.

Em ambas as opções, como o build é feito **localmente** (passo 3), as
variáveis do `.env.local` já ficam embutidas no `dist/` gerado — não é
obrigatório configurar variáveis de ambiente no Netlify. Se preferir que o
Netlify também consiga rebuildar sozinho no futuro, cadastre as mesmas
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` em **Site settings →
Environment variables**.

## 5. Testar

1. Acesse a URL que o Netlify gerou.
2. Faça login com o usuário administrador criado no passo 1.4.
3. Você cai direto na tela **Reentregas**:
   - Aba **Reentregas registradas** → "Nova reentrega" → preencha
     nota fiscal, motorista anterior e atual, cole um print com `Ctrl+V`
     (opcional) → Salvar.
   - Aba **Aguardando motorista** → "Registrar possível reentrega" →
     preencha nota fiscal e motorista anterior (sem motorista atual) →
     Salvar. Depois, use "Atribuir motorista" na linha criada para
     completá-la — ela deve mudar de aba automaticamente.
   - Use a busca no topo para procurar por número de nota.

## Problemas comuns

- **Tela de login não carrega / erro de variável ausente**: confira se
  `.env.local` foi preenchido *antes* de rodar `npm run build` (o Vite
  embute as variáveis no momento do build, não depois).
- **"Row-level security" ao salvar algo**: normalmente é o usuário logado
  sem perfil `ativo = true` em `public.usuarios`, ou uma migration que não
  rodou. Confira a tabela `usuarios` no Supabase.
- **Print não abre / erro ao anexar**: confirme que a migration `0002`
  rodou até o fim (ela cria o bucket `reentregas-prints`) — veja em
  **Storage** no painel do Supabase se o bucket existe.
