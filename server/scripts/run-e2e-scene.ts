import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Must run before importing remotion-agent.js: that module (via gateway.js)
// reads provider API keys/model IDs from process.env at import time, so
// loading .env after the static import (as this script previously did) meant
// values here were silently ignored in favor of whatever was already in the
// ambient shell environment.
config({ path: resolve(__dirname, "../.env") });

const { remotionAgent } = await import("../src/agents/remotion-agent.js");
const { renderStates } = await import("../src/lib/render-state.js");

async function run() {
  try {
    const jsonPath = resolve(process.cwd(), "../remotion/prompts/scene-email-feature.json");
    console.log(`[E2E] Loading scene JSON from ${jsonPath}...`);
    const jsonContent = await readFile(jsonPath, "utf-8");
    const sceneContext = JSON.parse(jsonContent);

    const payloadText = `[SCENE_JSON_PAYLOAD:\n\`\`\`json\n${JSON.stringify(sceneContext, null, 2)}\n\`\`\`\n]`;
    const prompt = `${payloadText}\n\nPlease generate this scene according to the provided JSON payload. You must write the scene code, trigger the preview, and render the scene.`;

    console.log("[E2E] Starting agent execution...");
    const result = await remotionAgent.generate({
      messages: [{ role: "user", content: prompt }],
      onStepFinish: ({ stepNumber, toolCalls }) => {
        if (toolCalls && toolCalls.length > 0) {
          console.log(`[E2E] Step ${stepNumber} executed tools: ${toolCalls.map(tc => tc.toolName).join(", ")}`);
        }
      }
    });

    console.log("[E2E] Agent finished its tool loop.");

    // Determine the scene ID
    let sceneId = sceneContext.scene?.id || "feature-email";
    
    console.log(`[E2E] Checking render completion for scene ID: ${sceneId}...`);
    
    let renderedVideoUrl = "";
    
    for (let i = 0; i < 60; i++) {
      const state = renderStates.get(sceneId);
      if (state) {
        if (state.status === "complete") {
          renderedVideoUrl = state.videoUrl || `/previews/${sceneId}.mp4`;
          break;
        } else if (state.status === "failed") {
          throw new Error(`Render failed: ${state.errorOutput.join("\n")}`);
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    const generatedCodePath = resolve(process.cwd(), `../remotion/src/scenes/${sceneId}.tsx`);
    const finalVideoPath = resolve(process.cwd(), `../remotion/public/previews/${sceneId}.mp4`);

    console.log("\n========================================================");
    console.log("               E2E TEST COMPLETE");
    console.log("========================================================");
    console.log(`✅ Generated TSX Code: ${generatedCodePath}`);
    console.log(`✅ Final Rendered Video: ${finalVideoPath}`);
    console.log("========================================================\n");
    
    process.exit(0);

  } catch (err) {
    console.error("[E2E] Test Failed:", err);
    process.exit(1);
  }
}

run();
