import type { CSSProperties } from 'react';
import BotaoCopiar from '@/components/BotaoCopiar';
import type { RegistroHomologacao } from '@/lib/types';
import { formatarDataIso } from '@/lib/lote';
import { classificarRegistros, FONTE, MONO, type Tema } from '@/lib/tema';

type Props = {
  registros: RegistroHomologacao[];
  numero: string;
  t: Tema;
};

const formatarData = (iso: string | null) => formatarDataIso(iso) || '—';

// Nome Comercial quase sempre vem vazio ou igual ao Modelo; repetido lado a lado parece bug.
function nomeDe(r: RegistroHomologacao): string {
  return r.nomeComercial && r.nomeComercial !== r.modelo ? r.nomeComercial : '';
}

export default function ResultadoBusca({ registros, numero, t }: Props) {
  // Registros vêm do mais recente para o mais antigo: o primeiro define a situação atual.
  const f = registros[0];
  const { tipo, icone, veredito, texto: situacao } = classificarRegistros(registros.map((r) => r.situacaoRequerimento));
  const [statusBg, statusFg] = t.st[tipo];

  const vistos = new Set<string>();
  const modelos = registros
    .map((r) => ({ modelo: r.modelo?.trim() ?? '', nome: nomeDe(r).trim() }))
    .filter((m) => {
      const chave = `${m.modelo}|${m.nome}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  const unico = modelos.length === 1;

  const fabricante = f.nomeFabricante?.trim() ?? '';
  // Botão discreto no corpo do card; no cabeçalho colorido, herda a cor da faixa.
  const copiar = (texto: string, rotulo: string) => <BotaoCopiar texto={texto} rotulo={rotulo} cor={t.muted} corOk={t.okFg} />;

  const dt: CSSProperties = { fontSize: 12, fontWeight: 600, color: t.muted, textTransform: 'uppercase', letterSpacing: '.05em' };
  const campo: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

  return (
    <article style={{ background: t.surface, borderRadius: 16, overflow: 'hidden', border: `1px solid ${t.cardBorder}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '18px 24px', background: statusBg, color: statusFg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: statusFg, color: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
            {icone}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ font: `700 22px/1.2 ${FONTE}` }}>{situacao}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{veredito}</span>
          </div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ font: `600 22px ${MONO}`, letterSpacing: '0.08em' }}>{numero}</span>
          <BotaoCopiar texto={numero} rotulo="Copiar número de homologação" cor={statusFg} corOk={statusFg} />
        </span>
      </div>

      <dl style={{ margin: 0, padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '18px 28px' }}>
        <div style={campo}>
          <dt style={dt}>Fabricante</dt>
          <dd style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>
            {fabricante || '—'}
            {fabricante && <> {copiar(fabricante, 'Copiar fabricante')}</>}
          </dd>
        </div>
        {unico && (
          <div style={campo}>
            <dt style={dt}>Modelo</dt>
            <dd style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
              {modelos[0].modelo || '—'}
              {modelos[0].modelo && <> {copiar(modelos[0].modelo, `Copiar modelo ${modelos[0].modelo}`)}</>}
              {modelos[0].nome && (
                <span style={{ display: 'block', fontWeight: 400, fontSize: 14, color: t.muted }}>
                  {modelos[0].nome} {copiar(modelos[0].nome, `Copiar nome comercial ${modelos[0].nome}`)}
                </span>
              )}
            </dd>
          </div>
        )}
        <div style={campo}>
          <dt style={dt}>Data de homologação</dt>
          <dd style={{ margin: 0, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{formatarData(f.dataHomologacao)}</dd>
        </div>
        <div style={campo}>
          <dt style={dt}>Tipo de produto</dt>
          <dd style={{ margin: 0, fontSize: 15, textWrap: 'pretty' } as CSSProperties}>{f.tipoProduto ?? '—'}</dd>
        </div>
        <div style={campo}>
          <dt style={dt}>País</dt>
          <dd style={{ margin: 0, fontSize: 15 }}>{f.paisFabricante ?? '—'}</dd>
        </div>
      </dl>

      {!unico && (
        <div style={{ borderTop: `1px solid ${t.line}`, padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={dt}>{modelos.length} modelos neste certificado</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {modelos.map((m) => (
              <div key={`${m.modelo}|${m.nome}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px 16px', padding: '6px 0', borderBottom: `1px solid ${t.line}` }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 700, fontSize: 16 }}>
                  {m.modelo || '—'}
                  {m.modelo && copiar(m.modelo, `Copiar modelo ${m.modelo}`)}
                </span>
                {m.nome && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 14, color: t.muted }}>
                    {m.nome}
                    {copiar(m.nome, `Copiar nome comercial ${m.nome}`)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
