export type Tema = {
  bg: string;
  text: string;
  muted: string;
  line: string;
  surface: string;
  cardBorder: string;
  inputBorder: string;
  link: string;
  skel: string;
  chipBg: string;
  footBg: string;
  markBase: string;
  markBurst: string;
  warnBg: string;
  warnFg: string;
  errBg: string;
  errFg: string;
  okBg: string;
  okFg: string;
  st: Record<TipoSituacao, [string, string]>;
};

export type TipoSituacao = 'ok' | 'warn' | 'bad' | 'neu';

export const TEMAS: Record<'light' | 'dark', Tema> = {
  light: {
    bg: '#E9F5FF', text: '#0B1130', muted: '#4A5680', line: 'rgba(57,94,188,.22)', surface: '#FFFFFF',
    cardBorder: 'rgba(138,159,215,.35)', inputBorder: '#8A9FD7', link: '#0075FF', skel: '#DCE6F7',
    chipBg: '#FFFFFF', footBg: 'rgba(255,255,255,.5)', markBase: '#395EBC', markBurst: '#090C18',
    warnBg: '#FFF1D6', warnFg: '#6B4300', errBg: '#FDE3E3', errFg: '#8A1414', okBg: '#DDF5E6', okFg: '#0E5A2C',
    st: { ok: ['#1E9E54', '#FFFFFF'], warn: ['#F2B01E', '#2E1F00'], bad: ['#D13434', '#FFFFFF'], neu: ['#8A9FD7', '#0B1130'] },
  },
  dark: {
    bg: '#010D3D', text: '#FFFFFF', muted: '#A9B8E3', line: 'rgba(138,159,215,.22)', surface: '#0A1A55',
    cardBorder: 'rgba(138,159,215,.25)', inputBorder: '#395EBC', link: '#5AA8FF', skel: '#16296B',
    chipBg: '#0A1A55', footBg: 'rgba(0,0,0,.18)', markBase: '#8A9FD7', markBurst: '#FFFFFF',
    warnBg: '#3A2A05', warnFg: '#FFD27A', errBg: '#4A0F16', errFg: '#FFB3B3', okBg: '#0B3A22', okFg: '#9BE8B8',
    st: { ok: ['#1E9E54', '#FFFFFF'], warn: ['#F2B01E', '#2E1F00'], bad: ['#E04848', '#FFFFFF'], neu: ['#395EBC', '#FFFFFF'] },
  },
};

export function classificarSituacao(s: string | null): [TipoSituacao, string, string] {
  const v = s ?? '';
  if (/Emitida/i.test(v)) return ['ok', '✓', 'Válida — pode publicar'];
  if (/Suspensa/i.test(v)) return ['warn', '!', 'Atenção — não publicar até regularizar'];
  if (/Cancelada|Anulada/i.test(v)) return ['bad', '✕', 'Inválida — não publicar'];
  return ['neu', '•', 'Sem decisão final'];
}

const GRAVIDADE: Record<TipoSituacao, number> = { ok: 0, neu: 1, warn: 2, bad: 3 };

// Vários registros no mesmo número: a cor segue a situação mais grave, e se elas
// divergem o texto mostra todas — divergência é justamente o que o analista precisa ver.
export function classificarRegistros(situacoes: (string | null)[]): {
  tipo: TipoSituacao;
  icone: string;
  veredito: string;
  texto: string;
} {
  const distintas = [...new Set(situacoes.map((s) => (s ?? '').trim()).filter(Boolean))];
  if (!distintas.length) {
    const [tipo, icone, veredito] = classificarSituacao(null);
    return { tipo, icone, veredito, texto: 'Situação não informada' };
  }
  const pior = distintas
    .map((s) => classificarSituacao(s))
    .reduce((a, b) => (GRAVIDADE[b[0]] > GRAVIDADE[a[0]] ? b : a));
  const [tipo, icone, veredito] = pior;
  return {
    tipo,
    icone,
    veredito: distintas.length > 1 ? `Situações divergentes — ${veredito.toLowerCase()}` : veredito,
    texto: distintas.join(' | '),
  };
}

export const FONTE = "'Plus Jakarta Sans',sans-serif";
export const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
