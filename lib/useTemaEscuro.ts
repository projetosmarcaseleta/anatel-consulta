import { useSyncExternalStore } from 'react';

const CHAVE = 'anatelbase:tema';
const EVENTO = 'anatelbase:tema';

// Fallback em memória para quando o localStorage não está disponível.
let escolhaNaSessao: boolean | null = null;

function ler(): boolean {
  if (escolhaNaSessao !== null) return escolhaNaSessao;
  try {
    return localStorage.getItem(CHAVE) === 'dark';
  } catch {
    return false;
  }
}

function assinar(aoMudar: () => void) {
  window.addEventListener('storage', aoMudar);
  window.addEventListener(EVENTO, aoMudar);
  return () => {
    window.removeEventListener('storage', aoMudar);
    window.removeEventListener(EVENTO, aoMudar);
  };
}

export function useTemaEscuro(): [boolean, () => void] {
  const escuro = useSyncExternalStore(assinar, ler, () => false);
  const alternar = () => {
    escolhaNaSessao = !escuro;
    try {
      localStorage.setItem(CHAVE, escuro ? 'light' : 'dark');
    } catch {
      // storage indisponível — a troca não persiste
    }
    window.dispatchEvent(new Event(EVENTO));
  };
  return [escuro, alternar];
}
