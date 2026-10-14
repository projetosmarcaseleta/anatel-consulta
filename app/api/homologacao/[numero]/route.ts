import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const normalizado = numero.replace(/[^0-9]/g, '');

  if (!normalizado) {
    return Response.json({ erro: 'Informe um número de homologação.' }, { status: 400 });
  }

  let registros = await prisma.anatelHomologacao.findMany({
    where: { numeroNormalizado: normalizado },
    orderBy: { dataHomologacao: 'desc' },
  });

  // Erro de cadastro comum: número informado sem os zeros à esquerda.
  if (registros.length === 0 && normalizado.length < 12) {
    registros = await prisma.anatelHomologacao.findMany({
      where: { numeroNormalizado: normalizado.padStart(12, '0') },
      orderBy: { dataHomologacao: 'desc' },
    });
  }

  return Response.json({ total: registros.length, registros });
}
