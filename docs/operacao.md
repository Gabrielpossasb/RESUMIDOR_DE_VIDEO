# Operação

Receitas de uso, reprocessamento e diagnóstico. Para o funcionamento interno do pipeline, veja [arquitetura.md](arquitetura.md).

## Primeira execução de um vídeo

```bash
node index.js "https://www.youtube.com/watch?v=VIDEO_ID"
```

O programa baixa a legenda, divide em blocos, imprime o custo estimado e espera `s` para prosseguir. Qualquer outra resposta cancela antes de qualquer chamada paga.

Para rodar sem interação, use `--yes`. É a forma indicada em script, e a única em que vale a pena conferir o custo estimado antes, com `--skip-reduce` ou com uma execução cancelada.

## Reprocessar uma etapa

Cada etapa reaproveita o que já está em disco, então reprocessar é apagar o arquivo e rodar de novo. Os caminhos abaixo assumem a pasta `output/<slug>-<videoId>/`.

| Objetivo | O que apagar | Comando |
| --- | --- | --- |
| Refazer só o documento final (mexeu nos prompts do REDUCE) | `resumo-final.md` | `node index.js VIDEO_ID --skip-map --yes` |
| Refazer um bloco específico do MAP | `chunks/chunk-007.json` e `resumo-final.md` | `node index.js VIDEO_ID --skip-fetch --yes` |
| Refazer o MAP inteiro (mexeu no prompt do MAP ou no tamanho do bloco) | a pasta `chunks/` e `resumo-final.md` | `node index.js VIDEO_ID --skip-fetch --yes` |
| Rebaixar a legenda (veio truncada ou no idioma errado) | `transcript-raw.txt`, `chunks/` e `resumo-final.md` | `node index.js VIDEO_ID --yes` |
| Começar do zero | a pasta do vídeo inteira | `node index.js VIDEO_ID --yes` |

O caso mais comum é o primeiro: iterar no formato do documento final sem repagar a etapa MAP.

```bash
rm output/*-VIDEO_ID/resumo-final.md
node index.js VIDEO_ID --skip-map --yes
```

No PowerShell:

```powershell
Remove-Item output\*-VIDEO_ID\resumo-final.md
node index.js VIDEO_ID --skip-map --yes
```

Mudar `CHUNK_SIZE_WORDS` ou `CHUNK_OVERLAP_WORDS` invalida os blocos já processados, porque a numeração `chunk-NNN` passa a corresponder a outro trecho do vídeo. Apague a pasta `chunks/` ao mexer nesses dois valores.

## Detalhes do comportamento das flags

- `--skip-fetch` não tem efeito junto com `--skip-map`: a leitura da transcrição acontece dentro do trecho que o `--skip-map` pula.
- `--skip-map` não lê a transcrição nem recalcula a estimativa, então ele também não pede confirmação antes do REDUCE, que é a etapa cara. Com `--skip-map`, o `--yes` é irrelevante.
- `--skip-reduce` é a forma de pagar só o MAP e decidir depois. Os `chunks/` ficam prontos para um `--skip-map` posterior.
- A URL é o primeiro argumento que não começa com `--`. Se mais de um for passado, vale o último.

## Erros e o que eles significam

| Mensagem | Causa |
| --- | --- |
| `Uso: node index.js <url-do-youtube> ...` | Nenhuma URL foi passada |
| `URL do YouTube não reconhecida: "..."` | A URL não casou com nenhum formato aceito, e também não é um ID de 11 caracteres |
| `O vídeo "X" não possui transcrição/legendas disponíveis.` | O vídeo não tem legenda manual nem automática, ou a legenda baixada veio vazia |
| `Não foi possível carregar o vídeo "X": ...` | O yt-dlp falhou ao ler os metadados: vídeo privado, removido, com restrição de idade ou sem rede |
| `Falha ao baixar a legenda do vídeo "X" via yt-dlp: ...` | Os metadados vieram, mas o download da legenda falhou. Costuma ser yt-dlp desatualizado |
| `--skip-fetch foi usado mas não há transcrição em cache para "X"` | Não existe `transcript-raw.txt` na pasta do vídeo. Rode sem a flag |
| `Nenhum conteúdo relevante encontrado para o vídeo "X"` | Não há `chunks/*.json`, ou todos responderam `SEM CONTEÚDO RELEVANTE`. Com `--skip-map`, o motivo quase sempre é a pasta `chunks/` não existir |
| `O REDUCE não identificou nenhum tópico para o vídeo "X".` | O roteiro voltou em JSON válido, mas sem nenhuma entrada com `titulo` |
| `Roteiro do REDUCE não veio em JSON` ou `não veio em JSON válido` | A resposta do roteiro não pôde ser lida. Rodar de novo resolve na maioria dos casos |

Erros HTTP 429 não aparecem como mensagem: `createWithRetry` repete até 3 vezes com espera crescente. Se os 429 persistirem, o erro sobe com a mensagem do SDK da OpenAI; reduza `MAP_CONCURRENCY` ou espere a janela de tokens por minuto virar.

## Atualizar o yt-dlp

O binário é baixado pelo `youtube-dl-exec` durante o `npm install`. O YouTube muda o suficiente para que um binário antigo pare de baixar legendas. Para forçar um binário novo:

```bash
rm -rf node_modules/youtube-dl-exec
npm install
```

No Linux e no macOS, o yt-dlp precisa de Python 3 no PATH. No Windows, o binário é autocontido.

## Custo

A estimativa impressa antes da confirmação usa os preços do `.env`, não uma tabela embutida nem a tabela viva da OpenAI. Ao trocar `MAP_MODEL` ou `REDUCE_MODEL`, atualize os quatro `*_PRICE_*_PER_1M` correspondentes, senão a estimativa passa a mentir sem avisar.

O custo é dominado pelo REDUCE, cujo input é multiplicado por `1 + REDUCE_MAX_TOPICS`. Baixar `REDUCE_MAX_TOPICS` é a alavanca mais direta sobre o valor da execução. A conta está detalhada em [arquitetura.md](arquitetura.md#estimativa-de-custo).

## Limitações conhecidas

- Só funciona com vídeo que tenha legenda, manual ou automática. Idiomas preferidos, em ordem: `pt`, `pt-BR`, `pt-PT`, `en`, `en-US`, `en-GB`.
- Legenda automática tem erro de transcrição, inclusive em nome próprio e termo técnico, e esse erro se propaga para o documento final sem sinalização.
- Os timestamps são aproximados: saem do marcador mais próximo, injetado a cada 100 palavras, então a precisão é a de uma janela de 100 palavras.
- O documento final não é verificado contra a transcrição. O prompt proíbe inventar, mas nada no código checa isso.
- Não há flag para escolher o nome do arquivo de saída, embora `consolidate` aceite `options.fileName`. Testar uma mudança de formatação exige apagar o `resumo-final.md` a cada rodada.
- Os arquivos em `output/` neste repositório foram gerados por versões anteriores do REDUCE e estão em um formato que o código atual não produz mais. Eles não servem como referência do formato de saída; use o exemplo em [arquitetura.md](arquitetura.md#formato-do-documento-final).
