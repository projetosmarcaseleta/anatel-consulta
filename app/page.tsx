'use client';

import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import AnatelSeletaMark from '@/components/AnatelSeletaMark';
import PainelImportacao, { type UltimaImportacao } from '@/components/PainelImportacao';
import ResultadoBusca from '@/components/ResultadoBusca';
import ResultadoLote from '@/components/ResultadoLote';
import { exportarPlanilha } from '@/lib/exportarPlanilha';
import { limparEntradas, MAX_ENTRADAS, montarLinhas, type LinhaResultado } from '@/lib/lote';
import type { RegistroHomologacao } from '@/lib/types';
import { FONTE, MONO, TEMAS } from '@/lib/tema';
import { useTemaEscuro } from '@/lib/useTemaEscuro';

type StatusBusca = 'idle' | 'loading' | 'notfound' | 'found' | 'lote' | 'aviso' | 'erro';

// A Anatel publica base nova toda semana.
const DIAS_PARA_DESATUALIZAR = 7;
const EXEMPLOS = ['067882207120', '57991707356'];

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function Home() {
  const [dark, alternarTema] = useTemaEscuro();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusBusca>('idle');
  const [buscado, setBuscado] = useState('');
  const [registros, setRegistros] = useState<RegistroHomologacao[]>([]);
  const [linhas, setLinhas] = useState<LinhaResultado[]>([]);
  const [erroBusca, setErroBusca] = useState('');
  const [aviso, setAviso] = useState('');
  const [exportando, setExportando] = useState(false);
  const [erroExport, setErroExport] = useState('');
  // Quantos repetidos saíram do campo desde a última edição manual (colar ou buscar).
  const [repetidosIgnorados, setRepetidosIgnorados] = useState(0);
  const [ultima, setUltima] = useState<UltimaImportacao | null>(null);
  const [ultimaCarregada, setUltimaCarregada] = useState(false);
  const [importAberto, setImportAberto] = useState(false);
  // Sem transição até o tema salvo ser aplicado, para não "borrar" do claro ao escuro ao abrir.
  const [montado, setMontado] = useState(false);

  const t = TEMAS[dark ? 'dark' : 'light'];

  const carregarUltima = useCallback(() => {
    fetch('/api/importacoes')
      .then((r) => r.json())
      .then((d) => setUltima(d.ultima))
      .catch(() => {})
      .finally(() => setUltimaCarregada(true));
  }, []);

  useEffect(() => {
    carregarUltima();
    const quadro = requestAnimationFrame(() => setMontado(true));
    return () => cancelAnimationFrame(quadro);
  }, [carregarUltima]);

  useEffect(() => {
    document.body.style.background = t.bg;
  }, [t.bg]);

  // Ao colar, o campo já fica sem repetidos e sem linhas vazias.
  function aoColar(e: ClipboardEvent<HTMLTextAreaElement>) {
    const colado = e.clipboardData.getData('text/plain');
    if (!colado) return;
    e.preventDefault();
    const el = e.currentTarget;
    const novo = query.slice(0, el.selectionStart) + colado + query.slice(el.selectionEnd);
    const limpo = limparEntradas(novo);
    setQuery(limpo.texto);
    setRepetidosIgnorados(limpo.repetidos);
  }

  async function buscar(texto: string) {
    // Mesma limpeza na busca, para o que foi digitado à mão.
    const limpo = limparEntradas(texto);
    const { entradas } = limpo;
    if (limpo.texto !== texto.trim()) {
      setQuery(limpo.texto);
      if (limpo.repetidos) setRepetidosIgnorados((n) => n + limpo.repetidos);
    }
    if (!entradas.length) return;
    if (entradas.length > MAX_ENTRADAS) {
      setAviso(`São ${entradas.length.toLocaleString('pt-BR')} números diferentes — o máximo é ${MAX_ENTRADAS} por busca. Divida em partes.`);
      setStatus('aviso');
      return;
    }

    const unica = entradas.length === 1 ? entradas[0] : null;
    if (unica?.tipo === 'invalido') {
      setAviso(`"${unica.original}" não é um número de homologação válido: ${unica.motivo}.`);
      setStatus('aviso');
      return;
    }
    if (unica?.tipo === 'numero') {
      setQuery(unica.normalizado);
      setBuscado(unica.normalizado);
    }

    const unicos = [...new Set(entradas.flatMap((e) => (e.tipo === 'numero' ? [e.normalizado] : [])))];
    const montar = (porNumero: Record<string, RegistroHomologacao[]>) => {
      setErroExport('');
      setLinhas(montarLinhas(entradas, porNumero));
      if (unica?.tipo === 'numero') {
        const regs = porNumero[unica.normalizado] ?? [];
        setRegistros(regs);
        setStatus(regs.length ? 'found' : 'notfound');
      } else {
        setStatus('lote');
      }
    };

    // Lote só com inválidos/vazios: nada a consultar, mas a lista (e a planilha) seguem valendo.
    if (!unicos.length) {
      montar({});
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch('/api/homologacao/lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeros: unicos }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.porNumero) {
        setErroBusca(data?.erro ?? `O servidor respondeu HTTP ${res.status}.`);
        setStatus('erro');
        return;
      }
      montar(data.porNumero);
    } catch {
      setErroBusca('Não foi possível falar com o servidor.');
      setStatus('erro');
    }
  }

  async function exportar() {
    setExportando(true);
    setErroExport('');
    try {
      await exportarPlanilha(linhas);
    } catch (e) {
      setErroExport(`Falha ao gerar a planilha: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportando(false);
    }
  }

  const linhasCampo = Math.min(8, Math.max(1, query.replace(/\n+$/, '').split('\n').length));
  const multilinha = linhasCampo > 1;

  const dias = ultima ? diasDesde(ultima.importadoEm) : null;
  const desatualizada = dias !== null && dias > DIAS_PARA_DESATUALIZAR;
  const dataBase = ultima
    ? new Date(ultima.importadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '';
  const chip = !ultimaCarregada
    ? { label: 'Carregando base…', dot: t.inputBorder, borda: t.line }
    : !ultima
    ? { label: 'Nenhuma base importada', dot: t.inputBorder, borda: t.line }
    : desatualizada
      ? { label: `Base de ${dataBase} · desatualizada`, dot: '#F2B01E', borda: '#F2B01E' }
      : { label: `Base de ${dataBase} · atualizada`, dot: '#1E9E54', borda: t.line };

  const cartao = { background: t.surface, borderRadius: 16 } as const;

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: FONTE, transition: montado ? 'background 200ms ease,color 200ms ease' : 'none', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 28px', borderBottom: `1px solid ${t.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AnatelSeletaMark base={t.markBase} burst={t.markBurst} size={34} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>anatelseleta</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => setImportAberto(!importAberto)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.chipBg, border: `1px solid ${chip.borda}`, color: t.text, borderRadius: 9999, padding: '6px 14px', font: `500 13px ${FONTE}`, cursor: 'pointer' }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: chip.dot }} />
            <span>{chip.label}</span>
          </button>
          <button
            type="button"
            onClick={alternarTema}
            title="Alternar tema"
            aria-label="Alternar tema"
            style={{ width: 36, height: 36, borderRadius: '50%', border: `1px solid ${t.line}`, background: 'transparent', color: t.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {dark ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main style={{ flex: 1, width: '100%', maxWidth: 920, margin: '0 auto', padding: '48px 24px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {desatualizada && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 12, background: t.warnBg, color: t.warnFg, fontSize: 14 }}>
            <span>
              <strong>Base desatualizada.</strong> Última importação há {dias} dias — a Anatel já pode ter publicado versão nova.
            </span>
            <button
              type="button"
              onClick={() => setImportAberto(true)}
              style={{ background: 'transparent', border: '1px solid currentColor', color: 'inherit', borderRadius: 9999, padding: '6px 14px', font: `600 13px ${FONTE}`, cursor: 'pointer' }}
            >
              Importar base nova
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar(query);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <label htmlFor="numero" style={{ fontSize: 14, fontWeight: 600, color: t.muted }}>
            Número de homologação <span style={{ fontWeight: 400 }}>— um ou vários, até {MAX_ENTRADAS}</span>
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 240, display: 'flex', alignItems: multilinha ? 'flex-start' : 'center', gap: 12, background: t.surface, border: `1.5px solid ${t.inputBorder}`, borderRadius: multilinha ? 16 : 9999, padding: multilinha ? '14px 22px' : '0 22px', minHeight: 60, boxSizing: 'border-box' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={t.muted} strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: multilinha ? 4 : 0 }}>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <textarea
                id="numero"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setRepetidosIgnorados(0);
                }}
                onPaste={aoColar}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    buscar(query);
                  }
                }}
                placeholder="067882207120"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                rows={linhasCampo}
                style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', color: t.text, font: multilinha ? `500 18px/1.5 ${MONO}` : `500 24px/1.4 ${MONO}`, letterSpacing: '0.06em', resize: 'none', padding: 0, margin: multilinha ? 0 : '14px 0' }}
              />
            </div>
            <button
              type="submit"
              className="ab-btn-primario"
              style={{ height: 60, padding: '0 36px', border: 0, borderRadius: 9999, color: '#fff', font: `600 18px ${FONTE}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {status === 'loading' && (
                <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'ab-spin 700ms linear infinite' }} />
              )}
              <span>{status === 'loading' ? 'Buscando' : 'Buscar'}</span>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 13, color: t.muted }}>
            <span>Exemplos:</span>
            {EXEMPLOS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => buscar(n)}
                style={{ background: 'transparent', border: 0, padding: 0, color: t.link, font: `500 13px ${MONO}`, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {n}
              </button>
            ))}
            {repetidosIgnorados > 0 && (
              <span role="status" style={{ marginLeft: 'auto' }}>
                {repetidosIgnorados.toLocaleString('pt-BR')} {repetidosIgnorados === 1 ? 'repetido ignorado' : 'repetidos ignorados'}
              </span>
            )}
          </div>
        </form>

        {status === 'idle' && (
          <div style={{ padding: '40px 24px', border: `1.5px dashed ${t.line}`, borderRadius: 16, textAlign: 'center', color: t.muted, fontSize: 15, lineHeight: 1.5 }}>
            Cole um número de 12 dígitos — ou uma coluna inteira do Excel — e pressione Enter.
            <br />
            Zeros à esquerda são opcionais. Shift+Enter quebra linha.
          </div>
        )}

        {status === 'loading' && (
          <div style={{ ...cartao, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 28, width: 180, borderRadius: 9999, background: t.skel }} />
            <div style={{ height: 18, width: '60%', borderRadius: 6, background: t.skel }} />
            <div style={{ height: 18, width: '40%', borderRadius: 6, background: t.skel }} />
          </div>
        )}

        {status === 'notfound' && (
          <div style={{ ...cartao, padding: 28, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: `600 20px ${FONTE}` }}>Nenhum resultado encontrado para esse número.</span>
            <span style={{ fontSize: 14, color: t.muted }}>
              Buscado: <span style={{ fontFamily: MONO, color: t.text }}>{buscado}</span> — confira os dígitos ou verifique se a base está atualizada.
            </span>
          </div>
        )}

        {status === 'erro' && (
          <div style={{ padding: '14px 16px', borderRadius: 12, background: t.errBg, color: t.errFg, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong>Não foi possível buscar agora.</strong>
            <span>{erroBusca}</span>
          </div>
        )}

        {status === 'aviso' && (
          <div style={{ padding: '14px 16px', borderRadius: 12, background: t.warnBg, color: t.warnFg, fontSize: 14 }}>{aviso}</div>
        )}

        {status === 'found' && <ResultadoBusca registros={registros} numero={buscado} t={t} />}

        {(status === 'found' || status === 'notfound') && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -12 }}>
            <button
              type="button"
              onClick={exportar}
              disabled={exportando}
              style={{ background: 'transparent', border: 0, padding: 0, color: t.link, font: `600 13px ${FONTE}`, cursor: exportando ? 'wait' : 'pointer' }}
            >
              {exportando ? 'Gerando planilha…' : 'Exportar planilha'}
            </button>
          </div>
        )}

        {status === 'lote' && (
          <ResultadoLote linhas={linhas} t={t} onExportar={exportar} exportando={exportando} />
        )}

        {erroExport && (
          <div style={{ padding: '14px 16px', borderRadius: 12, background: t.errBg, color: t.errFg, fontSize: 14 }}>{erroExport}</div>
        )}
      </main>

      <PainelImportacao
        t={t}
        ultima={ultima}
        aberto={importAberto}
        onAlternar={() => setImportAberto(!importAberto)}
        onConcluida={carregarUltima}
      />
    </div>
  );
}
