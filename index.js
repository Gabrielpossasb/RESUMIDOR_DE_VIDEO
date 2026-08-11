import { runCli } from "./src/cli.js";

runCli(process.argv.slice(2)).catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exitCode = 1;
});
