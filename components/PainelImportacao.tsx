'use client';

import { useState } from 'react';
import { FONTE, type Tema } from '@/lib/tema';

export type UltimaImportacao = { nomeArquivo: string; totalLinhas: number; importadoEm: string };

type Erro = { titulo: string; detalhe: string; status: number | null };

type Estado =
  | { fase: 'idle' }
  | { fase: 'enviando'; pct: number }
  | { fase: 'processando' }
  | { fase: 'erro'; erro: Erro }
  | { fase: 'ok'; total: number };

type Props = {
  t: Tema;
  ultima: UltimaImportacao | null;
  aberto: boolean;
  onAlternar: () => void;
  onConcluida: () => void;
};

const fmt = (n: number) => n.toLocaleString('pt-BR');

export function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function enviar(arquivo: File, onProgresso: (pct: number) => void, onEnviado: () => void) {
  return new Promise<{ status: number; corpo: Record<string, unknown> | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/importar');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgresso(e.loaded / e.total);
    };
    xhr.upload.onload = onEnviado;
    xhr.onload = () => {
      let corpo: Record<string, unknown> | null = null;
      try {
        corpo = JSON.parse(xhr.responseText);
      } catch {
        // Resposta não-JSON (ex.: página de erro de proxy) — fica só o status.
      }
      resolve({ status: xhr.status, corpo });
    };
    xhr.onerror = () => reject(new Error('Falha de rede ao enviar o arquivo.'));
    const form = new FormData();
    form.append('arquivo', arquivo);
    xhr.send(form);
  });
}

export default function PainelImportacao({ t, ultima, aberto, onAlternar, onConcluida }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linhasArquivo, setLinhasArquivo] = useState<number | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: 'idle' });

  async function escolher(f: File | null) {
    setArquivo(f);
    setLinhasArquivo(null);
    if (!f) return;
    // Só para exibir "N / total linhas" durante o envio.
    const texto = await f.text();
    let n = 0;
    for (let i = 0; i < texto.length; i++) if (texto.charCodeAt(i) === 10) n++;
    if (texto.length && texto[texto.length - 1] !== '\n') n++;
    setLinhasArquivo(Math.max(0, n - 1));
  }

  async function importar() {
    if (!arquivo) return;
    setEstado({ fase: 'enviando', pct: 0 });
    try {
      const { status, corpo } = await enviar(
        arquivo,
        (pct) => setEstado({ fase: 'enviando', pct }),
        () => setEstado({ fase: 'processando' }),
      );
      if (status >= 200 && status < 300 && corpo) {
        setEstado({ fase: 'ok', total: Number(corpo.totalImportado) });
        onConcluida();
        return;
      }
      const linha = typeof corpo?.linha === 'number' ? corpo.linha : null;
      setEstado({
        fase: 'erro',
        erro: {
          titulo: linha
            ? `Importação falhou na linha ${fmt(linha)} — nada foi alterado.`
            : 'Importação falhou — nada foi alterado.',
          detalhe:
            typeof corpo?.erro === 'string'
              ? `${corpo.erro} A base anterior continua ativa.`
              : status === 413
                ? 'O arquivo é maior do que o servidor aceita. A base anterior continua ativa.'
                : 'O servidor não devolveu detalhes. A base anterior continua ativa.',
          status,
        },
      });
    } catch (e) {
      setEstado({
        fase: 'erro',
        erro: {
          titulo: 'Não foi possível enviar o arquivo — nada foi alterado.',
          detalhe: e instanceof Error ? e.message : String(e),
          status: null,
        },
      });
    }
  }

  const botaoContorno = {
    background: 'transparent',
    border: '1px solid currentColor',
    color: 'inherit',
    borderRadius: 9999,
    padding: '6px 14px',
    font: `600 13px ${FONTE}`,
    cursor: 'pointer',
  } as const;

  const nome = arquivo?.name ?? 'Nenhum arquivo selecionado';
  const pct = estado.fase === 'enviando' ? estado.pct : estado.fase === 'processando' ? 1 : 0;
  const pctTexto = `${Math.round(pct * 100)}%`;

  return (
    <footer style={{ borderTop: `1px solid ${t.line}`, background: t.footBg }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '14px 24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button
          type="button"
          onClick={onAlternar}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'transparent', border: 0, padding: 0, color: t.muted, font: `500 13px ${FONTE}`, cursor: 'pointer', textAlign: 'left' }}
        >
          {ultima ? (
            <span>
              Última importação: <strong style={{ color: t.text }}>{ultima.nomeArquivo}</strong> · {fmt(ultima.totalLinhas)} linhas ·{' '}
              {formatarDataHora(ultima.importadoEm)}
            </span>
          ) : (
            <span>Nenhuma importação realizada ainda.</span>
          )}
          <span style={{ color: t.link, fontWeight: 600 }}>{aberto ? 'Fechar' : 'Importar base nova'}</span>
        </button>

        {aberto && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 10 }}>
            {estado.fase === 'idle' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', border: `1.5px dashed ${t.inputBorder}`, borderRadius: 12, fontSize: 14, cursor: 'pointer', color: t.text }}>
                  <input type="file" accept=".csv" onChange={(e) => escolher(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                  <span style={{ fontWeight: 600, color: t.link }}>Escolher CSV</span>
                  <span style={{ color: t.muted }}>{nome}</span>
                </label>
                <button
                  type="button"
                  className="ab-btn-primario"
                  onClick={importar}
                  disabled={!arquivo}
                  style={{ padding: '10px 24px', border: 0, borderRadius: 9999, color: '#fff', font: `600 14px ${FONTE}`, cursor: arquivo ? 'pointer' : 'not-allowed', opacity: arquivo ? 1 : 0.5 }}
                >
                  Importar
                </button>
              </div>
            )}

            {(estado.fase === 'enviando' || estado.fase === 'processando') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>
                    {estado.fase === 'enviando' ? `Enviando ${nome}` : `Gravando ${nome} no banco…`}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: t.muted }}>
                    {linhasArquivo !== null
                      ? `${fmt(Math.round(pct * linhasArquivo))} / ${fmt(linhasArquivo)} linhas · ${pctTexto}`
                      : pctTexto}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 9999, background: t.skel, overflow: 'hidden' }}>
                  <div
                    className={estado.fase === 'processando' ? 'ab-pulso' : undefined}
                    style={{ height: '100%', width: pctTexto, background: '#0075FF', borderRadius: 9999, transition: 'width 200ms linear' }}
                  />
                </div>
                <span style={{ fontSize: 12, color: t.muted }}>A busca continua disponível com a base anterior até a importação terminar.</span>
              </div>
            )}

            {estado.fase === 'erro' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 12, background: t.errBg, color: t.errFg, fontSize: 14 }}>
                <strong>{estado.erro.titulo}</strong>
                <span>{estado.erro.detalhe}</span>
                <span style={{ fontSize: 12, opacity: 0.85 }}>
                  {estado.erro.status ? `HTTP ${estado.erro.status} · /api/importar` : 'sem resposta · /api/importar'}
                </span>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button type="button" onClick={() => setEstado({ fase: 'idle' })} style={botaoContorno}>
                    Tentar outro arquivo
                  </button>
                </div>
              </div>
            )}

            {estado.fase === 'ok' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 12, background: t.okBg, color: t.okFg, fontSize: 14, fontWeight: 600 }}>
                <span>Importação concluída: {fmt(estado.total)} registros.</span>
                <button type="button" onClick={() => { setArquivo(null); setLinhasArquivo(null); setEstado({ fase: 'idle' }); }} style={botaoContorno}>
                  Importar outro
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}
