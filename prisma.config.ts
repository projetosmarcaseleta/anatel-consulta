import { defineConfig } from 'prisma/config';

// O loader de config do Prisma 7 (c12) roda com `dotenv: false` de propósito,
// então .env não é lido antes daqui. Carregamos manualmente para uso local
// (`prisma db push`/`migrate`); em produção o portal injeta DIRECT_URL como
// variável de ambiente real, sem depender de arquivo .env.
try {
  process.loadEnvFile();
} catch {
  // Sem .env (ex.: build da imagem Docker) — segue com process.env como está.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Migrations/db push usam a conexão direta. `env()` do prisma/config lança
  // erro se a variável não existir (o carregamento do config roda com
  // dotenv desligado) — por isso lemos process.env direto, com fallback
  // vazio, para não quebrar o `prisma generate` no build da imagem, onde
  // DIRECT_URL ainda não existe (o portal só injeta as variáveis em runtime).
  datasource: { url: process.env.DIRECT_URL ?? '' },
});
