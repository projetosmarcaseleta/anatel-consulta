export type RegistroHomologacao = {
  id: number;
  numeroHomologacao: string;
  numeroNormalizado: string;
  nomeFabricante: string | null;
  modelo: string | null;
  nomeComercial: string | null;
  situacaoRequerimento: string | null;
  tipoProduto: string | null;
  paisFabricante: string | null;
  dataHomologacao: string | null;
  importadoEm: string;
};
