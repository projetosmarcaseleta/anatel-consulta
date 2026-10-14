import { prisma } from '@/lib/prisma';
import { MAX_ENTRADAS } from '@/lib/lote';

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { numeros?: unknown } | null;
  const bruto = corpo?.numeros;

  if (!Array.isArray(bruto) || bruto.length === 0) {
    return Response.json({ erro: 'Nenhum número informado.' }, { status: 400 });
  }
  if (bruto.length > MAX_ENTRADAS) {
    return Response.json({ erro: `Máximo de ${MAX_ENTRADAS} números por busca.` }, { status: 400 });
  }

  const numeros = [
    ...new Set(
      bruto
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.replace(/\D/g, ''))
        .filter((n) => n.length > 0 && n.length <= 12)
        .map((n) => n.padStart(12, '0')),
    ),
  ];

  // O banco guarda o número como veio no CSV; procura com e sem zeros à esquerda, numa consulta só.
  const variantes = [...new Set(numeros.flatMap((n) => [n, n.replace(/^0+/, '') || '0']))];
  const registros = await prisma.anatelHomologacao.findMany({
    where: { numeroNormalizado: { in: variantes } },
    orderBy: { dataHomologacao: 'desc' },
  });

  const porNumero: Record<string, typeof registros> = Object.fromEntries(numeros.map((n) => [n, []]));
  for (const r of registros) {
    const chave = r.numeroNormalizado.padStart(12, '0');
    porNumero[chave]?.push(r);
  }

  return Response.json({ porNumero });
}
