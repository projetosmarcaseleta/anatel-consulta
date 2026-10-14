'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { FONTE } from '@/lib/tema';

type Props = {
  texto: string;
  rotulo: string; // aria-label, ex.: "Copiar fabricante"
  cor: string; // cor do ícone em repouso
  corOk: string; // cor do ícone/texto após copiar
};

type Estado = 'idle' | 'ok' | 'erro';

const DURACAO_MS = 1500;

function copiarComFallback(texto: string): boolean {
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return copiarComFallback(texto);
  }
}

export default function BotaoCopiar({ texto, rotulo, cor, corOk }: Props) {
  const [estado, setEstado] = useState<Estado>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function aoClicar(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation(); // não abre nem fecha o card
    const ok = await copiar(texto.trim());
    setEstado(ok ? 'ok' : 'erro');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setEstado('idle'), DURACAO_MS);
  }

  const corAtual = estado === 'ok' ? corOk : cor;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
      <button
        type="button"
        className="ab-copiar"
        onClick={aoClicar}
        aria-label={rotulo}
        title={rotulo}
        style={{ width: 28, height: 28, borderRadius: '50%', border: 0, padding: 0, background: 'transparent', color: corAtual, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        {estado === 'ok' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </svg>
        )}
      </button>
      <span aria-live="polite" role="status" style={{ font: `600 12px ${FONTE}`, color: corAtual, whiteSpace: 'nowrap' }}>
        {estado === 'ok' ? 'Copiado' : estado === 'erro' ? 'Não foi possível copiar' : ''}
      </span>
    </span>
  );
}
