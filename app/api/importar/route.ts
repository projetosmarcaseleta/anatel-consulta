import { parse } from 'csv-parse/sync';
import { prisma } from '@/lib/prisma';

const TAMANHO_LOTE = 1000;
const COLUNA_NUMERO = 'Número de Homologação';

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('arquivo');

  if (!(file instanceof File)) {
    return Response.json({ erro: 'Nenhum arquivo enviado.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const texto = buffer.toString('utf-8').replace(/^﻿/, '');

  let linhas: Record<string, string>[];
  try {
    linhas = parse(texto, {
      columns: true,
      delimiter: ';',
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (e) {
    const linha = typeof (e as { lines?: unknown }).lines === 'number' ? (e as { lines: number }).lines : undefined;
    return Response.json(
      { erro: 'Não foi possível ler o CSV (esperado: separador ";" e UTF-8).', linha },
      { status: 422 },
    );
  }

  if (linhas.length && !(COLUNA_NUMERO in linhas[0])) {
    const encontradas = Object.keys(linhas[0]).slice(0, 5).join('", "');
    return Response.json(
      { erro: `Coluna "${COLUNA_NUMERO}" não encontrada. Colunas lidas: "${encontradas}"…`, linha: 1 },
      { status: 422 },
    );
  }

  const registros = linhas
    .map((l) => {
      const numero = (l[COLUNA_NUMERO] ?? '').trim();
      const normalizado = numero.replace(/[^0-9]/g, '');
      if (!normalizado) return null;
      return {
        numeroHomologacao: numero,
        numeroNormalizado: normalizado,
        nomeFabricante: l['Nome do Fabricante']?.trim() || null,
        modelo: l['Modelo']?.trim() || null,
        nomeComercial: l['Nome Comercial']?.trim() || null,
        situacaoRequerimento: l['Situação do Requerimento']?.trim() || null,
        tipoProduto: l['Tipo do Produto']?.trim() || null,
        paisFabricante: l['País do Fabricante']?.trim() || null,
        dataHomologacao: parseDataBr(l['Data da Homologação']),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (registros.length === 0) {
    return Response.json(
      { erro: `Nenhuma linha com "${COLUNA_NUMERO}" preenchido.` },
      { status: 422 },
    );
  }

  // Substitui a base inteira numa transação só: enquanto ela roda, a busca
  // continua lendo a base anterior, e se algo falhar no meio nada é alterado.
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.anatelHomologacao.deleteMany({});
        for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
          await tx.anatelHomologacao.createMany({ data: registros.slice(i, i + TAMANHO_LOTE) });
        }
        await tx.importacao.create({
          data: { nomeArquivo: file.name, totalLinhas: registros.length },
        });
      },
      { maxWait: 10_000, timeout: 10 * 60_000 },
    );
  } catch (e) {
    console.error('Falha ao gravar importação', e);
    return Response.json({ erro: 'Falha ao gravar no banco.' }, { status: 500 });
  }

  return Response.json({ ok: true, totalImportado: registros.length });
}

// Datas fora do formato ou impossíveis (ex.: 31/02) viram null em vez de
// derrubar a importação inteira — Date.UTC faria 31/02 "virar" 03/03 em silêncio.
function parseDataBr(s?: string): Date | null {
  const m = s?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(a, mes - 1, d));
  const valida = data.getUTCFullYear() === a && data.getUTCMonth() === mes - 1 && data.getUTCDate() === d;
  return valida ? data : null;
}
