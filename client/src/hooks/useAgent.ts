import { useChat, Chat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName, UIMessage } from "ai";
import { useState, useCallback, useEffect, useRef, useDeferredValue, useMemo } from "react";
import { AgentStep } from "@/lib/agentTypes";
import { apiFetch, toUserFacingErrorMessage } from "@/lib/api";

interface UseAgentOptions {
  sceneId?: number | string | "all";
  sceneContext?: Record<string, unknown>;
  onRenderComplete?: (sceneId: string, videoUrl: string) => void;
  assets?: string[];
  projectId?: string;
}

interface SendMessageOverrides {
  sceneId?: number | string | "all";
  sceneContext?: Record<string, unknown>;
  assets?: string[];
  projectId?: string;
}

interface UseAgentReturn {
  steps: AgentStep[];
  isProcessing: boolean;
  sendMessage: (content: string, overrides?: SendMessageOverrides) => void;
  error: Error | null;
  latestPreviewUrl: string | null;
  latestPreviewSceneId: string | null;
  latestVideoUrl: string | null;
  renderError: { sceneId: string; message: string } | null;
}

function makeChat(
  sceneId: number | string | "all" | undefined,
  sceneContext: Record<string, unknown> | undefined,
  assets?: string[],
  projectId?: string
) {
  return new Chat<UIMessage>({
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      body: { sceneId, sceneContext, assets, projectId },
      fetch: (input, init) => apiFetch(input as RequestInfo | URL, init),
    }),
  });
}

export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const { sceneId, sceneContext, onRenderComplete, assets, projectId } = options;
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [latestPreviewUrl, setLatestPreviewUrl] = useState<string | null>(null);
  const [latestPreviewSceneId, setLatestPreviewSceneId] = useState<
    string | null
  >(null);
  const [latestVideoUrl, setLatestVideoUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<{ sceneId: string; message: string } | null>(null);
  const stepIdRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const renderPollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const onRenderCompleteRef = useRef(onRenderComplete);
  onRenderCompleteRef.current = onRenderComplete;

  // Use refs for scene data so sendMessage always reads current values
  // (avoids stale closure when called before React re-renders)
  const sceneIdRef = useRef(sceneId);
  const sceneContextRef = useRef(sceneContext);
  const assetsRef = useRef(assets);
  const projectIdRef = useRef(projectId);
  sceneIdRef.current = sceneId;
  sceneContextRef.current = sceneContext;
  assetsRef.current = assets;
  projectIdRef.current = projectId;

  // Chat instance in state — swapped on each sendMessage for clean isolation
  const [currentChat, setCurrentChat] = useState<Chat<UIMessage>>(
    () => makeChat(sceneId, sceneContext, assets, projectId),
  );

  const {
    status,
    error,
    messages,
  } = useChat({ chat: currentChat });

  const normalizedError = useMemo(() => {
    if (!error) {
      return null;
    }

    return new Error(toUserFacingErrorMessage(error));
  }, [error]);

  const isProcessing = status === "streaming" || status === "submitted";

  // Cleanup polling intervals on unmount
  useEffect(() => {
    const activeIntervals = renderPollIntervalsRef.current;
    return () => {
      activeIntervals.forEach((interval) =>
        clearInterval(interval),
      );
      activeIntervals.clear();
    };
  }, []);

  const startRenderPolling = useCallback((renderSceneId: string, videoUrl: string) => {
    const existing = renderPollIntervalsRef.current.get(renderSceneId);
    if (existing) clearInterval(existing);

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/agent/render-status/${renderSceneId}`,
        );
        const data = (await response.json()) as {
          status: string;
          error?: string;
        };

        if (data.status === "complete") {
          setLatestVideoUrl(videoUrl);
          clearInterval(pollInterval);
          renderPollIntervalsRef.current.delete(renderSceneId);
          onRenderCompleteRef.current?.(renderSceneId, videoUrl);
          console.log(`[useAgent] ✅ Render complete for ${renderSceneId}`);
        } else if (data.status === "failed") {
          // Background render died (compile error, timeout, etc.) — without this,
          // the UI just keeps showing the live code preview forever with no
          // indication the actual video render never finished.
          clearInterval(pollInterval);
          renderPollIntervalsRef.current.delete(renderSceneId);
          setRenderError({
            sceneId: renderSceneId,
            message: data.error || "Render failed",
          });
          console.error(`[useAgent] ❌ Render failed for ${renderSceneId}: ${data.error}`);
        }
      } catch (err) {
        console.error(`[useAgent] Poll error for ${renderSceneId}:`, err);
      }
    }, 2000);

    renderPollIntervalsRef.current.set(renderSceneId, pollInterval);
  }, []);

  // Process messages to extract tool calls and build steps
  useEffect(() => {
    if (messages.length === 0) return;

    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) {
      if (isProcessing) {
        setSteps([
          {
            id: 1,
            type: "thinking",
            label: "Agent is planning...",
            timestamp: Date.now() - startTimeRef.current,
            status: "active",
            streamingContent: [],
          },
        ]);
      }
      return;
    }

    const lastMessage = assistantMessages[assistantMessages.length - 1];
    if (!lastMessage.parts) return;

    const newSteps: AgentStep[] = [];
    let stepId = 0;
    let foundPreviewUrl: string | null = null;
    let foundPreviewSceneId: string | null = null;
    let foundVideoUrl: string | null = null;

    for (const part of lastMessage.parts) {
      if (isToolUIPart(part)) {
        const toolName = getToolName(part);
        stepId++;

        const input =
          part.state === "input-available" || part.state === "output-available"
            ? (part.input as Record<string, unknown>)
            : {};
        const output =
          part.state === "output-available" ? part.output : undefined;

        const step = toolCallToAgentStep(
          toolName,
          input,
          stepId,
          startTimeRef.current,
          output,
        );
        newSteps.push(step);

        // Extract preview URL from triggerPreview result
        if (
          toolName === "triggerPreview" &&
          part.state === "output-available" &&
          part.output
        ) {
          const result = part.output as {
            previewUrl?: string;
            sceneId?: string;
          };
          if (result.previewUrl) foundPreviewUrl = result.previewUrl;
          if (result.sceneId) foundPreviewSceneId = result.sceneId;
        }

        // Extract video URL from renderScene result
        if (
          toolName === "renderScene" &&
          part.state === "output-available" &&
          part.output
        ) {
          const result = part.output as {
            success?: boolean;
            status?: string;
            videoUrl?: string;
            sceneId?: string;
          };
          if (result.success && result.status === "rendering" && result.sceneId) {
            // Background render — start polling
            startRenderPolling(result.sceneId, result.videoUrl || "");
          } else if (result.success && result.videoUrl) {
            // Synchronous render (fallback)
            foundVideoUrl = result.videoUrl;
          }
        }
      }
    }

    // If processing but no tool parts yet, show placeholder
    if (isProcessing && newSteps.length === 0) {
      newSteps.push({
        id: ++stepId,
        type: "thinking",
        label: "Agent is planning...",
        timestamp: Date.now() - startTimeRef.current,
        status: "active",
        streamingContent: [],
      });
    }

    if (foundPreviewUrl) setLatestPreviewUrl(foundPreviewUrl);
    if (foundPreviewSceneId) setLatestPreviewSceneId(foundPreviewSceneId);
    if (foundVideoUrl) setLatestVideoUrl(foundVideoUrl);

    // Add completion step when processing is done
    if (newSteps.length > 0 && !isProcessing) {
      const lastStep = newSteps[newSteps.length - 1];
      if (lastStep.type !== "complete") {
        const textContent = lastMessage.parts
          .filter(
            (p): p is { type: "text"; text: string } =>
              p.type === "text" &&
              typeof (p as { text?: unknown }).text === "string" &&
              ((p as { text: string }).text.length > 0),
          )
          .map((p) => p.text)
          .join(" ");

        newSteps.push({
          id: ++stepId,
          type: "complete",
          label: "Request completed",
          timestamp: Date.now() - startTimeRef.current,
          status: "complete",
          brief: extractBriefFromMessage(textContent),
          previewUrl: foundPreviewUrl || undefined,
          videoUrl: foundVideoUrl || undefined,
        });
      }
    }

    setSteps(newSteps);
  }, [messages, isProcessing, startRenderPolling]);

  const sendMessage = useCallback(
    (content: string, overrides?: SendMessageOverrides) => {
      // Create a fresh Chat instance with a new transport — gives each scene a
      // completely clean message history so the agent never sees prior context.
      // Use overrides if provided (for scene transitions), else fall back to refs.
      const effectiveSceneId = overrides?.sceneId ?? sceneIdRef.current;
      const effectiveContext = overrides?.sceneContext ?? sceneContextRef.current;
      const effectiveAssets = overrides?.assets ?? assetsRef.current;
      const effectiveProjectId = overrides?.projectId ?? projectIdRef.current;
      const freshChat = makeChat(effectiveSceneId, effectiveContext, effectiveAssets, effectiveProjectId);
      setCurrentChat(freshChat);

      // Reset per-message state
      startTimeRef.current = Date.now();
      stepIdRef.current = 0;
      setLatestPreviewUrl(null);
      setLatestPreviewSceneId(null);
      setLatestVideoUrl(null);
      setRenderError(null);

      // Immediate feedback so the UI responds within one frame
      setSteps([
        {
          id: 1,
          type: "thinking",
          label: "Connecting to AI agent...",
          timestamp: 0,
          status: "active",
          streamingContent: [],
        },
      ]);

      // Send on the fresh chat directly (don't wait for React re-render)
      freshChat.sendMessage({ text: content });
    },
    [], // No dependencies — uses overrides or refs
  );

  
  const deferredSteps = useDeferredValue(steps);
  
  return {
    steps: deferredSteps,

    isProcessing,
    sendMessage,
    error: normalizedError,
    latestPreviewUrl,
    latestPreviewSceneId,
    latestVideoUrl,
    renderError,
  };
}

// Map tool calls to AgentStep types
function toolCallToAgentStep(
  toolName: string,
  args: Record<string, unknown>,
  stepId: number,
  startTime: number,
  result?: unknown,
): AgentStep {
  const isComplete = result !== undefined;
  const timestamp = Date.now() - startTime;

  switch (toolName) {
    case "think":
      return {
        id: stepId,
        type: "thinking",
        label: isComplete ? "Reasoned through the request" : "Reasoning...",
        timestamp,
        status: isComplete ? "complete" : "active",
        streamingContent: (
          (args as { thoughts?: unknown[] }).thoughts || []
        ).filter((t): t is string => typeof t === "string" && t.length > 0),
        duration: isComplete ? Math.round(timestamp / 1000) : undefined,
      };

    case "readFile": {
      const readResult = result as
        | { success?: boolean; lines?: number; path?: string }
        | undefined;
      return {
        id: stepId,
        type: "explore",
        label: isComplete ? "Read file" : "Reading file...",
        timestamp,
        status: isComplete ? "complete" : "active",
        files: [(args as { path?: string }).path || "unknown"],
        brief: readResult?.success ? `${readResult.lines} lines` : undefined,
      };
    }

    case "listFiles": {
      const listResult = result as
        | { files?: { name: string }[]; count?: number }
        | undefined;
      return {
        id: stepId,
        type: "explore",
        label: isComplete ? "Listed files" : "Listing files...",
        timestamp,
        status: isComplete ? "complete" : "active",
        files: [(args as { path?: string }).path || "/"],
        fileCount: listResult?.count || listResult?.files?.length,
      };
    }

    case "writeSceneCode": {
      const writeResult = result as
        | { success?: boolean; fileName?: string; sceneId?: string }
        | undefined;
      return {
        id: stepId,
        type: "update",
        label: isComplete ? "Wrote scene code" : "Writing scene code...",
        timestamp,
        status: isComplete ? "complete" : "active",
        files: [(args as { fileName?: string }).fileName || "unknown"],
        brief: writeResult?.success
          ? `Scene: ${writeResult.sceneId}`
          : undefined,
      };
    }

    case "triggerPreview": {
      const previewResult = result as
        | { success?: boolean; previewUrl?: string; sceneId?: string }
        | undefined;
      return {
        id: stepId,
        type: "preview",
        label: isComplete
          ? "Registered composition"
          : "Registering composition...",
        timestamp,
        status: isComplete ? "complete" : "active",
        previewUrl: previewResult?.previewUrl,
        brief: previewResult?.success
          ? `Registered: ${previewResult.sceneId}`
          : undefined,
      };
    }

    case "renderScene": {
      const renderResult = result as
        | {
            success?: boolean;
            status?: string;
            videoUrl?: string;
            sceneId?: string;
            elapsedSeconds?: number;
          }
        | undefined;
      const isBackground = renderResult?.status === "rendering";
      return {
        id: stepId,
        type: "render",
        label: isComplete
          ? isBackground
            ? "Render started in background"
            : "Video rendered"
          : "Rendering video...",
        timestamp,
        status: isComplete ? "complete" : "active",
        videoUrl:
          renderResult?.success && !isBackground
            ? renderResult.videoUrl
            : undefined,
        renderSceneId: (args as { sceneId?: string }).sceneId,
        brief: renderResult?.success
          ? isBackground
            ? `Background render started → ${renderResult.videoUrl}`
            : `Done in ${renderResult.elapsedSeconds?.toFixed(1)}s → ${renderResult.videoUrl}`
          : renderResult
            ? "Render failed"
            : undefined,
      };
    }

    
    case "generateImage": {
      const imageResult = result as { success?: boolean; imageUrl?: string; prompt?: string } | undefined;
      return {
        id: stepId,
        type: "image",
        label: isComplete ? "Image generated" : "Generating image...",
        timestamp,
        status: isComplete ? "complete" : "active",
        imageUrl: imageResult?.imageUrl,
        imagePrompt: (args as { prompt?: string }).prompt,
      };
    }

    default:

      return {
        id: stepId,
        type: "generate",
        label: isComplete ? `Executed ${toolName}` : `Executing ${toolName}...`,
        timestamp,
        status: isComplete ? "complete" : "active",
      };
  }
}

// Extract a brief summary from the final message
function extractBriefFromMessage(content: string): string {
  if (!content) return "Done!";

  const firstSentence = content.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length <= 100) {
    return firstSentence.trim() + ".";
  }
  if (content.length <= 100) {
    return content.trim();
  }
  return content.slice(0, 100).trim() + "...";
}
