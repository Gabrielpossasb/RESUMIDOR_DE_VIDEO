# Resumidor de Vídeo

CLI que transforma podcasts longos do YouTube em um documento markdown organizado por tópico, com timestamps de referência em cada seção.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=nodedotjs&logoColor=white)
![openai](https://img.shields.io/badge/openai-%5E7.4.0-412991?logo=openai&logoColor=white)
![youtube-dl-exec](https://img.shields.io/badge/youtube--dl--exec-%5E3.1.12-FF0000?logo=youtube&logoColor=white)
![p-limit](https://img.shields.io/badge/p--limit-%5E7.3.1-333333)
![dotenv](https://img.shields.io/badge/dotenv-%5E17.4.2-ECD53F?logo=dotenv&logoColor=black)
![testes](https://img.shields.io/badge/node%3Atest-60%20testes-success)

## Em execução

Não há interface gráfica: a saída é o terminal e o arquivo markdown gerado. O trecho abaixo é uma execução real, com a transcrição já em cache, parada no pedido de confirmação antes de qualquer chamada paga.

```console
$ node index.js 6GDqAJLBxRI --skip-fetch
Vídeo: 6GDqAJLBxRI
Pasta: output\engenharia-de-requisitos-com-marcos-kalinowski-puc-rio-6GDqAJLBxRI
Transcrição: 2122 segmento(s).
Dividido em 3 bloco(s).
Custo estimado: ~US$ 0.2080 (MAP: US$ 0.0068, REDUCE: US$ 0.2011)
Prosseguir com as chamadas pagas? [s/N] n
Cancelado.
```

O documento gerado em `resumo-final.md` tem uma visão geral com a faixa de timestamps de cada tópico e, depois, uma seção de texto corrido por tópico, cada uma fechando com a linha de timestamps que a embasou. O formato está detalhado em [docs/arquitetura.md](docs/arquitetura.md#formato-do-documento-final).

## O que é

Um vídeo de quatro horas não cabe na janela de contexto de um modelo, e jogar a transcrição inteira num modelo caro custa dólares por execução e devolve um resumo raso. Aqui a transcrição é dividida em blocos, cada bloco passa por um modelo barato que extrai o conteúdo com profundidade (etapa MAP), e só esses resumos chegam ao modelo caro, que os reorganiza por tópico (etapa REDUCE).

O alvo é quem assiste a podcast técnico e entrevista longa para estudar: o resultado é um texto que se entende sem ter visto o vídeo, com os timestamps para voltar ao ponto original.

É um CLI local, sem servidor nem banco: o único estado é a pasta `output/`, e é ela que também funciona como cache entre execuções.

## Decisões técnicas

**Dois modelos, um por etapa.** `MAP_MODEL` roda uma vez por bloco e `REDUCE_MODEL` só vê os resumos. Na execução acima, o MAP custa US$ 0,0068 e o REDUCE US$ 0,2011: inverter isso, mandando a transcrição bruta ao modelo caro, multiplicaria a conta sem melhorar o texto final.

**O REDUCE manda o input completo em cada seção.** São `1 + REDUCE_MAX_TOPICS` chamadas: uma devolve o roteiro de tópicos em JSON, e cada tópico ganha uma chamada que recebe de novo todos os resumos do MAP e escreve só a sua seção. Pedir o documento inteiro de uma vez faz o modelo comprimir tudo em bullets genéricos. O preço do trade-off é o custo de input multiplicado, e é por isso que ele domina a estimativa.

**MAP em paralelo, REDUCE sequencial.** O MAP usa `p-limit` com `MAP_CONCURRENCY` chamadas simultâneas. O REDUCE é um `for` com `await`, não `Promise.all`: chamadas paralelas ao modelo caro, cada uma com o input completo, estouram o limite de tokens por minuto de contas em tier baixo. Erros 429 são repetidos com backoff crescente.

**Cada etapa é idempotente, com cache em arquivo.** Transcrição, bloco e documento final existentes são reaproveitados em vez de regerados. Isso é o que torna possível iterar no prompt do REDUCE: apagar `resumo-final.md` e rodar com `--skip-map` reconsolida o documento sem repagar a etapa MAP. As receitas estão em [docs/operacao.md](docs/operacao.md).

**Timestamp é marcador injetado no texto, não metadado.** O chunker insere `[HH:MM:SS]` a cada 100 palavras dentro do próprio bloco, e os prompts exigem que todo ponto extraído termine com o timestamp mais próximo entre parênteses. O modelo não recebe a estrutura de tempo das legendas de outra forma, então sem esses marcadores não há como referenciar o vídeo.

**A pasta de saída é localizada pelo sufixo `-<videoId>`.** O nome é `slug-do-titulo-videoId`, mas `resolveVideoDir` procura pelo sufixo, então renomear a pasta na mão não quebra o cache.

**O cliente da OpenAI é injetado como parâmetro.** `summarizeChunks` e `consolidate` recebem o client em vez de importá-lo. Os 60 testes rodam sem rede e sem chave de API, usando um duplo no lugar do cliente.

## Stack

| Peça | Uso |
| --- | --- |
| Node.js 18+ (ESM) | Runtime; usa `node:readline/promises` e `node:test` |
| `openai` `^7.4.0` | Chamadas de chat completions nas etapas MAP e REDUCE |
| `youtube-dl-exec` `^3.1.12` | Baixa as legendas do YouTube em formato `json3` via yt-dlp |
| `p-limit` `^7.3.1` | Limite de concorrência na etapa MAP |
| `dotenv` `^17.4.2` | Carrega o `.env` |
| `node:test` | Testes, sem dependência externa |

## Como rodar

### Pré-requisitos

- Node.js 18 ou superior (o projeto usa ESM, `node:readline/promises` e o runner `node --test`).
- Uma chave de API da OpenAI com crédito.
- `youtube-dl-exec` baixa o binário do `yt-dlp` durante o `npm install`. No Windows ele é autocontido; no Linux e no macOS é preciso ter Python 3 no PATH.

### Instalação

```bash
git clone https://github.com/Gabrielpossasb/RESUMIDOR_DE_VIDEO.git
cd RESUMIDOR_DE_VIDEO
npm install
cp .env.example .env    # Windows: copy .env.example .env
```

Abra o `.env` e preencha `OPENAI_API_KEY`. As outras variáveis já vêm com valor padrão.

### Execução

```bash
node index.js "https://www.youtube.com/watch?v=VIDEO_ID"
```

São aceitos `/watch?v=`, `youtu.be`, `/shorts`, `/embed`, `/live`, com ou sem `www.` e `m.`, e também o ID de 11 caracteres direto. O programa imprime o número de blocos e o custo estimado e espera `s` antes de fazer qualquer chamada paga.

| Flag | Efeito |
| --- | --- |
| `--yes` | Não pergunta antes de gastar; para uso em script |
| `--skip-fetch` | Usa o `transcript-raw.txt` em cache; falha se não existir |
| `--skip-map` | Vai direto ao REDUCE, usando os `chunks/` existentes |
| `--skip-reduce` | Para depois do MAP, sem gerar o `resumo-final.md` |

### Scripts

| Script | Comando | O que faz |
| --- | --- | --- |
| `npm start` | `node index.js` | Entrada do CLI; passe a URL depois de `--`, como em `npm start -- VIDEO_ID` |
| `npm test` | `node --test` | Roda os 60 testes de `test/`, sem rede e sem chave de API |

### Variáveis de ambiente

Todas opcionais exceto a chave. Os valores abaixo são os padrões de [src/config.js](src/config.js), replicados em [.env.example](.env.example).

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `OPENAI_API_KEY` | (vazio) | Obrigatória |
| `MAP_MODEL` | `gpt-4o-mini` | Modelo da etapa MAP, uma chamada por bloco |
| `REDUCE_MODEL` | `gpt-4o` | Modelo da etapa REDUCE, uma chamada por tópico |
| `CHUNK_SIZE_WORDS` | `5000` | Tamanho de cada bloco, em palavras |
| `CHUNK_OVERLAP_WORDS` | `200` | Sobreposição entre blocos vizinhos, em palavras |
| `MAP_CONCURRENCY` | `3` | Chamadas simultâneas na etapa MAP |
| `REDUCE_MAX_TOPICS` | `10` | Teto de tópicos do documento final; cada tópico é uma chamada |
| `MAP_MODEL_PRICE_INPUT_PER_1M` | `0.15` | Preço de referência em USD por 1M de tokens de entrada no MAP |
| `MAP_MODEL_PRICE_OUTPUT_PER_1M` | `0.60` | Idem, saída do MAP |
| `REDUCE_MODEL_PRICE_INPUT_PER_1M` | `2.50` | Idem, entrada do REDUCE |
| `REDUCE_MODEL_PRICE_OUTPUT_PER_1M` | `10.00` | Idem, saída do REDUCE |
| `ESTIMATE_MAP_OUTPUT_RATIO` | `0.3` | Saída esperada do MAP como fração da entrada, só para estimar custo |
| `ESTIMATE_REDUCE_OUTPUT_RATIO` | `0.5` | Saída esperada do REDUCE como fração do total do MAP |

Trocar de modelo é mudar uma linha do `.env`, já que nenhum prompt depende de um modelo específico. Ao trocar, ajuste também os preços: a estimativa de custo lê esses valores, não uma tabela embutida.

## Estrutura de pastas

```
.
├── index.js                  entrada; delega pro CLI e trata o erro final
├── src/
│   ├── cli.js                flags, confirmação de custo e orquestração
│   ├── config.js             leitura do .env com defaults
│   ├── openaiClient.js       construção do cliente
│   ├── outputPaths.js        slug do título e resolução da pasta do vídeo
│   ├── fetch/                videoId.js (parsing da URL), transcript.js (yt-dlp)
│   ├── chunk/                chunker.js (blocos e marcadores), timestamp.js
│   ├── cost/estimate.js      estimativa de tokens e custo em USD
│   ├── map/summarizeChunks.js    etapa MAP e prompt de extração
│   └── reduce/consolidate.js     etapa REDUCE, seções e montagem do markdown
├── test/                     um arquivo por módulo, node:test
├── docs/                     arquitetura, operação e planejamento
└── output/                   gerado em tempo de execução, fora do versionamento
```

## Documentação

- [docs/arquitetura.md](docs/arquitetura.md): o pipeline passo a passo, as duas fases do REDUCE, o formato do documento final, o cache e a matemática da estimativa de custo.
- [docs/operacao.md](docs/operacao.md): receitas de reprocessamento, o que apagar para refazer cada etapa, mensagens de erro e limitações conhecidas.
- [docs/plano-resumidor-pdfs.md](docs/plano-resumidor-pdfs.md): planejamento de um segundo pipeline, para PDFs de aula, reaproveitando este. Nada dele foi implementado.
