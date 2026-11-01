# Plano — Resumidor de PDFs de aula

> Documento de planejamento. Nada aqui foi implementado ainda.
> Escrito em 2026-09-05, a partir do pipeline de vídeo já existente neste repositório.

## Objetivo

Jogar os PDFs de slides de uma matéria numa pasta, rodar um comando, e sair com
material de estudo. Duas entregas, em ordem de prioridade:

1. **Modo tópicos** (o que se quer primeiro) — uma lista enxuta dos principais
   tópicos de cada aula, com a página de onde saiu cada um, pronta pra colar no
   Claude e estudar a partir dali.
2. **Modo completo** (depois) — resumo explicado de cada aula e, mais adiante,
   um guia consolidado da matéria inteira.

## Decisões já tomadas

| Ponto | Decisão |
| --- | --- |
| Tipo de material | Slides de aula (não apostila). Decks de 10 a 60+ páginas |
| Entrada | **Uma pasta por matéria**, com vários PDFs dentro. O comando processa a pasta inteira |
| Imagens e diagramas | São parte importante do conteúdo (curso de Sistemas de Informação) |
| Páginas | Mistas: algumas com texto selecionável, outras que são imagem |
| Escopo agora | Aula por aula. O guia consolidado da matéria fica planejado, mas não entra na primeira versão |

## Slide não se resume — se expande

O detalhe que mais afeta a qualidade do resultado, e que separa este pipeline do
de vídeo: uma transcrição de podcast é verbosa e o modelo **comprime**. Um slide
é telegráfico — "Acoplamento aferente vs. eferente" e um diagrama. Pedir "resuma"
devolve algo menor e mais inútil que o original.

- No **modo tópicos**, isso não é problema: o objetivo é justamente a lista curta.
- No **modo completo**, o prompt do MAP tem que ser **explicar/desenvolver**, não
  resumir: transformar o bullet em prosa que se entenda sem o professor falando
  por cima. Isso inverte a razão entrada/saída, então
  `ESTIMATE_MAP_OUTPUT_RATIO` (hoje `0.3`) precisa ir para algo como `1.5`.

---

## A questão da visão: como decidir e quanto custa

As páginas são mistas, e os diagramas importam. Existem três rotas.

### Rota A — Só texto (`pdfjs-dist`)

Extrai o texto de cada página. Rápido, sem dependência nativa, praticamente de
graça. Perde: diagramas, gráficos, fórmulas em imagem, e o **sentido estrutural**
de esquemas (as caixas e setas de um diagrama de PowerPoint são vetores — os
rótulos até saem no texto, mas soltos e fora de ordem, o que às vezes é pior que
não ter nada).

### Rota B — Renderizar cada página e mandar pro modelo com visão

Renderiza a página em imagem (`pdfjs-dist` + `@napi-rs/canvas`, que tem binário
pré-compilado e não exige build tools no Windows) e manda imagem **e** texto
extraído juntos: a imagem carrega o diagrama, o texto garante precisão em nomes,
siglas e termos que o OCR do modelo poderia errar.

### Rota C — Híbrido: visão só nas páginas que precisam

Classifica cada página (pouco texto + área de imagem grande → visão; resto →
texto) e paga visão só onde vale.

### Custo comparado

Base: matéria com 10 PDFs × 60 páginas = 600 páginas de slide, ~120 palavras de
texto por página, página renderizada a ~1536×864 (≈1100 tokens de imagem em
`gpt-4o`). Heurística de 4 caracteres por token, igual à que o repositório já usa.

| Rota | MAP | REDUCE | **Total da matéria** |
| --- | --- | --- | --- |
| A — só texto | ~US$ 0,04 | ~US$ 0,85 | **~US$ 0,90** |
| C — híbrido (~30% das páginas com visão) | ~US$ 1,14 | ~US$ 0,85 | **~US$ 2,00** |
| B — visão em todas as páginas | ~US$ 2,29 | ~US$ 0,85 | **~US$ 3,10** |

**Conclusão: vá de Rota B no modo completo.** A diferença entre o híbrido e a
visão total é cerca de US$ 1 por matéria — não paga o custo de manter um
classificador de páginas, que é justamente o tipo de heurística que erra em
silêncio e faz você descobrir a falha só quando o resumo estiver faltando um
diagrama. Nas contas acima, a matéria inteira sai por volta de R$ 17.

**E o modo tópicos não precisa de visão nenhuma.** Título de slide é sempre texto.
Para levantar os principais tópicos, a Rota A basta e o custo cai pra centavos —
esse é o verdadeiro corte de custo aqui, não a escolha da rota.

Dois pontos a confirmar na hora de implementar:

- Em `gpt-4o-mini`, imagens são cobradas com um multiplicador de tokens bem maior
  que o texto. "Usar o modelo barato pra visão" economiza muito menos do que a
  diferença nominal de preço sugere — conferir a tabela antes de escolher.
- Existe uma quarta rota: mandar o PDF inteiro pro modelo (a Responses API da
  OpenAI aceita arquivo PDF e processa texto e imagem juntos), o que elimina a
  renderização e a dependência do canvas. Em troca, perde-se o controle de
  chunking e há limites de páginas/tamanho por arquivo. Vale medir antes de
  descartar, mas exige trocar `chat.completions` por `responses` no cliente.

### Páginas sem texto no modo tópicos

Como o modo tópicos não usa visão, uma página que é 100% imagem passa em branco.
Em vez de silenciar isso, a saída marca a lacuna:

```
- **(p. 17–18)** — páginas sem texto extraível, provavelmente diagrama
```

Assim você sabe onde a lista está incompleta e decide se abre o slide ou roda o
modo completo naquela aula.

---

## Estrutura de pastas

```
input/
└── engenharia-de-software-2026-1/     ← uma pasta por matéria
    ├── 01-introducao.pdf
    ├── 02-processos.pdf
    └── ...

output/
└── engenharia-de-software-2026-1/
    ├── aulas/
    │   ├── 01-introducao/
    │   │   ├── paginas-raw.json        ← [{ page, text, temImagem }]
    │   │   ├── chunks/chunk-000.json   ← cache do MAP, permite retomada
    │   │   ├── topicos.md              ← modo tópicos
    │   │   └── resumo-aula.md          ← modo completo
    │   └── 02-processos/
    ├── para-colar.md                   ← tópicos de TODAS as aulas, num arquivo só
    └── guia-da-materia.md              ← fase futura
```

- Ordem das aulas = ordem natural do nome do arquivo (`2` antes de `10`).
  Prefixar com `01-`, `02-` mantém tudo previsível.
- Nome da pasta de saída vem do nome do arquivo, via `slugify` de
  [src/outputPaths.js](../src/outputPaths.js) — acentos e espaços já são tratados.
- Cache por chunk e reuso de arquivo já pronto funcionam como no vídeo: rodar de
  novo não repaga o que já foi processado. Com 600 páginas isso não é luxo.

## Formato das saídas

### `topicos.md` (modo tópicos)

```markdown
# Aula 03 — Arquitetura em Camadas
_38 slides_

- **Separação de responsabilidades** (p. 4–11) — por que dividir o sistema em camadas
- **Camada de apresentação** (p. 12–15) — responsabilidades e o que não deve estar nela
- **Camada de domínio** (p. 16–24) — regras de negócio, entidades, serviços
- **(p. 25–26)** — páginas sem texto extraível, provavelmente diagrama
- **Persistência e repositórios** (p. 27–35) — padrão Repository e isolamento do banco
```

Uma linha por tópico: título em negrito, faixa de páginas, e uma frase do que o
tópico trata. Curto de propósito — é insumo pra estudar no Claude, não o estudo.

### `para-colar.md`

Os tópicos das 10 aulas concatenados num arquivo só, com o cabeçalho de cada
aula. É o arquivo que você abre, seleciona tudo e cola.

### `resumo-aula.md` (modo completo)

Mesmo formato do resumo de vídeo que já existe, com página no lugar de timestamp:

```markdown
# Aula 03 — Arquitetura em Camadas

## Visão geral
**1. Separação de responsabilidades** (p. 4–11)
Um parágrafo.

---

## 1. Separação de responsabilidades
Dois a quatro parágrafos explicando de verdade, inclusive desenvolvendo o que no
slide era só um bullet solto e descrevendo o diagrama da p. 9.

*Páginas: 4, 7, 9–11*
```

---

## Fases

### Fase 0 — Parametrizar MAP e REDUCE

Nenhum comportamento novo. Hoje o prompt está hard-coded em `MAP_SYSTEM_PROMPT`
([src/map/summarizeChunks.js](../src/map/summarizeChunks.js)) e os prompts e o
rótulo de referência estão dentro de
[src/reduce/consolidate.js](../src/reduce/consolidate.js). Passar isso via objeto
de configuração da fonte, para que vídeo e PDF compartilhem a mecânica em vez de
virarem dois pipelines copiados.

**Critério de aceite:** os testes atuais passam sem alteração de expectativa.

### Fase 1 — Modo tópicos (a entrega que interessa agora)

1. `extractPdfPages` com `pdfjs-dist` → `[{ page, text, temImagem }]`.
2. `stripBoilerplate` — remove linhas que se repetem em mais de ~70% das páginas
   (nome da universidade, rodapé, numeração). Em deck de 60 páginas isso é lixo
   que ocupa token e polui a saída.
3. `chunkPages` — agrupa páginas até `CHUNK_SIZE_WORDS` sem quebrar página no
   meio, marcando `[p. N]`. Deck de 60 páginas de slide provavelmente cabe em
   1–2 blocos.
4. MAP com prompt de extração de tópicos (modelo barato).
5. Uma chamada de consolidação por aula → `topicos.md`.
6. Varredura da pasta + `para-colar.md`.
7. CLI: `node index.js pdf ./input/<materia> --topicos`.

**Critério de aceite:** apontar pra uma pasta com 3 PDFs reais e sair com 3
`topicos.md` + 1 `para-colar.md`, com as faixas de página corretas.

### Fase 2 — Modo completo, com visão

1. Renderização de página (`@napi-rs/canvas`) e envio de imagem + texto no MAP.
2. Prompt de MAP que **desenvolve** o slide e **descreve os diagramas** em vez de
   comprimir.
3. REDUCE nível 1 reusando o `consolidate` parametrizado da Fase 0 →
   `resumo-aula.md`.
4. CLI: `--completo` (e `--sem-visao` pra rodar barato quando a aula não tiver
   diagrama que importe).

### Fase 3 — Guia da matéria (planejado, não agora)

Um segundo nível de REDUCE que recebe os 10 `resumo-aula.md` e produz
`guia-da-materia.md`, organizado **por tema** e não por ordem de aula, porque um
tema atravessa várias aulas. Estrutura proposta:

```markdown
## Mapa da matéria           ← os temas do semestre e como se conectam
## Linha do tempo das aulas  ← uma linha por aula
## Temas                     ← seção por tema, cruzando aulas
   ### Acoplamento e coesão
   explicação consolidada
   *Aulas 3 (p. 12), 5 (p. 4), 9 (p. 22)*
## Recorrências              ← o que o professor repetiu em várias aulas
## Pontos que ficaram vagos  ← onde o slide não basta pra entender
```

As duas últimas seções valem mais do que parecem: recorrência costuma ser sinal
de prova, e a lista de lacunas diz onde vale abrir o livro em vez de reler o slide.

### Fase 4 — Opcional

`flashcards.csv` no formato do Anki (`pergunta;resposta;aula;página`), derivado do
guia da matéria e não do texto bruto — sai mais barato e mais coerente.

---

## Configuração nova prevista

| Variável | Padrão sugerido | O que faz |
| --- | --- | --- |
| `PDF_MODO` | `topicos` | `topicos` ou `completo` |
| `PDF_VISION_MODEL` | `gpt-4o` | Modelo com visão usado no modo completo |
| `PDF_RENDER_WIDTH` | `1536` | Largura de renderização da página; mexe direto no custo de imagem |
| `PDF_BOILERPLATE_THRESHOLD` | `0.7` | Fração de páginas em que uma linha precisa aparecer pra ser considerada rodapé |
| `ESTIMATE_MAP_OUTPUT_RATIO` | — | No modo completo precisa subir pra ~`1.5`: slide expande, não comprime |

## Dívida a pagar de passagem

O CLI não expõe `--out <arquivo>`, embora `consolidate` já aceite
`options.fileName`. Sem isso, testar mudança de formatação exige apagar o arquivo
de saída na mão a cada rodada. Vale incluir na Fase 1.

## Pendências para a implementação

1. Confirmar o multiplicador de tokens de imagem em `gpt-4o-mini` antes de
   escolher o modelo do MAP com visão.
2. Medir a Rota "PDF direto pra Responses API" contra a Rota B antes de assumir a
   dependência do canvas.
3. Definir se o modo tópicos deve rodar visão apenas nas páginas marcadas como
   sem texto (custo pequeno, cobre a lacuna) ou apenas sinalizá-las.
