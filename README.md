# Anatel Consulta ("anatelseleta")

MVP interno: sobe a planilha CSV de produtos homologados pela Anatel e permite
buscar por número de homologação. Sem AnyMarket, sem categorias, sem
diagnóstico — só consulta.

## Stack

Next.js (App Router) + TypeScript, Tailwind CSS, Prisma 7 + PostgreSQL
(via `@prisma/adapter-pg`).

## Rodando localmente

1. Suba um Postgres descartável. Duas opções, sem depender de serviço externo:

   **Docker:**
   ```bash
   docker run --name anatelbase-dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=anatelbase \
     -p 5432:5432 -d postgres:16
   ```

   **WSL (validado neste projeto — sem Docker):**
   ```bash
   # dentro do terminal do Ubuntu/WSL
   sudo apt update && sudo apt install -y postgresql
   sudo service postgresql start
   sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'dev';"
   sudo -u postgres psql -c "CREATE DATABASE anatelbase;"
   ```
   O WSL2 encaminha `localhost` para o Windows automaticamente — não precisa
   mudar o `.env`. `sudo service postgresql start` não é automático no boot do
   WSL; rode de novo se reiniciar a máquina.

2. O `.env` já aponta para `localhost:5432` (`DATABASE_URL`/`DIRECT_URL`).
   Aplique o schema:

   ```bash
   npx prisma db push
   ```

3. Instale as dependências (se ainda não instalou) e suba o servidor:

   ```bash
   npm install
   npm run dev
   ```

4. Abra [http://localhost:3000](http://localhost:3000). Use um recorte pequeno
   da planilha da Anatel (algumas centenas de linhas) para testar o upload —
   não a planilha completa (~190 mil linhas) em ambiente local.

## Rotas

- `POST /api/importar` — recebe a planilha (`multipart/form-data`, campo
  `arquivo`) e substitui a base inteira.
- `GET /api/homologacao/[numero]` — retorna todas as linhas daquele número.
- `GET /api/importacoes` — dados da última importação (para exibir na tela).
- `GET /health` — healthcheck do portal de deploy.

## Deploy (apps.db1group.com)

Ver `db1app.json` e `Dockerfile` na raiz. Prisma 7 exige `prisma.config.ts`
(sem `url` no `datasource` do `schema.prisma`) — detalhes nos comentários do
próprio `prisma.config.ts`. O container roda `npx prisma db push` antes de
subir o servidor, então o banco de produção nasce vazio: a planilha completa
é importada manualmente pela tela, depois do primeiro deploy.

⚠️ Nome do app pendente de confirmação: usei `"Anatel Consulta"` no
`db1app.json` (gera o subdomínio `anatel-consulta.apps.db1group.com`) porque
`anatel-base.apps.db1group.com` já é usado por outro app. Confirme antes de
publicar.

### Empacotar para upload

```bash
rm -rf .next   # build local não vai no pacote — o Docker gera de novo
python3 scripts/empacotar.py . -o ../anatel-consulta.zip
```

Valida `Dockerfile`, `db1app.json` e ausência de chave de API em código antes
de gerar o `.zip`; só sobe se não houver erro (use `--forcar` para ignorar
avisos). Depois é upload manual em [apps.db1group.com](https://apps.db1group.com).
