'use client';

import { useState, type CSSProperties } from 'react';
import ResultadoBusca from '@/components/ResultadoBusca';
import { consolidar, type LinhaResultado } from '@/lib/lote';
import { classificarRegistros, FONTE, MONO, type Tema } from '@/lib/tema';

type Props = {
  linhas: LinhaResultado[]; // uma por entrada única, na ordem do campo
  t: Tema;
  onExportar: () => void;
  exportando: boolean;
};

type Filtro = 'todas' | 'atencao';

const fmt = (n: number) => n.toLocaleString('pt-BR');
const plural = (n: number, s: string, p: string) => `${fmt(n)} ${n === 1 ? s : p}`;

export default function ResultadoLote({ linhas, t, onExportar, exportando }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [aberta, setAberta] = useState<number | null>(null);

  const numeros = linhas.filter((l) => l.tipo === 'numero');
  const encontrados = numeros.filter((l) => l.registros.length > 0);
  const naoEncontrados = numeros.filter((l) => !l.registros.length);
  const invalidos = linhas.filter((l) => l.tipo === 'invalido');

  const ehAtencao = (l: LinhaResultado) => {
    if (l.tipo !== 'numero' || !l.registros.length) return false;
    const { tipo } = classificarRegistros(l.registros.map((r) => r.situacaoRequerimento));
    return tipo === 'warn' || tipo === 'bad';
  };
  const qtdAtencao = linhas.filter(ehAtencao).length;
  const visiveis = filtro === 'atencao' ? linhas.filter(ehAtencao) : linhas;

  const resumo = [
    plural(numeros.length, 'número', 'números'),
    invalidos.length && plural(invalidos.length, 'inválido', 'inválidos'),
  ]
    .filter(Boolean)
    .join(' · ');

  const pilula = (ativo: boolean): CSSProperties => ({
    background: ativo ? '#0075FF' : 'transparent',
    color: ativo ? '#fff' : t.text,
    border: `1px solid ${ativo ? '#0075FF' : t.line}`,
    borderRadius: 9999,
    padding: '6px 14px',
    font: `600 13px ${FONTE}`,
    cursor: 'pointer',
  });

  const caixa = (bg: string, fg: string): CSSProperties => ({
    padding: '14px 16px',
    borderRadius: 12,
    background: bg,
    color: fg,
    fontSize: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  });

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: t.surface, border: `1px solid ${t.cardBorder}`, borderRadius: 16, padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: `700 22px/1.2 ${FONTE}`, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(encontrados.length)} de {fmt(numeros.length)} encontrados
          </span>
          <span style={{ fontSize: 13, color: t.muted }}>{resumo}</span>
        </div>
        <button
          type="button"
          className="ab-btn-primario"
          onClick={onExportar}
          disabled={exportando}
          style={{ padding: '10px 24px', border: 0, borderRadius: 9999, color: '#fff', font: `600 14px ${FONTE}`, cursor: exportando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {exportando && (
            <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'ab-spin 700ms linear infinite' }} />
          )}
          Exportar planilha
        </button>
      </div>

      {naoEncontrados.length > 0 && (
        <div style={caixa(t.warnBg, t.warnFg)}>
          <strong>
            {fmt(naoEncontrados.length)} número{naoEncontrados.length > 1 ? 's' : ''} não encontrado{naoEncontrados.length > 1 ? 's' : ''} na base Anatel
          </strong>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {naoEncontrados.map((l) => l.tipo === 'numero' && (
              <li key={l.linha}>
                linha {l.linha} · <span style={{ fontFamily: MONO }}>{l.normalizado}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invalidos.length > 0 && (
        <div style={caixa(t.errBg, t.errFg)}>
          <strong>
            {fmt(invalidos.length)} entrada{invalidos.length > 1 ? 's' : ''} com formato inválido
          </strong>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {invalidos.map((l) => l.tipo === 'invalido' && (
              <li key={l.linha}>
                linha {l.linha} · <span style={{ fontFamily: MONO }}>{l.original}</span> — {l.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => setFiltro('todas')} style={pilula(filtro === 'todas')}>
          Todas as linhas
        </button>
        <button type="button" onClick={() => setFiltro('atencao')} style={pilula(filtro === 'atencao')}>
          Só suspensas/canceladas ({fmt(qtdAtencao)})
        </button>
      </div>

      <div style={{ background: t.surface, border: `1px solid ${t.cardBorder}`, borderRadius: 16, overflow: 'hidden' }}>
        {visiveis.length === 0 && (
          <div style={{ padding: '20px 24px', color: t.muted, fontSize: 14 }}>Nenhuma linha suspensa ou cancelada neste lote.</div>
        )}
        {visiveis.map((l, i) => (
          <Linha
            key={l.linha}
            l={l}
            t={t}
            primeira={i === 0}
            aberta={aberta === l.linha}
            onAlternar={() => setAberta(aberta === l.linha ? null : l.linha)}
          />
        ))}
      </div>
    </section>
  );
}

function Linha({ l, t, primeira, aberta, onAlternar }: { l: LinhaResultado; t: Tema; primeira: boolean; aberta: boolean; onAlternar: () => void }) {
  const base: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '44px minmax(0,1fr)',
    alignItems: 'center',
    gap: 12,
    padding: '12px 20px',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    background: 'transparent',
    color: t.text,
    font: `400 14px ${FONTE}`,
  };
  const num = (
    <span style={{ fontVariantNumeric: 'tabular-nums', color: t.muted, fontSize: 12, fontWeight: 600 }}>{l.linha}</span>
  );
  const divisa = primeira ? undefined : `1px solid ${t.line}`;

  if (l.tipo === 'invalido') {
    return (
      <div style={{ ...base, borderTop: divisa }}>
        {num}
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontFamily: MONO }}>{l.original}</span>
          <span style={{ color: t.errFg, fontWeight: 600, fontSize: 13 }}>Formato inválido: {l.motivo}</span>
        </span>
      </div>
    );
  }

  if (!l.registros.length) {
    return (
      <div style={{ ...base, borderTop: divisa }}>
        {num}
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontFamily: MONO, letterSpacing: '0.04em' }}>{l.normalizado}</span>
          <span style={{ color: t.warnFg, fontWeight: 600, fontSize: 13 }}>Não encontrado na base Anatel</span>
        </span>
      </div>
    );
  }

  const { tipo, icone, texto } = classificarRegistros(l.registros.map((r) => r.situacaoRequerimento));
  const [bg, fg] = t.st[tipo];
  const modelos = consolidar(l.registros.map((r) => r.modelo));
  const qtdModelos = new Set(l.registros.map((r) => r.modelo ?? '')).size;

  return (
    <div style={{ borderTop: divisa }}>
      <button type="button" onClick={onAlternar} aria-expanded={aberta} style={{ ...base, border: 0, cursor: 'pointer' }}>
        {num}
        <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: fg, borderRadius: 9999, padding: '3px 10px 3px 4px', fontSize: 12, fontWeight: 700, maxWidth: '100%' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: fg, color: bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{icone}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{texto.replace(/Homologação /g, '')}</span>
          </span>
          <span style={{ fontFamily: MONO, fontWeight: 600, letterSpacing: '0.04em' }}>{l.normalizado}</span>
          <span style={{ color: t.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 200px' }}>
            {consolidar(l.registros.map((r) => r.nomeFabricante))} · <strong style={{ color: t.text }}>{qtdModelos > 1 ? `${qtdModelos} modelos` : modelos}</strong>
          </span>
          <span aria-hidden="true" style={{ color: t.link, fontWeight: 700, marginLeft: 'auto' }}>{aberta ? '−' : '+'}</span>
        </span>
      </button>
      {aberta && (
        <div style={{ padding: '0 20px 16px' }}>
          <ResultadoBusca registros={l.registros} numero={l.normalizado} t={t} />
        </div>
      )}
    </div>
  );
}
