/**
 * Vercel Function for every /api/… call (vercel.json rewrites /api/:path* here as ?route=:path*).
 * All routing lives in src/server/aiProxy.ts; keys come from the project's environment variables.
 */
import { handleAiRequest } from "../src/server/aiProxy.js";

const handle = (request: Request) => {
  const url = new URL(request.url);
  return handleAiRequest(request, url.searchParams.get("route") ?? "", process.env);
};

export const GET = handle;
export const POST = handle;
