import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// Make sure your API key is set in your environment before running this script

const model = new ChatOpenAI({
  model: "gpt-4o-mini"
});

const joke = z.object({
  setup: z.string().describe("The setup of the joke"),
  punchline: z.string().describe("The punchline to the joke"),
  rating: z.number().describe("How funny the joke is, from 1 to 10"),
});

const structuredLlm = model.withStructuredOutput(joke);

async function main() {
  const result = await structuredLlm.invoke("Tell me a joke about cats");
  console.log(result);
}

main().catch(console.error);