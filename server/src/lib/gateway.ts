import { createGateway } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// ==============================================================================
// PROVIDER CONFIGURATION - Choose your provider below
// ==============================================================================

// OPTION 1: Vercel AI Gateway (shared rate limits, multiple providers)
// Set AI_GATEWAY_API_KEY in your .env file
// Pros: Access to multiple providers, serverless-friendly
// Cons: Shared rate limits, may hit API limits faster
// const gateway = createGateway({
//   apiKey: process.env.AI_GATEWAY_API_KEY,
// });
// export const model = gateway("anthropic/claude-sonnet-4");

// OPTION 2: Direct Anthropic API (requires separate API account)
// Set ANTHROPIC_API_KEY in your .env file
// Pros: Your own rate limits, no gateway overhead
// Cons: Anthropic models only
// const anthropic = createAnthropic({
//   apiKey: process.env.ANTHROPIC_API_KEY,
// });
// export const model = anthropic("claude-sonnet-4-5-20250929");

// OPTION 3: Groq (ultra-fast inference)
// Set GROQ_API_KEY in your .env file
// Pros: Extremely fast inference speeds, generous free tier
// Cons: Limited model selection, rate limits on free tier
// const groq = createGroq({
//   apiKey: process.env.GROQ_API_KEY,
// });
// export const model = groq("openai/gpt-oss-120b");

// OPTION 4: Google Vertex AI (Gemini models)
// Set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_VERTEX_PROJECT, and GOOGLE_VERTEX_LOCATION in your .env file
// Pros: Access to latest Gemini models, Google Cloud integration
// Cons: Requires Google Cloud project setup and service account
// const vertex = createVertex({
//   project: process.env.GOOGLE_VERTEX_PROJECT,
//   location: process.env.GOOGLE_VERTEX_LOCATION
// });
// export const model = vertex("gemini-1.5-flash");

// OPTION 5: Google AI Studio (Gemini models directly with API key)
// Set GOOGLE_GENERATIVE_AI_API_KEY in your .env file
// Pros: Easy setup, works perfectly with `gen-lang-client` projects
// Cons: Rate limits on free tier
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY
});
const Agent_model = process.env.AGENT_MODEL || "gemini-2.5-pro";
export const model = google(Agent_model);


// OPTION 6: OpenRouter (free models, unified API gateway)
// Set OPENROUTER_API_KEY in your .env file
// Pros: Free tier models available, multimodal vision support, native function calling
// Cons: Rate limits on free tier, model availability may vary
// Active model: google/gemma-4-31b-it:free (262K ctx, vision + image input, native function calling)
// const openrouter = createOpenRouter({
//   apiKey: process.env.OPENROUTER_API_KEY,
// });
// export const model = openrouter.chat("google/gemma-4-31b-it:free");


// ==============================================================================
// TO SWITCH PROVIDERS:
// 1. Comment out the current model export above
// 2. Uncomment your preferred provider's model export
// 3. Set the corresponding API key/credentials in server/.env:
//    - For Gateway: AI_GATEWAY_API_KEY=your_gateway_key
//    - For Anthropic: ANTHROPIC_API_KEY=your_anthropic_key
//    - For Groq: GROQ_API_KEY=your_groq_key
//    - For Vertex AI:
//      * GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
//      * GOOGLE_VERTEX_PROJECT=your-project-id
//      * GOOGLE_VERTEX_LOCATION=us-central1 (or your preferred region)
//    - For Google AI Studio:
//      * GOOGLE_GENERATIVE_AI_API_KEY=your_genai_api_key
// ==============================================================================

// Alternative models:
// Via Gateway:
// export const opus = gateway("anthropic/claude-opus-4");
// export const gpt4 = gateway("openai/gpt-4o");
// export const gemini = gateway("google/gemini-2.0-flash");
//
// Via Direct Anthropic:
// export const opus = anthropic("claude-opus-4-6");
// export const haiku = anthropic("claude-haiku-4-5-20251001");
//
// Via Groq:
// export const llama70b = groq("llama-3.1-70b-versatile");
// export const mixtral = groq("mixtral-8x7b-32768");
// export const gemma = groq("gemma2-9b-it");
//
// Via Vertex AI (requires vertex instance created with createVertex):
// const vertex = createVertex({
//   project: process.env.GOOGLE_VERTEX_PROJECT,
//   location: process.env.GOOGLE_VERTEX_LOCATION || "us-central1",
// });
// export const gemini31Pro = vertex("gemini-3.1-pro-preview");
// export const gemini25Pro = vertex("gemini-2.5-pro");
// export const gemini25Flash = vertex("gemini-2.5-flash");
