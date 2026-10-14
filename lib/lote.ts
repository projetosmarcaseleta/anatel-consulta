import type { RegistroHomologacao } from '@/lib/types';

export const MAX_ENTRADAS = 500;

export type Entrada =
  | { tipo: 'numero'; original: string; normalizado: string }
  | { tipo: 'invalido'; original: string; motivo: string };

function classificar(original: string): Entrada {
  const digitos = original.replace(/[^0-9]/g, '');
  if (!digitos) return { tipo: 'invalido', original, motivo: 'Sem dígitos' };
  if (digitos.length === 13) return { tipo: 'invalido', original, motivo: '13 dígitos — parece EAN' };
  if (digitos.length > 12) return { tipo: 'invalido', original, motivo: `${digitos.length} dígitos` };
  return { tipo: 'numero', original, normalizado: digitos.padStart(12, '0') };
}

// Uma entrada por linha (coluna do Excel) ou separada por vírgula/ponto e vírgula/espaço
// quando vem tudo numa linha só. Linhas vazias saem; repetidos saem mantendo a primeira
// ocorrência — números comparados pelo normalizado (57991707356 = 057991707356),
// inválidos pelo texto literal.
export function limparEntradas(texto: string): { entradas: Entrada[]; repetidos: number; texto: string } {
  const semCr = texto.replace(/\r/g, '');
  const pedacos = semCr.includes('\n') ? semCr.split('\n') : semCr.split(/[,;\s]+/);
  const vistos = new Set<string>();
  const entradas: Entrada[] = [];
  let repetidos = 0;
  for (const bruto of pedacos) {
    const original = bruto.trim();
    if (!original) continue;
    const e = classificar(original);
    const chave = e.tipo === 'numero' ? `n:${e.normalizado}` : `i:${e.original}`;
    if (vistos.has(chave)) {
      repetidos++;
      continue;
    }
    vistos.add(chave);
    entradas.push(e);
  }
  return { entradas, repetidos, texto: entradas.map((e) => e.original).join('\n') };
}

export function consolidar(valores: (string | null | undefined)[]): string {
  return [...new Set(valores.map((v) => (v ?? '').trim()).filter(Boolean))].join(' | ');
}

export function formatarDataIso(iso: string | null): string {
  // Data de calendário pura: formatar em UTC evita o fuso local jogar o dia para trás.
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
}

export type LinhaResultado =
  | { tipo: 'invalido'; linha: number; original: string; motivo: string }
  | { tipo: 'numero'; linha: number; original: string; normalizado: string; registros: RegistroHomologacao[] };

export function montarLinhas(entradas: Entrada[], porNumero: Record<string, RegistroHomologacao[]>): LinhaResultado[] {
  return entradas.map((e, i): LinhaResultado =>
    e.tipo === 'invalido'
      ? { tipo: 'invalido', linha: i + 1, original: e.original, motivo: e.motivo }
      : { tipo: 'numero', linha: i + 1, original: e.original, normalizado: e.normalizado, registros: porNumero[e.normalizado] ?? [] },
  );
}

export const COLUNAS_PLANILHA = [
  'Entrada',
  'Número de Homologação',
  'Fabricante',
  'Modelo',
  'Nome Comercial',
  'Data de Homologação',
  'Tipo de Produto',
  'País',
  'Status da Homologação',
  'Registros',
] as const;

export const STATUS_NAO_ENCONTRADO = 'Não encontrado na base Anatel';

// Uma linha da planilha por número único; guarda-chuva vira uma linha só, com valores
// distintos juntados por " | " (divergência de status fica visível, nunca escondida).
export function linhaPlanilha(l: LinhaResultado): (string | number | null)[] {
  if (l.tipo === 'invalido') {
    return [l.original, null, null, null, null, null, null, null, `Formato inválido: ${l.motivo}`, null];
  }
  const r = l.registros;
  if (!r.length) {
    return [l.original, l.normalizado, null, null, null, null, null, null, STATUS_NAO_ENCONTRADO, null];
  }
  return [
    l.original,
    l.normalizado,
    consolidar(r.map((x) => x.nomeFabricante)) || null,
    consolidar(r.map((x) => x.modelo)) || null,
    consolidar(r.map((x) => x.nomeComercial)) || null,
    consolidar(r.map((x) => formatarDataIso(x.dataHomologacao))) || null,
    consolidar(r.map((x) => x.tipoProduto)) || null,
    consolidar(r.map((x) => x.paisFabricante)) || null,
    consolidar(r.map((x) => x.situacaoRequerimento)) || null,
    r.length,
  ];
}
