#!/usr/bin/env python3
"""Valida e empacota um projeto para o Portal de Deploy DB1.

Verifica os pre-requisitos do portal (Dockerfile na raiz com EXPOSE, ausencia
de escuta em 127.0.0.1, limites de tamanho/quantidade), a DECLARACAO DE
GOVERNANCA (db1app.json) e a ausencia de chave de API em arquivo de codigo. Se
tudo estiver OK, gera um .zip pronto para upload em https://apps.db1group.com.

As duas checagens de governanca sao ERRO e nao aviso, porque no portal elas sao
recusa — 400 para a declaracao (sem_declaracao / declaracao_invalida) e 422 para
segredo em codigo. Achar aqui custa segundos, achar la custa um ciclo de build.

Uso:
    python empacotar.py <caminho-do-projeto> [-o saida.zip] [--forcar]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import os
import re
import sys
import zipfile
from pathlib import Path

# Limites do portal
MAX_ZIP_MB = 50
MAX_UNZIP_MB = 300
MAX_FILES = 5000
MAX_DEPTH = 20

# ── Governanca ─────────────────────────────────────────────────────────────
ARQUIVO_DECLARACAO = "db1app.json"
ALCANCES = ("pessoal", "nomeados", "time", "unidade", "db1")
# A escada, para comparar dois alcances. `pessoal` e `nomeados` EMPATAM em 0 —
# trocar um pelo outro nao e' subir nem descer, e tratar como descida faria a
# guarda do A-089 acusar quem so trocou de forma de nomear.
ORDEM_ALCANCE = {"pessoal": 0, "nomeados": 0, "time": 1, "unidade": 2, "db1": 3}
CATEGORIAS = (
    "operacao", "analise", "atendimento", "automacao",
    "integracao", "interno_ti", "experimento",
)
FATORES = (
    "altera_outra_app", "expoe_api", "tem_llm",
    "dado_sensivel", "credencial_servico", "sem_identidade",
)
# Gemeo de IDENTIDADES em src/upload/ler-db1app.ts. `db1` faz o portal criar a
# identidade no Keycloak e injetar OIDC_* no container.
IDENTIDADES = ("nenhuma", "db1")
# Gemeos de MAX_CONCESSOES e do regex em src/upload/ler-db1app.ts. Se um lado
# mudar, o outro tem de mudar — validar aqui mais frouxo que o portal manda a
# pessoa colidir com um 400 depois do upload, que e o pior dos dois mundos.
MAX_CONCESSOES = 50
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ── O CRUZAMENTO `alcance` x LISTA (`20` A-087) ────────────────────────────
# Gemeos de CONC_PISO / MSG_NOMEADOS_VAZIO / MSG_PESSOAL_COM_TIMES /
# msgPessoalComNomeados em src/upload/ler-db1app.ts. E o portao do A-075: os
# dois lados recusam o mesmo conjunto, com a MESMA frase (a diferenca de ACENTO
# e a convencao deste arquivo, e o teste dos dois lados compara sem acento).
#
# 🔴 QUAL DEFEITO ISTO IMPEDE: responder ao Claude "voce e pessoas que voce
# nomear" tinha de virar DOIS campos — `alcance: "nomeados"` E a lista
# `pessoas` —, e nada em lugar nenhum cruzava os dois: cada validador olhava o
# seu campo e ia embora. Medido em 01/09: nos dois deploys por token daquele
# dia o pacote chegou `alcance: "pessoal"` com ZERO concessoes — nem o alcance
# escolhido, nem a lista.
CONC_PISO = 2
MSG_NOMEADOS_VAZIO = (
    '"alcance": "nomeados" exige pelo menos um nome em "pessoas" ou "times" — '
    '"nomeados" sem ninguem nomeado nao diz quem entra. Escreva a lista de quem vai '
    'usar o app, ou escolha o alcance que descreve a verdade ("pessoal" se e so voce).'
)


# 🔴 UMA SUBARVORE NAO E UMA PESSOA, e esta frase existe porque a primeira
# versao contava as duas listas juntas: `pessoal` + `times: [gestor]` era UMA
# entrada, passava por baixo de qualquer piso, e era uma equipe inteira sob
# "so eu" — exatamente o que a guarda existe para pegar. `times` tem regua
# DEFINICIONAL: qualquer lista nao-vazia sob `pessoal` e incoerente, porque nao
# existe subarvore que seja favor pontual, e o alcance que descreve isso ja se
# chama `time`.
#
# 🔑 E esta e a UNICA das tres frases em que os dois lados recusam EXATAMENTE o
# mesmo conjunto: ela nao depende de saber quem e o dono.
MSG_PESSOAL_COM_TIMES = (
    '"alcance": "pessoal" quer dizer "so quem publicou", e "times" nomeia subarvores '
    "inteiras do organograma — um time nao e uso pessoal, nem quando o topo da "
    "subarvore e voce mesmo: a sua subarvore e o seu time, nao voce. Use "
    '"alcance": "time" se e o seu time, ou "nomeados" para manter a lista como esta.'
)


def _msg_pessoal_com_nomeados(quantos: int) -> str:
    """`quantos` e quanta gente o ARQUIVO nomeia em `pessoas`, dos dois lados.

    A frase dizia "N pessoas alem de quem publica" e era um off-by-one AQUI: o
    portal subtraia o dono antes de contar e este script nao sabe quem ele e,
    entao a mesma lista de 14 nomes saia "13" la e "14" aqui. A subtracao decide
    SE recusa; ela nao entra no numero mostrado, senao as duas frases divergem e
    o portao do A-075 vira teatro.
    """
    return (
        '"alcance": "pessoal" quer dizer "so quem publicou", e este arquivo nomeia '
        f'{quantos} pessoas em "pessoas" — isso e grupo, nao uso pessoal. '
        'Use "alcance": "nomeados", que existe exatamente para este caso; a lista continua '
        "a mesma e ninguem e removido."
    )


def _lista_crua(d: dict, campo: str) -> list[str]:
    """Os itens aproveitaveis de `pessoas`/`times`, sem repeticao.

    Aproveitavel = texto nao vazio. A FORMA de e-mail e problema de
    `_validar_emails`, e checar duas vezes daria dois motivos para um erro so.
    """
    v = d.get(campo)
    if not isinstance(v, list):
        return []
    fora = []
    for x in v:
        if isinstance(x, str) and x.strip():
            e = x.strip().lower()
            if e not in fora:
                fora.append(e)
    return fora


def _checar_coerencia_nomeados(d: dict, listas_recusadas: bool = False) -> list[str]:
    """O PAR `alcance` x lista, que nenhum dos dois lados olhava (`20` A-087).

    DUAS REGUAS, porque sao duas coisas. `times` sao subarvores (ver
    MSG_PESSOAL_COM_TIMES acima): qualquer uma sob `pessoal` e incoerente, e o
    dono NAO e subtraido dela — em `pessoas` o proprio e-mail e redundancia
    ("eu mesmo"), em `times` e a subarvore ABAIXO dele, que e o time e nao ele.

    🔑 SUBTRAIR O DONO DE `pessoas` NAO E DETALHE — e aqui NAO HA DONO. Medido
    na `.157` em 01/09, o app `aceno` declara `pessoal` com uma lista de UM
    e-mail em `pessoas`: o do proprio dono. `pessoal` + o dono e redundante, nao
    incoerente. O portal sabe quem publica (`ownerEmail` do `app_ownership`) e
    subtrai antes de contar; este script roda na maquina de quem empacota e nao
    sabe.

    🔴 A saida NAO e desligar a guarda deste lado — guarda que nunca dispara e
    o erro silencioso. O piso sobe para `CONC_PISO + 1`, e e ARITMETICA: no
    maximo UM dos nomeados pode ser o dono, entao tres nomes garantem >= 2
    depois de subtrair quem quer que ele seja.

    ⚠️ ENTAO "os dois lados recusam o mesmo conjunto" vale INTEIRO para a guarda
    do `nomeados` vazio e para a de `times`, que nao dependem do dono. Para a de
    `pessoas`, este lado e deliberadamente o MAIS FROUXO: tudo que ele recusa o
    portal tambem recusa, nunca o contrario. E a direcao segura — a skill jamais
    barra um pacote que o portal aceitaria, que seria recusar o deploy de alguem
    por engano.

    ⚠️ `listas_recusadas` vem de `_validar_emails` e suprime o cruzamento
    INTEIRO: com a lista recusada, "nomeados sem ninguem nomeado" seria falso
    (havia gente, e ela foi rejeitada na validacao) e mandaria a pessoa
    consertar a coisa errada. O portal suprime so o ramo do `nomeados` vazio,
    porque le as listas ja validadas; suprimir tudo aqui deixa este lado mais
    frouxo, que e a direcao permitida.

    ⚠️ E `pessoas`/`times` SOMAM legitimamente a `time`/`unidade`/`db1` — o caso
    "meu time + o time do Financeiro + a Layza" do `05` §3.1.1. A incoerencia e
    so com `pessoal`.
    """
    if listas_recusadas:
        return []
    pessoas = _lista_crua(d, "pessoas")
    times = _lista_crua(d, "times")
    alcance = d.get("alcance")
    if alcance == "nomeados" and not pessoas and not times:
        return [MSG_NOMEADOS_VAZIO]
    if alcance == "pessoal":
        if times:
            return [MSG_PESSOAL_COM_TIMES]
        if len(pessoas) >= CONC_PISO + 1:
            return [_msg_pessoal_com_nomeados(len(pessoas))]
    return []


# ── O modelo de papel DENTRO do app (DB1-Apps/18 §2) ───────────────────────
# Gemeos de EFEITOS / MAX_PERMISSOES / MAX_PAPEIS / CHAVE_RE em
# src/upload/ler-db1app.ts::lerModelo(). Mesma regra dos outros gemeos deste
# arquivo: se um lado mudar, o outro tem de mudar.
#
# ✅ ISTO APLICA, e o comentario anterior aqui dizia o contrario. Ele afirmava
# que o gateway nao envia X-DB1-Perms, que o portal nao provisiona papel no
# Keycloak e que nao existe tela para atribuir. As tres foram medidas e sao
# falsas desde agosto: o header sai em HOMOLOG (GATEWAY_PERMS=injetar, provado
# por evento real em 20/08 e com forja barrada), o papel e' provisionado nos DOIS
# ambientes (PAPEL_NO_IDP=true) e viaja no token em resource_access, e a tela e'
# POST/DELETE /api/apps/:uuid/papeis com o painel #detail-papeis dentro de
# Acesso. Corrigido em 24/08, junto com referencias/permissoes.md, que abria com
# o mesmo aviso velho — e cujo custo medido foi um atendimento respondendo "nao
# da' para atribuir papel" e um app real subindo sem papel porque a pagina
# mandava nao propor o assunto.
#
# O que se confere aqui continua sendo a FORMA — o portal RECUSA modelo
# malformado (400 · declaracao_invalida), e um 400 depois do build e' o pior
# lugar para descobrir uma chave digitada errado.
EFEITOS = ("ler", "escreve", "irreversivel")
MAX_PERMISSOES = 50
MAX_PAPEIS = 20
CHAVE_RE = re.compile(r"^[a-z][a-z0-9]*(?:[:._-][a-z0-9]+)*$")


def _modelo_bruto(d: dict) -> tuple:
    """Le o modelo dos DOIS lugares onde ele pode estar, como o portal faz.

    A skill manda escrever dentro de `ficha`, e e' onde o dado sobrevive. Mas o
    leitor do portal aceita o topo tambem e normaliza, e a intuicao de quem
    escreve a mao manda no topo. Conferir so' um dos dois deixaria passar
    exatamente o arquivo que o portal recusa."""
    ficha = d.get("ficha")
    ficha = ficha if isinstance(ficha, dict) else {}
    perms = ficha.get("permissoes")
    if perms is None:
        perms = d.get("permissoes")
    papeis = ficha.get("papeis")
    if papeis is None:
        papeis = d.get("papeis")
    return perms, papeis


def _chave_de(o: dict, onde: str, erros: list) -> str | None:
    v = o.get("chave")
    if not isinstance(v, str) or not v.strip():
        erros.append(f'{onde}: "chave" e obrigatoria e precisa ser texto')
        return None
    chave = v.strip().lower()
    if len(chave) > 60 or not CHAVE_RE.match(chave):
        erros.append(
            f'{onde}: "chave" invalida: {json.dumps(v)} — use minusculas no '
            "formato verbo:recurso, ex.: view:relatorio"
        )
        return None
    return chave


def validar_modelo(d: dict) -> list[str]:
    """Erros do modelo `permissoes`/`papeis`. App sem modelo e' o caso normal."""
    perms_bruto, papeis_bruto = _modelo_bruto(d)
    if perms_bruto is None and papeis_bruto is None:
        return []

    erros: list[str] = []
    vistas: set[str] = set()

    if perms_bruto is not None:
        if not isinstance(perms_bruto, list):
            erros.append(
                f'"permissoes" precisa ser uma lista — recebido {type(perms_bruto).__name__}'
            )
        elif len(perms_bruto) > MAX_PERMISSOES:
            erros.append(f'"permissoes" tem {len(perms_bruto)} itens; o teto e {MAX_PERMISSOES}')
        else:
            for i, item in enumerate(perms_bruto):
                onde = f"permissoes[{i}]"
                if not isinstance(item, dict):
                    erros.append(f'{onde}: precisa ser um objeto com "chave" e "efeito"')
                    continue
                chave = _chave_de(item, onde, erros)
                if chave is None:
                    continue
                if chave in vistas:
                    # Duplicada nao e' aviso: qual das duas descreveria a
                    # permissao na tela de conceder?
                    erros.append(f'{onde}: "chave" duplicada: {chave}')
                    continue
                # `efeito` e' OBRIGATORIO. E' o campo que a porta do 18 §4.4 le, e
                # cair num default silencioso ("ler") faria uma permissao
                # IRREVERSIVEL passar por inocua — o erro no lado caro.
                efeito = item.get("efeito")
                if efeito not in EFEITOS:
                    erros.append(
                        f'{onde}: "efeito" e obrigatorio e precisa ser um de: '
                        f'{", ".join(EFEITOS)} — recebido {json.dumps(efeito)}'
                    )
                    continue
                vistas.add(chave)

    if papeis_bruto is not None:
        if not isinstance(papeis_bruto, list):
            erros.append(
                f'"papeis" precisa ser uma lista — recebido {type(papeis_bruto).__name__}'
            )
        elif len(papeis_bruto) > MAX_PAPEIS:
            erros.append(f'"papeis" tem {len(papeis_bruto)} itens; o teto e {MAX_PAPEIS}')
        else:
            chaves_papel: set[str] = set()
            ja_tem_padrao = False
            for i, item in enumerate(papeis_bruto):
                onde = f"papeis[{i}]"
                if not isinstance(item, dict):
                    erros.append(f'{onde}: precisa ser um objeto com "chave" e "permissoes"')
                    continue
                chave = _chave_de(item, onde, erros)
                if chave is None:
                    continue
                if chave in chaves_papel:
                    erros.append(f'{onde}: "chave" de papel duplicada: {chave}')
                    continue
                lista = item.get("permissoes")
                if not isinstance(lista, list):
                    erros.append(f'{onde}: "permissoes" precisa ser uma lista de chaves')
                    continue
                for p in lista:
                    if not isinstance(p, str):
                        erros.append(
                            f'{onde}: "permissoes" tem item que nao e texto: {json.dumps(p)}'
                        )
                        continue
                    # Papel que concede chave inexistente nao faz NADA — e na tela
                    # ele aparece como um papel legitimo. E' erro de digitacao que
                    # so' se descobriria concedendo, entao o portal recusa (400).
                    if p.strip().lower() not in vistas:
                        erros.append(
                            f'{onde}: "{p.strip().lower()}" nao esta declarada em "permissoes"'
                        )
                if item.get("padrao") is True:
                    if ja_tem_padrao:
                        # A tela pre-seleciona UM. Com dois, qual?
                        erros.append(f'{onde}: mais de um papel marcado como "padrao"')
                        continue
                    ja_tem_padrao = True
                chaves_papel.add(chave)

    return erros


def avisar_modelo(d: dict) -> list[str]:
    """Avisos do modelo — o que o portal aceita mas enfraquece a decisao."""
    perms_bruto, _ = _modelo_bruto(d)
    if not isinstance(perms_bruto, list):
        return []

    def _vazio(p: dict, campo: str) -> bool:
        return not str(p.get(campo) or "").strip()

    validos = [p for p in perms_bruto if isinstance(p, dict) and p.get("chave")]
    avisos = []

    sem_desc = [p["chave"] for p in validos if p.get("efeito") == "irreversivel" and _vazio(p, "descricao")]
    if sem_desc:
        avisos.append(
            '"efeito": "irreversivel" sem "descricao": ' + ", ".join(json.dumps(c) for c in sem_desc)
            + ". O portal aceita, mas `irreversivel` e' o unico efeito que diz "
            "'nao ha desfazer' — e quem for conceder vai decidir sem ter o que "
            "ler. Descreva O QUE nao tem volta."
        )

    sem_evid = [p["chave"] for p in validos if _vazio(p, "evidencia")]
    if sem_evid:
        avisos.append(
            'permissao sem "evidencia" (arquivo:linha): '
            + ", ".join(json.dumps(c) for c in sem_evid)
            + ". A chave tem de vir do CODIGO, nunca inventada — sem apontar onde "
            "ela e' comparada, a descricao da permissao e' opiniao."
        )
    return avisos

# Os mesmos padroes que o portal usa para RECUSAR (422). Mantidos em sincronia
# com src/upload/detect-fatores.ts — se um lado mudar, o outro tem de mudar.
SEGREDO_CODIGO_RE = re.compile(
    "|".join([
        r"sk-ant-[A-Za-z0-9_-]{16,}",
        r"sk-(?:proj-)?[A-Za-z0-9_-]{16,}",
        r"ghp_[A-Za-z0-9]{20,}",
        r"glpat-[A-Za-z0-9_-]{16,}",
        r"AKIA[0-9A-Z]{16}",
        r"xox[baprs]-[A-Za-z0-9-]{10,}",
        r"AIza[0-9A-Za-z_-]{30,}",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
        r"postgres(?:ql)?://[^:\s]+:[^@\s]{4,}@",
    ])
)
# So arquivo de CODIGO. O `.env` fica de fora de proposito: chave ali e'
# ESPERADA (o pacote leva o .env), e confundir os dois recusaria metade dos
# projetos legitimos.
SUFIXOS_CODIGO = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json", ".yml", ".yaml", ".go", ".rb", ".php", ".java", ".cs", ".sh")
NAO_VARRER = ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", ARQUIVO_DECLARACAO)


def avisar_declaracao(raiz: Path) -> list[str]:
    """Avisos do db1app.json — coisas que nao bloqueiam mas enfraquecem.

    Nao ha como um script saber se um HUMANO respondeu as perguntas. O que da'
    para checar e' se o que SUSTENTA o controle esta presente:

    - sem `declarado_por`, a declaracao nao tem autor, e o valor dela e' ser de
      alguem;
    - sem `descricao`, quem aprova nao tem o que ler.

    🔴 FALTAR `detectado` NAO E' AVISO, e ja foi (achado do DB1-Apps/18 §5.2). O
    portal NAO usa esse campo para calcular divergencia: ele grava a deteccao que
    ele mesmo rodou sobre a arvore extraida, porque o arquivo e' editavel a mao e
    a arvore nao. Preencher `detectado` e' rascunho opcional — avisar da falta
    dele ensinava ao agente exatamente o contrario do que o portal faz. O texto
    certo esta em referencias/declaracao.md §3.
    """
    p = raiz / ARQUIVO_DECLARACAO
    if not p.is_file():
        return []
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(d, dict):
        return []

    avisos = []
    if isinstance(d.get("detectado"), dict) and d.get("detectado") == d.get("fatores"):
        # Nao e' erro — podem concordar de verdade. Mas vale um olhar quando os
        # dois fatores de confianca BAIXA batem exatamente, porque sao os que
        # nenhum scanner determina.
        avisos.append(
            '"detectado" e "fatores" sao identicos. Pode ser verdade — mas '
            "confirme que `dado_sensivel` e `sem_identidade` foram PERGUNTADOS, "
            "nao copiados: nenhum scanner determina esses dois."
        )
    if not d.get("declarado_por"):
        avisos.append(f'{ARQUIVO_DECLARACAO} sem "declarado_por" — a declaracao nao tem autor.')
    if not d.get("descricao"):
        avisos.append(
            f'{ARQUIVO_DECLARACAO} sem "descricao" — e' + "' o primeiro campo que "
            "quem aprova le. Sem ela a decisao vira carimbo."
        )
    avisos += avisar_modelo(d)
    return avisos


def validar_declaracao(raiz: Path) -> list[str]:
    """Erros do db1app.json. Lista vazia = declaracao aceita pelo portal."""
    p = raiz / ARQUIVO_DECLARACAO
    if not p.is_file():
        return [
            f"{ARQUIVO_DECLARACAO} ausente na raiz. E a declaracao de governanca "
            "(alcance, fatores, uso de LLM) e sem ela o portal recusa o envio. "
            "Veja a secao 'Governanca' da skill."
        ]
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"{ARQUIVO_DECLARACAO} nao e JSON valido: {e}"]
    if not isinstance(d, dict):
        return [f"{ARQUIVO_DECLARACAO} nao e um objeto JSON"]

    erros = []
    if d.get("alcance") not in ALCANCES:
        erros.append(
            f'"alcance" precisa ser um de: {", ".join(ALCANCES)} — recebido '
            f"{json.dumps(d.get('alcance'))}. E o unico campo sem default: e' "
            "intencao humana, pergunte."
        )
    fatores = d.get("fatores")
    if not isinstance(fatores, dict):
        erros.append('"fatores" precisa ser um objeto com os seis fatores')
    else:
        faltando = [f for f in FATORES if f not in fatores]
        if faltando:
            # Ausente conta como false no portal, mas silencio nao e' resposta:
            # o valor tem de ter sido PERGUNTADO a alguem.
            erros.append(
                "fatores nao respondidos (o portal assume false, mas a resposta "
                f"tem de ser da pessoa): {', '.join(faltando)}"
            )
        if fatores.get("tem_llm") and not d.get("llm"):
            erros.append('"tem_llm" e true mas falta "llm" com provedor/modelos')
    # ┌─ AUSENTE tambem e recusa, nos DOIS campos abaixo ────────────────────┐
    # │ Validar so o valor ERRADO e deixar o AUSENTE passar faz a skill montar │
    # │ pacote que o portal recusa com 400 · declaracao_invalida. Medido em    │
    # │ producao em 28/08: 10 recusas em 44 minutos, 9 apps distintos, um      │
    # │ deles tentando 3 vezes. `categoria` e obrigatoria no portal desde      │
    # │ 27/08 e `health_check_path` desde 28/08 — este validador ficou atras   │
    # │ das duas datas.                                                       │
    # └───────────────────────────────────────────────────────────────────────┘
    cat = d.get("categoria")
    if not isinstance(cat, str) or not cat.strip():
        erros.append(f'"categoria" e obrigatoria. Use uma de: {", ".join(CATEGORIAS)}')
    elif cat not in CATEGORIAS:
        erros.append(f'"categoria" desconhecida: {cat}. Use uma de: {", ".join(CATEGORIAS)}')
    hc = d.get("health_check_path")
    if not isinstance(hc, str) or not hc.strip() or not hc.strip().startswith("/"):
        erros.append(
            '"health_check_path" e obrigatorio: uma rota leve (ex.: "/health") que '
            "so' devolve 200 quando o app esta pronto para receber trafego. Sem ela "
            "o Coolify troca o container sem confirmar que o novo esta saudavel. "
            'Precisa comecar com "/".'
        )
    # `identidade` ausente = "nenhuma" no portal, e isso e' um default seguro (e o
    # estado de todos os apps hoje). Mas valor ESCRITO E ERRADO e' recusa (400), e
    # nao default silencioso: quem escreveu "sso" queria login e nao vai receber,
    # e cair no default deixaria o app subir ABERTO parecendo protegido.
    ident = d.get("identidade")
    if ident is not None and ident not in IDENTIDADES:
        erros.append(
            f'"identidade" precisa ser um de: {", ".join(IDENTIDADES)} — recebido '
            f"{json.dumps(ident)}. Ausente vale como \"nenhuma\"; valor errado o "
            "portal RECUSA."
        )
    # `pessoas` e `times`: as concessoes do 05 §3.1.1. Ausente = lista vazia (o
    # formato de hoje). Presente e malformado o portal RECUSA — e recusar AQUI,
    # antes do upload, poupa a ida ate o 400.
    erros_das_listas = _validar_emails(d, "pessoas") + _validar_emails(d, "times")
    erros += erros_das_listas
    # O PAR, que ate 01/09 ninguem olhava: `alcance` e a lista eram validados
    # cada um por si, e a incoerencia entre os dois passava reta (`20` A-087).
    #
    # 🔴 A lista RECUSADA e passada adiante de proposito: sem isso, `pessoas`
    # com 60 itens levava o teto E a frase "nomeados sem ninguem nomeado" —
    # a pessoa escreveu 60 nomes e leu que nao nomeou ninguem.
    erros += _checar_coerencia_nomeados(d, bool(erros_das_listas))
    # `permissoes`/`papeis`: o portal recusa modelo malformado com o mesmo 400.
    erros += validar_modelo(d)
    return erros


def _validar_emails(d: dict, campo: str) -> list[str]:
    """Espelha a validacao de FORMA do portal (src/upload/ler-db1app.ts).

    Frouxa de proposito: "@ com coisa dos dois lados e um ponto depois". Regex
    "correta" de e-mail recusa endereco valido, e recusar custa o deploy da
    pessoa. Endereco que nao existe no diretorio nao e' problema daqui — o portal
    publica sem aquela pessoa e avisa.
    """
    v = d.get(campo)
    if v is None:
        return []
    if not isinstance(v, list):
        return [f'"{campo}" precisa ser uma lista de e-mails — recebido {type(v).__name__}']
    if len(v) > MAX_CONCESSOES:
        return [
            f'"{campo}" tem {len(v)} itens; o teto e {MAX_CONCESSOES}. Lista desse '
            "tamanho e geracao automatica, nao intencao — use um alcance maior."
        ]
    erros = []
    for item in v:
        if not isinstance(item, str):
            erros.append(f'"{campo}" tem item que nao e texto: {json.dumps(item)}')
        elif not EMAIL_RE.match(item.strip()):
            erros.append(f'"{campo}" tem item que nao parece e-mail: {json.dumps(item)}')
    return erros


def varrer_segredo_em_codigo(raiz: Path, arquivos: list[Path]) -> list[str]:
    """Chave de API em arquivo de codigo — recusa (422) no portal.

    `arquivos` vem de `coletar_arquivos()`, que devolve caminhos ABSOLUTOS. O
    relativo e' calculado aqui: caminho absoluto na mensagem de erro nao ajuda
    ninguem a achar a linha, e vaza a estrutura da maquina de quem rodou.
    """
    achados = []
    for caminho in arquivos:
        rel = caminho.relative_to(raiz)
        if caminho.name in NAO_VARRER or caminho.suffix.lower() not in SUFIXOS_CODIGO:
            continue
        try:
            conteudo = caminho.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, linha in enumerate(conteudo.splitlines(), 1):
            if SEGREDO_CODIGO_RE.search(linha):
                # NUNCA imprime o valor: o aviso de que a chave vazou nao pode
                # ser o proximo lugar onde ela aparece.
                achados.append(
                    f"chave de API em arquivo de codigo: {rel.as_posix()}:{n} — "
                    "mova para o .env (o portal RECUSA o envio)"
                )
                break
        if len(achados) >= 10:
            break
    return achados


# Exclusoes (o portal ignora estes itens; excluimos para reduzir o tamanho)
# Nota: arquivos .env NAO sao mais excluidos — projetos que dependem de
# variaveis em build time (ex.: NEXT_PUBLIC_*) precisam do .env no pacote.
EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}
EXCLUDE_FILE_GLOBS = (".DS_Store",)
EXCLUDE_SUFFIXES = (".log", ".pyc")


# Dependencias que indicam uso de banco de dados
DB_DEPS = {
    # Node
    "pg", "mysql2", "mysql", "mongoose", "sqlite3", "better-sqlite3",
    "sequelize", "typeorm", "prisma", "@prisma/client", "knex", "mariadb",
    # Python
    "psycopg2", "psycopg2-binary", "psycopg", "sqlalchemy", "pymysql",
    "pymongo", "motor", "aiomysql", "asyncpg", "databases", "tortoise-orm",
    "peewee", "mongoengine",
}

# Padroes de string de conexao
DB_URL_PATTERNS = re.compile(
    r"(DATABASE_URL|MONGO_URI|DB_HOST|DB_URL|MYSQL_HOST|POSTGRES_HOST"
    r"|jdbc:|mongodb\+srv://|postgresql://|mysql://)",
    re.IGNORECASE,
)

# Imagens de banco em docker-compose
DB_IMAGES = re.compile(
    r"image:\s*(postgres|mysql|mariadb|mongo|redis|mssql|cockroach|cassandra)",
    re.IGNORECASE,
)


def detectar_prisma_postgres(raiz: Path) -> tuple[bool, str | None]:
    """Detecta prisma/schema.prisma com provider postgres(ql).

    Retorna (achou, corpo_do_datasource). 'achou' e True se houver um
    schema.prisma numa pasta 'prisma/' com provider postgres(ql) — essa e a
    UNICA condicao que dispara o provisionamento automatico do portal (espelha
    detect-database.ts). 'corpo_do_datasource' e o texto de dentro do bloco
    'datasource { ... }' (sem comentarios), usado depois para checar se a URL
    esta no lugar certo conforme a versao do Prisma. None se nao achou."""
    for schema in raiz.rglob("schema.prisma"):
        rel = schema.relative_to(raiz)
        if deve_excluir(rel):
            continue
        if schema.parent.name != "prisma":
            continue
        try:
            conteudo = schema.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        # remove comentarios (/* */ e //) antes de isolar o datasource
        sem_bloco = re.sub(r"/\*.*?\*/", "", conteudo, flags=re.DOTALL)
        sem_linha = re.sub(r"//.*$", "", sem_bloco, flags=re.MULTILINE)
        m = re.search(r"datasource\s+\w+\s*\{([^}]*)\}", sem_linha)
        if not m:
            continue
        corpo = m.group(1)
        prov = re.search(r"provider\s*=\s*[\"']([a-zA-Z0-9_-]+)[\"']", corpo)
        if prov and re.fullmatch(r"postgres(ql)?", prov.group(1), re.IGNORECASE):
            return True, corpo
    return False, None


def detectar_versao_prisma_major(raiz: Path) -> int | None:
    """Le a major do Prisma no package.json (@prisma/client ou prisma).

    Retorna o numero da major (ex.: 6, 7) ou None se nao der pra determinar.
    Ignora prefixos de range (^, ~, >=) e pega o primeiro numero da versao."""
    pkg = raiz / "package.json"
    if not pkg.is_file():
        return None
    try:
        import json
        data = json.loads(pkg.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None
    deps = {}
    for chave in ("dependencies", "devDependencies"):
        deps.update(data.get(chave, {}) or {})
    for nome in ("@prisma/client", "prisma"):
        spec = deps.get(nome)
        if not spec:
            continue
        m = re.search(r"(\d+)", str(spec))
        if m:
            return int(m.group(1))
    return None


def checar_coerencia_prisma(corpo_datasource: str, major: int | None) -> list[str]:
    """Cruza a versao do Prisma com o formato do datasource e retorna avisos.

    - Prisma >=7: url/directUrl NAO sao aceitos no datasource do schema
      (erro P1012 no build). Devem ir no prisma.config.ts.
    - Prisma <=6: url/directUrl PRECISAM estar no datasource do schema."""
    avisos: list[str] = []
    tem_url = re.search(r"\burl\s*=", corpo_datasource) is not None
    if major is None:
        return avisos  # sem versao confiavel, nao arrisca aviso equivocado
    if major >= 7 and tem_url:
        avisos.append(
            "Prisma 7+ detectado, mas o datasource do schema.prisma ainda tem "
            "'url'/'directUrl' — isso QUEBRA o build com 'P1012 ... url is no "
            "longer supported'. No Prisma 7 o datasource fica so com 'provider "
            "= \"postgresql\"'; mova a URL para o prisma.config.ts na raiz "
            "(datasource: { url: env('DIRECT_URL') }) e use o driver adapter "
            "(@prisma/adapter-pg) com DATABASE_URL no runtime."
        )
    elif major <= 6 and not tem_url:
        avisos.append(
            "Prisma <=6 detectado, mas o datasource do schema.prisma nao tem "
            "'url'. No Prisma 6 as URLs vao no schema: url = env(\"DATABASE_URL\") "
            "e directUrl = env(\"DIRECT_URL\")."
        )
    return avisos


def detectar_banco(raiz: Path) -> list[str]:
    """Retorna lista de motivos se detectar uso de banco; lista vazia se nao."""
    motivos: list[str] = []

    # package.json
    pkg = raiz / "package.json"
    if pkg.is_file():
        try:
            import json
            data = json.loads(pkg.read_text(encoding="utf-8", errors="replace"))
            deps = set(data.get("dependencies", {}).keys()) | set(data.get("devDependencies", {}).keys())
            encontradas = deps & DB_DEPS
            if encontradas:
                motivos.append(f"package.json contém: {', '.join(sorted(encontradas))}")
        except Exception:
            pass

    # requirements.txt
    req = raiz / "requirements.txt"
    if req.is_file():
        linhas = req.read_text(encoding="utf-8", errors="replace").lower().splitlines()
        encontradas = {ln.split("=")[0].split(">")[0].split("<")[0].strip() for ln in linhas} & DB_DEPS
        if encontradas:
            motivos.append(f"requirements.txt contém: {', '.join(sorted(encontradas))}")

    # docker-compose
    for nome in ("docker-compose.yml", "docker-compose.yaml"):
        dc = raiz / nome
        if dc.is_file():
            conteudo = dc.read_text(encoding="utf-8", errors="replace")
            if DB_IMAGES.search(conteudo):
                motivos.append(f"{nome} define serviço de banco de dados")

    # Strings de conexao no codigo (varredura rapida em arquivos de texto)
    exts_texto = {".py", ".js", ".ts", ".env.example", ".yaml", ".yml", ".toml", ".ini", ".cfg"}
    for caminho in raiz.rglob("*"):
        if not caminho.is_file():
            continue
        rel = caminho.relative_to(raiz)
        if deve_excluir(rel):
            continue
        if caminho.suffix not in exts_texto and caminho.name not in {".env.example"}:
            continue
        try:
            texto = caminho.read_text(encoding="utf-8", errors="replace")
            if DB_URL_PATTERNS.search(texto):
                motivos.append(f"String de conexão detectada em {rel.as_posix()}")
                break  # um arquivo ja basta para o aviso
        except Exception:
            pass

    return motivos


def deve_excluir(rel: Path) -> bool:
    parts = rel.parts
    if any(p in EXCLUDE_DIRS for p in parts):
        return True
    name = rel.name
    if name in EXCLUDE_FILE_GLOBS:
        return True
    return name.endswith(EXCLUDE_SUFFIXES)


def encontrar_dockerfile(raiz: Path) -> tuple[bool, list[str]]:
    """Retorna (ok, avisos). ok=True se houver Dockerfile valido na raiz."""
    avisos: list[str] = []
    docker_raiz = raiz / "Dockerfile"

    if not docker_raiz.is_file():
        # Detecta caso comum: tudo dentro de uma unica pasta raiz
        subdirs = [d for d in raiz.iterdir() if d.is_dir() and d.name not in EXCLUDE_DIRS]
        if len(subdirs) == 1 and (subdirs[0] / "Dockerfile").is_file():
            avisos.append(
                f"Dockerfile encontrado em '{subdirs[0].name}/'. O portal "
                "ajusta pasta-raiz unica automaticamente, mas o ideal e ter o "
                "Dockerfile na raiz do projeto."
            )
            docker_raiz = subdirs[0] / "Dockerfile"
        else:
            # Variacao de caixa (dockerfile, DOCKERFILE...)
            variantes = [p for p in raiz.glob("*") if p.name.lower() == "dockerfile"]
            if variantes:
                avisos.append(
                    f"Arquivo '{variantes[0].name}' encontrado, mas o nome deve "
                    "ser exatamente 'Dockerfile' (com 'D' maiusculo)."
                )
            return False, avisos

    conteudo = docker_raiz.read_text(encoding="utf-8", errors="replace")
    if not re.search(r"^\s*EXPOSE\s+\d+", conteudo, re.MULTILINE | re.IGNORECASE):
        avisos.append("Dockerfile sem instrucao EXPOSE. Adicione, ex.: 'EXPOSE 8080'.")
    if re.search(r"127\.0\.0\.1|localhost", conteudo):
        avisos.append(
            "Dockerfile referencia 127.0.0.1/localhost. O processo precisa "
            "escutar em 0.0.0.0 para o app ficar acessivel."
        )
    return True, avisos


def coletar_arquivos(raiz: Path) -> tuple[list[Path], int, int]:
    arquivos: list[Path] = []
    total_bytes = 0
    profundidade_max = 0
    for caminho in raiz.rglob("*"):
        if not caminho.is_file():
            continue
        rel = caminho.relative_to(raiz)
        if deve_excluir(rel):
            continue
        arquivos.append(caminho)
        total_bytes += caminho.stat().st_size
        profundidade_max = max(profundidade_max, len(rel.parts))
    return arquivos, total_bytes, profundidade_max


# Atalhos de DESENVOLVIMENTO. Ligados no `.env` do pacote, derrubam o app
# inteiro: quem valida a propria configuracao no boot recusa subir com eles, e o
# sintoma nao fala em variavel nenhuma -- e' 500 em TODA rota (rota inexistente
# continua dando 404, porque vem do cache estatico). Medido em 17/08 no
# rastreador-de-incidentes: `DEV_AUTH_BYPASS=true` estourava o middleware do
# Next na avaliacao do modulo, a cada request. Ver dockerfile-build.md §3.
ATALHOS_DE_DEV = (
    "DEV_AUTH_BYPASS", "SKIP_AUTH", "AUTH_DISABLED", "DISABLE_AUTH",
    "BYPASS_AUTH", "MOCK_AUTH", "DEV_MODE", "DEV_LOGIN",
)
VALOR_LIGADO = {"true", "1", "yes", "on", "sim"}


def avisar_alcance_rebaixado(raiz: Path) -> list[str]:
    """Avisa quando este `db1app.json` declara MENOS do que a versao commitada.

    ┌─ O LACO QUE ISTO INTERROMPE (`20` A-089) ────────────────────────────────┐
    │ A skill pre-preenche `alcance: "pessoal"` quando a pessoa nao responde —  │
    │ o menor, que e' o default SEGURO para app NOVO. Para um app que ja teve   │
    │ um alcance APROVADO, escrever "o menor" desfaz uma decisao de gente.      │
    │                                                                          │
    │ Medido na .157 em 01/09: SETE apps de producao com o arquivo abaixo do    │
    │ concedido, de sete donos diferentes, e em nenhum deles o dono e' quem     │
    │ aprovou. Padrao que se repete em 7 de 7 nao e' descuido individual.       │
    └──────────────────────────────────────────────────────────────────────────┘

    🔑 POR QUE UMA GUARDA E NAO SO A INSTRUCAO NA SKILL.md: a instrucao vale
    enquanto alguem a le. Esta funcao pega o caso em que o agente regerou o
    arquivo sem olhar o que ja existia — que e' exatamente como os sete
    aconteceram.

    ⚠️ AVISO, NUNCA ERRO. Reduzir de proposito e' legitimo, e o portal ja trata
    o caso com seguranca (a guarda do A-086 preserva o concedido e avisa o dono).
    Bloquear aqui puniria a reducao deliberada para consertar a acidental.

    📌 Silencioso quando nao da' para saber: projeto que nao e' repo git, arquivo
    nao commitado, `git` ausente. Ausencia de sinal nao vira acusacao.
    """
    p = raiz / ARQUIVO_DECLARACAO
    if not p.is_file():
        return []
    try:
        agora = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []  # `validar_declaracao` ja reclama do arquivo ilegivel
    if not isinstance(agora, dict):
        return []

    try:
        bruto = subprocess.run(
            ["git", "-C", str(raiz), "show", f"HEAD:{ARQUIVO_DECLARACAO}"],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    # ⚠️ ESTA LINHA NAO E' A REDE, e vale saber para nao a tratar como se fosse.
    # Medido em 01/09: fora de um repo, `git show` sai com 128 e stdout VAZIO, e
    # o `json.loads("")` logo abaixo ja levanta ValueError — que o `except`
    # devolve como []. Uma mutacao que apaga estas duas linhas NAO reprova em
    # nenhum teste, e o motivo e' esse.
    #
    # Fica porque depender de excecao para fluxo normal e' pior de ler do que
    # uma condicao explicita: "sem HEAD, sem comparacao" e' a regra, e ela merece
    # estar escrita. Mas quem for mexer aqui: a garantia real e' o `except`.
    if bruto.returncode != 0 or not bruto.stdout.strip():
        return []
    try:
        antes = json.loads(bruto.stdout)
    except ValueError:
        return []
    if not isinstance(antes, dict):
        return []

    de, para = antes.get("alcance"), agora.get("alcance")
    if de not in ORDEM_ALCANCE or para not in ORDEM_ALCANCE:
        return []
    if ORDEM_ALCANCE[de] <= ORDEM_ALCANCE[para]:
        return []

    return [
        f'O alcance CAIU de "{de}" para "{para}" em relacao ao db1app.json commitado. '
        f"Se isso nao foi de proposito, o valor que vale hoje e' \"{de}\" — repor antes de "
        "publicar evita desfazer uma aprovacao. Se foi de proposito, siga: o portal "
        "preserva o alcance concedido e avisa o dono."
    ]


def avisar_env_de_dev(raiz: Path) -> list[str]:
    """Avisa se o `.env` que vai no pacote leva atalho de dev LIGADO.

    So avisa quando o valor esta ligado: `DEV_AUTH_BYPASS=false` e' exatamente o
    que se quer ver, e avisar dele treinaria a pessoa a ignorar o aviso.
    """
    avisos: list[str] = []
    arq = raiz / ".env"
    if not arq.is_file():
        return avisos
    try:
        linhas = arq.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return avisos

    for n, bruta in enumerate(linhas, 1):
        linha = bruta.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        chave = chave.strip()
        if chave.startswith("export "):
            chave = chave[len("export "):].strip()
        valor = valor.split("#")[0].strip().strip('"').strip("'").lower()
        if valor not in VALOR_LIGADO:
            continue
        alvo = chave.upper()
        if any(a in alvo for a in ATALHOS_DE_DEV) or alvo.startswith("MOCK_"):
            avisos.append(
                f".env linha {n}: {chave} esta LIGADO. O .env do pacote e' o de "
                "PRODUCAO. App que valida a configuracao no boot recusa subir "
                "assim, e o sintoma e' 500 em toda rota."
            )
    return avisos


def main() -> int:
    ap = argparse.ArgumentParser(description="Empacota um projeto para o Portal de Deploy DB1.")
    ap.add_argument("projeto", help="Caminho da pasta do projeto")
    ap.add_argument("-o", "--saida", help="Arquivo .zip de saida (padrao: <pasta>.zip)")
    ap.add_argument("--forcar", action="store_true", help="Gera o .zip mesmo com avisos")
    args = ap.parse_args()

    raiz = Path(args.projeto).resolve()
    if not raiz.is_dir():
        print(f"ERRO: '{raiz}' nao e uma pasta valida.", file=sys.stderr)
        return 2

    saida = Path(args.saida).resolve() if args.saida else raiz.parent / f"{raiz.name}.zip"

    erros: list[str] = []
    avisos: list[str] = []

    ok_docker, avisos_docker = encontrar_dockerfile(raiz)
    avisos += avisos_docker
    if not ok_docker:
        erros.append("Dockerfile ausente na raiz (obrigatorio).")
    # EXPOSE/127.0.0.1 entram como aviso forte; tratamos como erro p/ seguranca
    for a in avisos_docker:
        if "EXPOSE" in a or "0.0.0.0" in a:
            erros.append(a)

    arquivos, total_bytes, prof = coletar_arquivos(raiz)
    total_mb = total_bytes / (1024 * 1024)

    # Deteccao de banco de dados (aviso/informativo, nunca erro)
    achou_prisma_pg, corpo_ds = detectar_prisma_postgres(raiz)
    if achou_prisma_pg:
        # Caminho feliz: o portal provisiona Postgres gerenciado automaticamente.
        avisos.append(
            "Prisma + PostgreSQL detectado: o portal provisiona um Postgres "
            "gerenciado automaticamente (banco isolado, dados persistentes) e "
            "injeta DATABASE_URL/DIRECT_URL no deploy. NAO inclua essas duas no "
            ".env. IMPORTANTE: rode as migrations no start do container "
            "(ex.: CMD sh -c \"npx prisma migrate deploy && node server.js\") e "
            "inclua a pasta prisma/migrations no .zip — o banco e criado VAZIO. "
            "Sem isso o app sobe mas quebra com 'table does not exist' (P2021)."
        )
        # Coerencia versao do Prisma x formato do datasource (P1012 no Prisma 7)
        major = detectar_versao_prisma_major(raiz)
        avisos += checar_coerencia_prisma(corpo_ds or "", major)
    else:
        motivos_banco = detectar_banco(raiz)
        if motivos_banco:
            avisos.append(
                "Este projeto parece usar banco de dados ("
                + "; ".join(motivos_banco)
                + "). O provisionamento automatico do portal cobre apenas "
                "Prisma + PostgreSQL; para outros bancos, um banco dentro do "
                "container perde os dados a cada atualizacao. Prefira migrar "
                "para Prisma+Postgres ou abra um chamado. Consulte "
                "apps.db1group.com/faq."
            )

    # ── Governanca: as duas recusas do portal, achadas antes de subir ──────
    erros += validar_declaracao(raiz)
    erros += varrer_segredo_em_codigo(raiz, arquivos)
    avisos += avisar_declaracao(raiz)
    avisos += avisar_env_de_dev(raiz)
    avisos += avisar_alcance_rebaixado(raiz)

    if len(arquivos) > MAX_FILES:
        erros.append(f"{len(arquivos)} arquivos (limite: {MAX_FILES}).")
    if total_mb > MAX_UNZIP_MB:
        erros.append(f"Conteudo descompactado {total_mb:.1f} MB (limite: {MAX_UNZIP_MB} MB).")
    if prof > MAX_DEPTH:
        erros.append(f"Profundidade de pastas {prof} (limite: {MAX_DEPTH}).")

    print(f"Projeto: {raiz}")
    print(f"Arquivos (apos exclusoes): {len(arquivos)} | Tamanho: {total_mb:.1f} MB | Profundidade: {prof}")
    for a in dict.fromkeys(avisos):
        print(f"  [AVISO] {a}")
    for e in dict.fromkeys(erros):
        print(f"  [ERRO]  {e}")

    erros_unicos = list(dict.fromkeys(erros))
    if erros_unicos and not args.forcar:
        print("\nCorrija os erros acima antes de empacotar (ou use --forcar).", file=sys.stderr)
        return 1

    saida.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED) as zf:
        for caminho in arquivos:
            zf.write(caminho, caminho.relative_to(raiz).as_posix())

    zip_mb = saida.stat().st_size / (1024 * 1024)
    print(f"\nGerado: {saida} ({zip_mb:.1f} MB)")
    if zip_mb > MAX_ZIP_MB:
        print(f"  [ERRO] .zip excede {MAX_ZIP_MB} MB. Reduza o projeto antes do upload.", file=sys.stderr)
        return 1
    print("Pronto para upload em https://apps.db1group.com")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
