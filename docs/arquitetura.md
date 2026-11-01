# Arquitetura

Como o pipeline funciona por dentro. Para receitas de uso e reprocessamento, veja [operacao.md](operacao.md).

## O pipeline

```
URL do YouTube
   │
   ├─ 1. extractVideoId ....... src/fetch/videoId.js
   │                            aceita /watch, youtu.be, /shorts, /embed, /live ou o ID puro
   ├─ 2. fetchTranscript ...... src/fetch/transcript.js
   │                            legendas via yt-dlp em json3 → transcript-raw.txt + meta.json
   ├─ 3. chunkTranscript ...... src/chunk/chunker.js
   │                            blocos de CHUNK_SIZE_WORDS palavras com sobreposição,
   │                            com marcadores [HH:MM:SS] a cada 100 palavras
   ├─ 4. estimateCost ......... src/cost/estimate.js
   │                            custo em USD, seguido de confirmação no terminal
   ├─ 5. summarizeChunks ...... src/map/summarizeChunks.js      (MAP)
   │                            1 chamada ao MAP_MODEL por bloco, em paralelo
   │                            → chunks/chunk-000.json, chunk-001.json, ...
   └─ 6. consolidate .......... src/reduce/consolidate.js       (REDUCE)
                                1 chamada de roteiro + 1 por tópico, sequenciais
                                → resumo-final.md
```

A orquestração está em [src/cli.js](../src/cli.js). As flags `--skip-fetch`, `--skip-map` e `--skip-reduce` recortam esse fluxo.

## Transcrição

`fetchVideoInfo` roda o yt-dlp com `dumpSingleJson` e lê duas listas: `subtitles` (legenda manual) e `automatic_captions`. A escolha do idioma segue esta ordem de preferência, a mesma para as duas listas:

```
pt, pt-BR, pt-PT, en, en-US, en-GB
```

Legenda manual sempre vence legenda automática, mesmo que a automática esteja num idioma melhor posicionado na lista. Se nenhum idioma da lista aparecer, usa o primeiro disponível. Sem legenda de nenhum tipo, a execução falha.

O arquivo `json3` é baixado para a pasta do vídeo, convertido e apagado em seguida. O que fica é `transcript-raw.txt`, um JSON com `[{ startTime, endTime, text }]` em segundos, e `meta.json` com `videoId`, `title` e `url`.

## Blocos e marcadores de tempo

`chunkTranscript` desmonta os segmentos numa lista de palavras, cada palavra carregando o `startTime` e o `endTime` do segmento de origem, e corta essa lista em janelas de `CHUNK_SIZE_WORDS` com passo `CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS`. A sobreposição existe para que um raciocínio cortado no meio apareça inteiro em um dos dois blocos vizinhos.

Ao montar o texto do bloco, um marcador `[HH:MM:SS]` é inserido a cada 100 palavras (`MARKER_INTERVAL_WORDS`), sempre começando pelo primeiro. É a única informação de tempo que o modelo recebe: o prompt do MAP exige que todo item extraído termine com o timestamp entre parênteses, usando o marcador mais próximo. Daí a aproximação: a precisão do timestamp é a de uma janela de 100 palavras.

## Etapa MAP

Uma chamada ao `MAP_MODEL` por bloco, com `max_tokens` de 2000, limitadas a `MAP_CONCURRENCY` simultâneas por `p-limit`. O prompt pede extração com profundidade, em quatro categorias (teses e argumentos com o raciocínio, conceitos técnicos com as analogias usadas, ferramentas e pessoas citadas com o contexto, recomendações práticas com o porquê) e manda explicitamente preferir detalhe a economia de espaço, porque a compressão é trabalho do REDUCE.

Cada resultado vai para `chunks/chunk-NNN.json`:

```json
{ "index": 0, "startTime": 0, "endTime": 1837.2, "summary": "- ponto extraído (00:01:37)\n..." }
```

Blocos sem conteúdo aproveitável devem responder exatamente `SEM CONTEÚDO RELEVANTE`. O arquivo é gravado do mesmo jeito, e é o REDUCE que descarta esses blocos.

## Etapa REDUCE

`consolidate` lê todos os `chunks/*.json`, ordena por `index`, descarta os que começam com `SEM CONTEÚDO RELEVANTE` e junta os resumos restantes separados por `\n\n---\n\n`. Esse texto é o `combinedSummaries`, e ele é reenviado por inteiro em todas as chamadas da etapa.

**Fase 1, roteiro.** Uma chamada com `response_format: json_object` e `max_tokens` de 4000 devolve entre 4 e `REDUCE_MAX_TOPICS` tópicos em ordem cronológica, cada um com `titulo`, `inicio`, `fim` e `resumo` de um parágrafo. O parser tolera o modelo embrulhar o JSON em cercas de código ou escrever uma linha antes dele, aceita a lista sob `topicos` ou `topics` ou crua na raiz, e descarta entradas sem `titulo`. A lista é cortada em `REDUCE_MAX_TOPICS` antes de seguir.

**Fase 2, seções.** Uma chamada por tópico, com `max_tokens` de 3000. Cada uma recebe o roteiro completo numerado, a instrução de escrever apenas a seção daquele tópico e de não invadir os outros, e de novo o `combinedSummaries` inteiro. O prompt pede 2 a 4 parágrafos de texto corrido, proíbe bullets e citação literal, proíbe narrar a gravação ("o entrevistado comenta que") e exige uma última linha com os timestamps que embasaram a seção.

Essas chamadas rodam em série, dentro de um `for` com `await`. Paralelizá-las estoura o limite de tokens por minuto de contas em tier baixo, já que cada uma carrega o input completo. `createWithRetry` repete até 3 vezes apenas em erro HTTP 429, com espera de 5000 ms multiplicada pelo número da tentativa.

Por fim, `formatSectionBody` normaliza a linha de referências de cada seção para `*Timestamps: ...*`, aceitando as variações que o modelo produz (`Fontes:`, com ou sem asteriscos ao redor) e garantindo uma linha em branco antes dela.

## Formato do documento final

```markdown
# Título do vídeo

[Assistir no YouTube](https://www.youtube.com/watch?v=VIDEO_ID)

## Visão geral

**1. Produção e gestão de requisitos** (00:01:37 – 00:06:00)

O parágrafo de visão geral vindo do roteiro.

**2. Requisitos em métodos ágeis** (00:06:01 – 00:20:00)

O parágrafo de visão geral vindo do roteiro.

---

## 1. Produção e gestão de requisitos

Dois a quatro parágrafos de texto corrido, sem bullets e sem timestamps no meio.

*Timestamps: 00:01:37, 00:04:10, 00:05:58*

## 2. Requisitos em métodos ágeis
...
```

O título e o link saem do `meta.json`. Sem esse arquivo, o cabeçalho usa o `videoId` e o link é omitido. A faixa de timestamps ao lado de cada título é omitida quando o roteiro não trouxe `inicio` nem `fim`, e colapsa num valor único quando os dois são iguais.

## Pasta de saída

```
output/
└── engenharia-de-requisitos-com-marcos-kalinowski-puc-rio-6GDqAJLBxRI/
    ├── meta.json              videoId, título e URL
    ├── transcript-raw.txt      JSON com [{ startTime, endTime, text }]
    ├── chunks/
    │   ├── chunk-000.json      { index, startTime, endTime, summary }
    │   └── ...
    └── resumo-final.md         documento final
```

O nome da pasta é o slug do título mais o `videoId`. `slugify` normaliza para NFD, remove os acentos combinantes, troca tudo que não é `[a-z0-9]` por hífen e corta em 60 caracteres. Se o título não render slug nenhum, a pasta é só o `videoId`.

`resolveVideoDir` acha a pasta pelo nome exato igual ao `videoId` ou pelo sufixo `-<videoId>`, então renomear o slug na mão não quebra o cache. Quando não existe pasta alguma, `videoDirOrFallback` devolve `output/<videoId>`.

A pasta `output/` está no `.gitignore`.

## Cache e idempotência

| Arquivo existente | Efeito |
| --- | --- |
| `transcript-raw.txt` | `fetchTranscript` retorna o cache sem chamar o yt-dlp |
| `chunks/chunk-NNN.json` | aquele bloco não é reenviado ao MAP_MODEL |
| `resumo-final.md` | `consolidate` devolve o arquivo sem nenhuma chamada de API |

Nenhuma etapa sobrescreve o que já está em disco. Para refazer uma etapa, apague o arquivo correspondente; as receitas estão em [operacao.md](operacao.md).

`consolidate` aceita `options.fileName` para gravar sob outro nome, o que permite gerar variações lado a lado, mas o CLI ainda não expõe isso como flag.

## Estimativa de custo

A contagem de tokens é a heurística de 4 caracteres por token (`CHARS_PER_TOKEN`), sem tokenizador de verdade. A estimativa serve para evitar surpresa de ordem de grandeza, não para acertar centavos.

```
mapInputTokens     = soma dos caracteres dos blocos / 4
mapOutputTokens    = mapInputTokens * ESTIMATE_MAP_OUTPUT_RATIO
reduceInputTokens  = mapOutputTokens * (1 + REDUCE_MAX_TOPICS)
reduceOutputTokens = mapOutputTokens * ESTIMATE_REDUCE_OUTPUT_RATIO
```

O input do REDUCE é multiplicado por `1 + REDUCE_MAX_TOPICS` porque é esse o número de chamadas e todas recebem o `combinedSummaries` inteiro. O output não é multiplicado: ele é a soma das seções, calibrada a partir do total do MAP.

Duas consequências práticas:

- O REDUCE domina o total. Na execução de exemplo do README, US$ 0,2011 contra US$ 0,0068 do MAP.
- O número real de tópicos só é conhecido depois da chamada de roteiro, então a estimativa usa o teto. O custo cobrado tende a ficar abaixo do estimado.

`reduceCallCount` vive em [src/reduce/consolidate.js](../src/reduce/consolidate.js) e é importado pelo módulo de custo, para que a conta e o laço de chamadas não possam divergir.

## Testes

```bash
npm test
```

São 60 testes com `node --test`, sem rede e sem chave de API, em [test/](../test/): um arquivo por módulo testado, com exceção de `src/config.js` e `src/fetch/transcript.js`, que ainda não têm testes. O cliente da OpenAI é injetado como parâmetro em `summarizeChunks` e `consolidate` e substituído por um duplo nos testes; é essa escolha que mantém as etapas pagas testáveis.
