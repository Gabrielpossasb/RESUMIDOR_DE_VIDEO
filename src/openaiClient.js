import OpenAI from "openai";

export function createOpenAIClient(apiKey) {
  return new OpenAI({ apiKey });
}
