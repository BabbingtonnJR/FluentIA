# FluentIA 流

FluentIA: An AI-powered language learning platform that bridges the gap between grammar and fluency through contextual conversation, adaptive exercises, and deep gamification.

App (PWA) para aprender japonês mais rápido: flashcards com repetição espaçada (FSRS), kanji com ordem dos traços,
áudio, quiz diário, modo mãos-livres e acompanhamento de progresso. Funciona offline e instala no iPhone pela tela inicial.

## Rodar no PC

Requer Node.js 20 ou mais novo.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes automáticos
npm run build      # gera a versão de produção em dist/
```

## Conteúdo

O pacote de japonês fica em `public/packs/ja/` e já vem gerado (3.526 palavras e 612 kanji, do N5 ao N3).
Para regenerar a partir das fontes:

```bash
npm run content:fetch   # baixa as listas para .content-cache/
npm run content:build   # gera public/packs/ja/*.json
node scripts/make-icon.mjs public/packs/ja/strokes.json public/icon.svg
npm run icons           # gera os ícones PNG
```

Fontes e licenças estão em [CREDITS.md](CREDITS.md).

### Outros idiomas

Cada idioma é um pacote em `public/packs/<id>/` com `manifest.json`, `vocab.json` e, opcionalmente, `kanji.json`
(formato em `src/content/types.ts`). Para adicionar um, gere o pacote e registre o id em `AVAILABLE_PACKS`
(`src/content/packs.ts`).

## Publicar (grátis)

1. Suba o projeto para um repositório no GitHub.
2. Na [Vercel](https://vercel.com), importe o repositório. O `vercel.json` já configura tudo.
3. Domínio próprio: em Vercel → Settings → Domains, adicione por exemplo `fluentia.seudominio.com`.
   Na Hostinger, crie o registro **CNAME** `fluentia` apontando para `cname.vercel-dns.com`.

### Instalar no iPhone

Abra o endereço no **Safari** → botão Compartilhar → **Adicionar à Tela de Início**.
Abra o app uma vez com internet para ele guardar o conteúdo; depois funciona offline.

Para o áudio em japonês, o iPhone precisa da voz japonesa: Ajustes → Acessibilidade → Conteúdo Falado → Vozes → Japonês.

## Contas (grátis)

Com o Supabase configurado, o app abre numa tela de login: cada pessoa cria a própria conta e o progresso
fica salvo nela, em qualquer aparelho. Ao sair da conta, o progresso é apagado do aparelho (continua na conta),
então dá para dividir um computador. Sem o Supabase, o app funciona sem login e o progresso fica em cada aparelho.

1. Crie um projeto grátis no [Supabase](https://supabase.com).
2. No SQL Editor, rode o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
3. Em Authentication → Sign In / Providers → Email, **desligue "Confirm email"**: o e-mail grátis do Supabase
   envia só poucos e-mails por hora, o que não dá para uma turma inteira se cadastrar.
4. Em Authentication → URL Configuration, coloque em **Site URL** o endereço do site (por exemplo
   `https://fluentia.vercel.app`), para o link de "Forgot your password?" voltar para o app.
5. Em Project Settings → API, copie a **Project URL** e a chave **anon public**.
6. Coloque as duas em `.env.local` (veja `.env.example`) e, na Vercel, em Settings → Environment Variables
   (depois, faça um novo deploy).

Observação: o plano grátis do Supabase pausa projetos parados por 1 semana. Com uso diário isso não acontece;
se pausar, basta reativar no painel.

## Estrutura

```
src/
  content/   pacotes de idioma, faces dos cartões
  db/        banco local (IndexedDB via Dexie) e operações
  srs/       agendamento FSRS e montagem da fila de estudo
  stats/     sequência de dias, XP, gráficos, atividades diárias
  quiz/      gerador do quiz diário
  sync/      sincronização com Supabase (last-write-wins)
  speech/    voz do navegador (TTS)
  pages/     telas
scripts/     geração do conteúdo e do ícone
supabase/    schema do banco remoto
```
