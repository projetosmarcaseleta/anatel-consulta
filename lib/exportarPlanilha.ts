import { COLUNAS_PLANILHA, linhaPlanilha, type LinhaResultado } from '@/lib/lote';

const LARGURAS = [18, 18, 40, 30, 24, 14, 45, 22, 30, 10];
// Entrada e Número de Homologação: texto explícito ('@'), senão o Excel apaga o zero à esquerda.
const COLUNAS_TEXTO = new Set([0, 1]);

export async function exportarPlanilha(linhas: LinhaResultado[]) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  const cabecalho = COLUNAS_PLANILHA.map((c) => ({ value: c, fontWeight: 'bold' as const }));
  const corpo = linhas.map((l) =>
    linhaPlanilha(l).map((valor, i) => {
      if (valor === null) return null;
      if (COLUNAS_TEXTO.has(i)) return { value: String(valor), type: String, format: '@' };
      return { value: valor };
    }),
  );

  await writeExcelFile([cabecalho, ...corpo], {
    sheet: 'Consulta',
    columns: LARGURAS.map((width) => ({ width })),
    stickyRowsCount: 1,
  }).toFile(`consulta-homologacao-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
