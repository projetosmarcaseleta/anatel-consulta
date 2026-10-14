import { prisma } from '@/lib/prisma';

export async function GET() {
  const ultima = await prisma.importacao.findFirst({
    orderBy: { importadoEm: 'desc' },
  });

  return Response.json({ ultima });
}
