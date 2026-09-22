import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Play, Pause, Download, Loader2, Check, ArrowLeft, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Scene, framesToSeconds } from "@/lib/mockData";
import { AgentStep } from "@/lib/agentTypes";
import { getUploadedAssetUrl, type UploadedAssetLike } from "@/lib/upload";
import {
  createProjectFromScenes,
  saveProject,
  getProject,
  updateProjectSceneStatus,
  updateProjectAgentSteps,
  updateProjectSceneAudioTrack,
  addSceneVersion,
  restoreSceneVersion,
  getSceneVersions,
  getSceneCurrentVersion,
  StoredProject,
  AudioTrack,
  SceneVersion,
} from "@/lib/storage";
import { useAgent } from "@/hooks/useAgent";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SceneList from "@/components/editor/SceneList";
import AssetList from "@/components/editor/AssetList";
import AudioTrackSelector from "@/components/editor/AudioTrackSelector";
import MainPreview from "@/components/editor/MainPreview";
import { CombinedVideoPlayerHandle } from "@/components/editor/CombinedVideoPlayer";
import VideoOutput from "@/components/editor/VideoOutput";
import AgentThoughts from "@/components/editor/AgentThoughts";
import FullscreenPreviewModal from "@/components/editor/FullscreenPreviewModal";
import AddSceneModal from "@/components/editor/AddSceneModal";
import SceneVersionHistory from "@/components/editor/SceneVersionHistory";
import ExportModal from "@/components/editor/ExportModal";

interface SceneStatus {
  status: "queued" | "generating" | "complete";
  progress: number;
  previewUrl?: string;
  previewSceneId?: string;
  videoUrl?: string;
}

const EditorPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prompt = (location.state as any)?.prompt || "Your product";
  const passedScenes: Scene[] = (location.state as any)?.scenes || [];
  const passedProjectId: string | undefined = (location.state as any)?.projectId;
  const fromVideos: boolean = (location.state as any)?.fromVideos || false;
  const passedSceneStatuses: SceneStatus[] | undefined = (location.state as any)?.sceneStatuses;
  const passedSceneSteps: Record<number, AgentStep[]> | undefined = (location.state as any)?.sceneSteps;
  const passedAssets: string[] = ((location.state as any)?.assets as UploadedAssetLike[] || []).map(getUploadedAssetUrl);
  const brandColors: string[] = (location.state as any)?.brandColors || [];
  const brandName: string | undefined = (location.state as any)?.brandName;
  const brandFonts: { role?: string; family: string }[] = (location.state as any)?.brandFonts || [];
  const brandLogos: string[] = (location.state as any)?.brandLogos || [];
  const brandBackdrops: string[] = (location.state as any)?.brandBackdrops || [];

  const [scenes, setScenes] = useState<Scene[]>(passedScenes);
  const [selectedScene, setSelectedScene] = useState<number | "all">(0);
  const [sceneStatuses, setSceneStatuses] = useState<SceneStatus[]>(
    passedScenes.map((_, i) => ({
      status: i === 0 ? "generating" : "queued",
      progress: 0,
    })),
  );

  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);

  // Panel size for responsive layout
  const [videoPanelSize, setVideoPanelSize] = useState(30);

  // Ref to the HTML video element inside MainPreview — used for real-time scrubbing
  const videoRef = useRef<HTMLVideoElement>(null);
  // Ref for combined video player
  const combinedPlayerRef = useRef<CombinedVideoPlayerHandle>(null);

  // Single scene timeline state
  const [singleSceneTime, setSingleSceneTime] = useState(0);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(
    null,
  );
  const [isFullscreenPreviewOpen, setIsFullscreenPreviewOpen] = useState(false);
  const [isAddSceneModalOpen, setIsAddSceneModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Track steps per scene from agent
  const [sceneSteps, setSceneSteps] = useState<Record<number, AgentStep[]>>({});

  // Audio track state
  const [audioTrack, setAudioTrack] = useState<AudioTrack | undefined>(undefined);

  const totalDuration = scenes.reduce((a, s) => a + framesToSeconds(s.duration), 0);

  // All renders complete — for loaded/completed projects trust the "complete" status directly
  // (videoUrl may not be in localStorage if the user navigated away before polling finished).
  // For fresh generations, require videoUrl to confirm the Remotion render finished this session.
  const allRendered = allDone && (
    (passedProjectId != null && sceneStatuses.every(s => s.status === "complete")) ||
    sceneStatuses.every(s => s.status === "complete" && !!s.videoUrl)
  );

  // Track whether the user manually overrode scene selection
  const userOverrodeSelectionRef = useRef(false);

  // Queue for newly-added scenes that need processing after state updates
  const pendingNewSceneRef = useRef<{ index: number; overrides?: { assets?: string[] } } | null>(null);

  // Map from Remotion composition ID → scene index (for render tracking)
  const renderingScenesByIdRef = useRef<Map<string, number>>(new Map());

  // Current project ID for localStorage persistence
  const currentProjectIdRef = useRef<string | null>(passedProjectId || null);

  // Callback fired by useAgent polling when a background render finishes
  const handleRenderComplete = useCallback(
    (renderSceneId: string, videoUrl: string) => {
      const sceneIndex = renderingScenesByIdRef.current.get(renderSceneId);
      if (sceneIndex !== undefined) {
        setSceneStatuses((prev) =>
          prev.map((s, i) =>
            i === sceneIndex ? { ...s, videoUrl } : s,
          ),
        );
        renderingScenesByIdRef.current.delete(renderSceneId);

        // Save to localStorage
        if (currentProjectIdRef.current) {
          updateProjectSceneStatus(
            currentProjectIdRef.current,
            sceneIndex,
            "complete",
            videoUrl
          );
        }
      }
    },
    [],
  );

  // Use the agent for the current scene being processed
  const currentScene = scenes[currentSceneIndex];
  const {
    steps: agentSteps,
    isProcessing,
    sendMessage,
    error,
    latestPreviewUrl,
    latestPreviewSceneId,
    latestVideoUrl,
    renderError,
  } = useAgent({
    sceneId: currentScene?.id?.toString() || "unknown",
    sceneContext: currentScene ? (currentScene as unknown as Record<string, unknown>) : undefined,
    onRenderComplete: handleRenderComplete,
  });

  // Track if we've started processing
  const hasStartedRef = useRef(false);
  const processingSceneRef = useRef<number | null>(null);
  // Track which scenes we've already triggered completion for (prevents double-firing)
  const completedScenesRef = useRef<Set<number>>(new Set());
  // Track if we're transitioning between scenes (prevents using stale agentSteps)
  const transitioningRef = useRef(false);

  // Initialize project in localStorage on mount
  useEffect(() => {
    // Case 1: Coming back from ExportPage with sceneStatuses already in state
    if (passedProjectId && passedSceneStatuses) {
      currentProjectIdRef.current = passedProjectId;
      setSceneStatuses(passedSceneStatuses);
      // Restore sceneSteps from state or localStorage
      if (passedSceneSteps) {
        setSceneSteps(passedSceneSteps);
      } else {
        const savedProject = getProject(passedProjectId);
        if (savedProject?.agentSteps) {
          setSceneSteps(savedProject.agentSteps);
        }
      }
      const allComplete = passedSceneStatuses.every((s) => s.status === "complete");
      if (allComplete) {
        setAllDone(true);
        hasStartedRef.current = true;
      }
    }
    // Case 2: Coming from VideosPage - load from localStorage
    else if (passedProjectId) {
      const savedProject = getProject(passedProjectId);
      if (savedProject) {
        currentProjectIdRef.current = savedProject.id;
        const restoredStatuses = savedProject.scenes.map((s) => ({
          status: s.generationStatus,
          progress: s.generationStatus === "complete" ? 100 : 0,
          videoUrl: s.videoUrl,
          previewUrl: s.previewUrl,
        }));
        setSceneStatuses(restoredStatuses);
        if (savedProject.agentSteps) {
          setSceneSteps(savedProject.agentSteps);
        }
        if (savedProject.status === "complete") {
          setAllDone(true);
          hasStartedRef.current = true;
        }
      }
    }
    // Case 3: New generation - create project
    else if (passedScenes.length > 0 && !currentProjectIdRef.current) {
      const newProject = createProjectFromScenes(prompt, passedScenes);
      saveProject(newProject);
      currentProjectIdRef.current = newProject.id;
    }
  }, []);

  // Start processing the first scene (only for new projects)
  useEffect(() => {
    if (!hasStartedRef.current && scenes.length > 0) {
      hasStartedRef.current = true;
      startProcessingScene(0);
    }
  }, [scenes]);

  // Process newly-added scenes once React state has committed their addition
  useEffect(() => {
    const pending = pendingNewSceneRef.current;
    if (pending && scenes.length > pending.index && scenes[pending.index]) {
      pendingNewSceneRef.current = null;
      if (processingSceneRef.current === null) {
        if (allDone) setAllDone(false);
        startProcessingScene(pending.index, pending.overrides);
      }
      // If something is currently processing, the sequential completion handler
      // will pick up the new queued scene automatically when it finishes.
    }
  }, [scenes.length, allDone]);

  // Auto-follow the active scene during generation (unless user overrode)
  useEffect(() => {
    if (!userOverrodeSelectionRef.current) {
      setSelectedScene(currentSceneIndex);
    }
  }, [currentSceneIndex]);

  // Reset user override when all done
  useEffect(() => {
    if (allDone) {
      userOverrodeSelectionRef.current = false;
    }
  }, [allDone]);

  // Spacebar to toggle play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, playheadTime, totalDuration]);

  // Show player preview immediately when triggerPreview completes — don't wait for awaitRender
  useEffect(() => {
    if (!latestPreviewUrl || processingSceneRef.current === null) return;
    const sceneIndex = processingSceneRef.current;
    setSceneStatuses((prev) =>
      prev.map((s, i) =>
        i === sceneIndex
          ? {
              ...s,
              previewUrl: latestPreviewUrl,
              previewSceneId: latestPreviewSceneId ?? undefined,
            }
          : s,
      ),
    );
  }, [latestPreviewUrl, latestPreviewSceneId]);

  // Update steps for current scene as agent processes
  useEffect(() => {
    if (processingSceneRef.current !== null && agentSteps.length > 0) {
      setSceneSteps((prev) => ({
        ...prev,
        [processingSceneRef.current!]: agentSteps,
      }));

      // Update progress based on steps
      const progress = Math.min(
        Math.round((agentSteps.length / 6) * 100), // Assume ~6 steps per scene
        99,
      );
      setSceneStatuses((prev) =>
        prev.map((s, i) =>
          i === processingSceneRef.current ? { ...s, progress } : s,
        ),
      );

      // Register render steps for background-render tracking
      for (const step of agentSteps) {
        if (step.type === "render" && step.renderSceneId) {
          const key = step.renderSceneId;
          if (!renderingScenesByIdRef.current.has(key)) {
            renderingScenesByIdRef.current.set(
              key,
              processingSceneRef.current!,
            );
          }
        }
      }
    }
  }, [agentSteps]);

  // Handle scene completion when agent finishes
  useEffect(() => {
    // Clear transition flag once the new scene's agent starts processing
    if (transitioningRef.current && isProcessing) {
      transitioningRef.current = false;
    }

    // Don't process completion while transitioning (agentSteps may be stale)
    if (transitioningRef.current) return;

    if (
      !isProcessing &&
      processingSceneRef.current !== null &&
      agentSteps.length > 0
    ) {
      const sceneIndex = processingSceneRef.current;

      // Guard: skip if we've already handled completion for this scene
      if (completedScenesRef.current.has(sceneIndex)) return;

      const hasCompleteStep = agentSteps.some((s) => s.type === "complete");

      if (hasCompleteStep) {
        // Guard: skip if already marked complete in state (belt and suspenders)
        const currentStatus = sceneStatuses[sceneIndex];
        if (currentStatus?.status === "complete") return;

        // Mark this scene as handled BEFORE any state updates
        completedScenesRef.current.add(sceneIndex);

        // Mark scene as complete — videoUrl may still be undefined if render is async
        setSceneStatuses((prev) =>
          prev.map((s, i) =>
            i === sceneIndex
              ? {
                  status: "complete",
                  progress: 100,
                  previewUrl: latestPreviewUrl || undefined,
                  previewSceneId: latestPreviewSceneId || undefined,
                  videoUrl: latestVideoUrl || undefined,
                }
              : s,
          ),
        );

        // Save to localStorage (videoUrl may arrive later via handleRenderComplete)
        if (currentProjectIdRef.current) {
          updateProjectSceneStatus(
            currentProjectIdRef.current,
            sceneIndex,
            "complete",
            latestVideoUrl || undefined,
            latestPreviewUrl || undefined
          );
          updateProjectAgentSteps(currentProjectIdRef.current, {
            [sceneIndex]: agentSteps,
          });
        }

        // Move to next scene immediately (don't wait for render)
        const nextIndex = sceneIndex + 1;
        if (nextIndex < scenes.length) {
          transitioningRef.current = true; // Mark transitioning to prevent stale step processing
          startProcessingScene(nextIndex);
        } else {
          setAllDone(true);
          processingSceneRef.current = null;
        }
      }
    }
  }, [
    isProcessing,
    agentSteps,
    latestPreviewUrl,
    latestPreviewSceneId,
    latestVideoUrl,
    scenes.length,
    sceneStatuses,
  ]);

  const startProcessingScene = useCallback(
    (sceneIndex: number, overrides?: { assets?: string[] }) => {
      const scene = scenes[sceneIndex];
      if (!scene) return;

      processingSceneRef.current = sceneIndex;
      setCurrentSceneIndex(sceneIndex);

      // Update status to generating
      setSceneStatuses((prev) =>
        prev.map((s, i) =>
          i === sceneIndex ? { ...s, status: "generating", progress: 0 } : s,
        ),
      );

      // Build the prompt for this scene
      const scenePrompt = buildScenePrompt(scene);

      // Pass scene data directly to avoid stale closure issues during transitions
      sendMessage(scenePrompt, {
        sceneId: String(scene.id),
        sceneContext: { ...scene, brandColors, brandName },
        assets: overrides?.assets || passedAssets
      });
    },
    [scenes, sendMessage],
  );

  // Build a structured prompt for the agent using the full scene JSON
  const buildScenePrompt = (scene: Scene): string => {
    const durationSeconds = framesToSeconds(scene.duration);
    let prompt = `Generate a Remotion scene based on this structured specification:

${JSON.stringify({ scene }, null, 2)}

Requirements:
1. Scene ID: "${scene.id}" — use this exact value for writeSceneCode fileName and triggerPreview sceneId
2. Duration: ${scene.duration} frames (${durationSeconds}s at 30fps)
3. Implement each element using the component name in element.component (if specified)
4. Apply animation timing from element.animation.timing (start frame, duration, spring preset)
5. Apply exit animations from element.exit config (frame, type, duration)
6. Use the Background component configured with: ${JSON.stringify(scene.background)}
7. Apply scene transition: ${JSON.stringify(scene.transition ?? { type: "blur", duration: 15 })}
8. Follow the notes: "${scene.notes ?? "Exit elements in order, stagger by 3 frames."}"`;

    let reqIdx = 9;
    if (brandColors && brandColors.length > 0) {
      prompt += `\n${reqIdx++}. BRAND COLORS (REQUIRED): Use these exact colors for backgrounds, text, and UI elements: ${brandColors.join(", ")}.`;
    }
    if (brandName) {
      prompt += `\n${reqIdx++}. BRAND NAME: Display "${brandName}" in titles, logos, or CTA copy where appropriate.`;
    }
    if (brandLogos && brandLogos.length > 0) {
      prompt += `\n${reqIdx++}. BRAND LOGOS: Use these logo URLs directly in Img components or as src props: ${brandLogos.join(", ")}`;
    }
    if (brandBackdrops && brandBackdrops.length > 0) {
      prompt += `\n${reqIdx++}. BRAND BACKDROPS: These backdrop/hero images are available for backgrounds: ${brandBackdrops.join(", ")}`;
    }
    if (brandFonts && brandFonts.length > 0) {
      const fontList = brandFonts.map(f => `${f.family}${f.role ? ` (${f.role})` : ""}`).join(", ");
      prompt += `\n${reqIdx++}. BRAND FONTS: Apply these font families via inline style fontFamily: ${fontList}.`;
    }
    if (passedAssets && passedAssets.length > 0) {
      prompt += `\n${reqIdx++}. UPLOADED ASSETS: The user has provided these assets — incorporate them into the scene using Img, MockupFrame, or as background src: ${passedAssets.join(", ")}`;
    }

    if (scene.audioTrack) {
      prompt += `\n11. AUDIO REQUIREMENT: Include this audio component anywhere in the scene JSX: <Audio src={staticFile("audio/${scene.audioTrack.trackId}.mp3")} volume={${scene.audioTrack.volume}} />. Import Audio and staticFile from "remotion".`;
    }

    prompt += `\n\nStart with the think tool to plan your approach, then writeSceneCode → triggerPreview → renderScene.`;
    return prompt;
  };

  const sceneStarts = useRef<number[]>([]);
  useEffect(() => {
    const starts: number[] = [];
    let acc = 0;
    for (const scene of scenes) {
      starts.push(acc);
      acc += framesToSeconds(scene.duration);
    }
    sceneStarts.current = starts;
  }, [scenes]);

  // Delete audio playhead sync logic since we're rendering it per-scene natively in remotion now.
  // We'll keep the AudioTrack state around purely for the UI selection, but playback is handled
  // by Remotion Studio and the final rendered MP4s.

  // Playhead animation and Video sync loop
  useEffect(() => {
    let animationFrameId: number;
    
    const tick = () => {
      // 1. Sync single scene time from video if available
      if (selectedScene !== "all" && typeof selectedScene === "number" && videoRef.current) {
        const vTime = videoRef.current.currentTime;
        setSingleSceneTime(vTime);
        
        // Sync isPlaying with video's play state
        const videoPlaying = !videoRef.current.paused;
        if (videoPlaying !== isPlaying) {
          setIsPlaying(videoPlaying);
        }
      } 
      // 2. Global playhead fallback when no video playing
      else if (selectedScene === "all") {
        if (isPlaying && allDone) {
          setPlayheadTime((t) => {
            const next = t + 16.66 / 1000; // rough 60fps delta
            if (next >= totalDuration) {
              setIsPlaying(false);
              return totalDuration;
            }
            return next;
          });
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [selectedScene, isPlaying, allDone, totalDuration, playheadTime]);

  const handleTogglePlay = () => {
    setIsPlaying(!isPlaying);
    if (playheadTime >= totalDuration) setPlayheadTime(0);
    // Sync video if we have the reference
    if (videoRef.current) {
      if (!isPlaying) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  };

  const handleReset = () => {
    setPlayheadTime(0);
    setIsPlaying(false);
  };

  const handleReorderScenes = (newScenes: Scene[]) => {
    setScenes(newScenes);
  };

  const handleSeek = (time: number) => {
    setPlayheadTime(time);
  };

  const handleSingleSceneSeek = (time: number) => {
    setSingleSceneTime(time);
  };

  // Real-time scrub: directly mutates video currentTime — no React state, no re-renders
  const handleScrub = useCallback((timeInSeconds: number) => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = timeInSeconds;
    }
  }, []);

  const handleTimestampSelect = (time: number | null) => {
    setSelectedTimestamp(time);
  };

  // Reset single scene state when changing scenes; record user override
  const handleSelectScene = (scene: number | "all") => {
    userOverrodeSelectionRef.current = true;
    setSelectedScene(scene);
    setSingleSceneTime(0);
    setSelectedTimestamp(null);
    if (scene !== "all" && typeof scene === "number") {
      setAudioTrack(scenes[scene]?.audioTrack);
    } else {
      setAudioTrack(undefined);
    }
  };

  const handlePrevScene = useCallback(() => {
    if (typeof selectedScene === "number" && selectedScene > 0) {
      handleSelectScene(selectedScene - 1);
    }
  }, [selectedScene]);

  const handleNextScene = useCallback(() => {
    if (typeof selectedScene === "number" && selectedScene < scenes.length - 1) {
      handleSelectScene(selectedScene + 1);
    }
  }, [selectedScene, scenes.length]);

  const handleAddScene = (type: "ai" | "upload", data: string, assets?: string[]) => {
    // Capture the index before the state update
    const newSceneIndex = scenes.length;
    const newSceneId = `scene-${Date.now()}`;

    // Build a strong prompt for the new scene
    const aiPrompt = type === "ai"
      ? data
      : `Create a scene featuring this uploaded media as the main visual element: ${data}`;

    const newScene: Scene = {
      id: newSceneId,
      name: type === "ai" ? "New Generated Scene" : "Uploaded Scene",
      category: "transition",
      duration: 150, // default 5 seconds
      background: { type: "gradient", colors: ["#4F46E5", "#10B981"] },
      elements: [],
      notes: aiPrompt,
    };

    setScenes(prev => [...prev, newScene]);
    setSceneStatuses(prev => [...prev, { status: "queued", progress: 0 }]);

    // Save to local storage
    if (currentProjectIdRef.current) {
      const project = getProject(currentProjectIdRef.current);
      if (project) {
        project.scenes.push({
          ...newScene,
          generationStatus: "queued"
        });
        saveProject(project);
      }
    }

    // Queue for processing after React commits the state update (avoids stale closure)
    const overrides = assets ? { assets } : undefined;
    pendingNewSceneRef.current = { index: newSceneIndex, overrides };
  };

  const handleSelectAudioTrack = (trackId: string | null) => {
    if (selectedScene === "all" || typeof selectedScene !== "number") return;
    
    const newTrack = trackId ? { trackId, volume: audioTrack?.volume ?? 0.3 } : undefined;
    setAudioTrack(newTrack);
    
    // Update local scenes state
    setScenes(prev => prev.map((s, i) => i === selectedScene ? { ...s, audioTrack: newTrack } : s));

    if (currentProjectIdRef.current) {
      updateProjectSceneAudioTrack(currentProjectIdRef.current, selectedScene, newTrack);
    }
  };

  const handleAudioVolumeChange = (volume: number) => {
    if (!audioTrack || selectedScene === "all" || typeof selectedScene !== "number") return;

    const newTrack = { ...audioTrack, volume };
    setAudioTrack(newTrack);

    // Update local scenes state
    setScenes(prev => prev.map((s, i) => i === selectedScene ? { ...s, audioTrack: newTrack } : s));

    if (currentProjectIdRef.current) {
      updateProjectSceneAudioTrack(currentProjectIdRef.current, selectedScene, newTrack);
    }
  };

  // ─── Scene Refinement & Versioning ────────────────────────────────────────────

  const handleRefinementStart = useCallback((sceneIndex: number, prompt: string) => {
    // Set scene status to "generating" to show loading state
    setSceneStatuses((prev) =>
      prev.map((s, i) =>
        i === sceneIndex ? { ...s, status: "generating", progress: 0 } : s
      )
    );

    // Update in localStorage
    if (currentProjectIdRef.current) {
      updateProjectSceneStatus(currentProjectIdRef.current, sceneIndex, "generating");
    }
  }, []);

  const handleRefinementComplete = useCallback((sceneIndex: number, videoUrl: string, prompt: string) => {
    // Update scene status to complete with new video URL
    setSceneStatuses((prev) =>
      prev.map((s, i) =>
        i === sceneIndex ? { ...s, status: "complete", progress: 100, videoUrl } : s
      )
    );

    // Add version to storage
    if (currentProjectIdRef.current) {
      addSceneVersion(currentProjectIdRef.current, sceneIndex, {
        videoUrl,
        prompt,
      });
      updateProjectSceneStatus(currentProjectIdRef.current, sceneIndex, "complete", videoUrl);
    }
  }, []);

  const handleRestoreVersion = useCallback((sceneIndex: number, versionIndex: number) => {
    if (!currentProjectIdRef.current) return;

    // Restore version in storage
    restoreSceneVersion(currentProjectIdRef.current, sceneIndex, versionIndex);

    // Get the restored version's video URL from storage
    const versions = getSceneVersions(currentProjectIdRef.current, sceneIndex);
    const restoredVersion = versions[versionIndex];

    if (restoredVersion) {
      // Update local state with restored video URL
      setSceneStatuses((prev) =>
        prev.map((s, i) =>
          i === sceneIndex ? { ...s, videoUrl: restoredVersion.videoUrl } : s
        )
      );
    }
  }, []);

  // Get version info for the current scene
  const currentSceneVersions = typeof selectedScene === "number" && currentProjectIdRef.current
    ? getSceneVersions(currentProjectIdRef.current, selectedScene)
    : [];
  const currentSceneVersionNumber = typeof selectedScene === "number" && currentProjectIdRef.current
    ? getSceneCurrentVersion(currentProjectIdRef.current, selectedScene)
    : 1;

  // Get version info for all scenes (for SceneList)
  const allSceneVersions = scenes.map((_, i) => {
    if (!currentProjectIdRef.current) return { currentVersion: 1, hasMultipleVersions: false };
    const versions = getSceneVersions(currentProjectIdRef.current, i);
    const currentVersion = getSceneCurrentVersion(currentProjectIdRef.current, i);
    return {
      currentVersion,
      hasMultipleVersions: versions.length > 1,
    };
  });

  const displayScene = selectedScene === "all" ? null : scenes[selectedScene];
  const displaySteps =
    selectedScene === "all" ? [] : sceneSteps[selectedScene] || [];
  const displayStatus =
    selectedScene === "all" ? null : sceneStatuses[selectedScene];

  const isGenerating = displayStatus?.status === "generating";
  const isComplete = displayStatus?.status === "complete";
  const isQueued = displayStatus?.status === "queued";
  const displayPreviewSceneId = displayStatus?.previewSceneId;
  const displayVideoUrl = displayStatus?.videoUrl;
  const anyGenerating = sceneStatuses.some((s) => s.status === "generating");

  const generatingStep = displaySteps[displaySteps.length - 1];
  const generatingMessage =
    isGenerating && generatingStep ? generatingStep.label : undefined;

  // Surface agent/AI-call failures instead of leaving the scene spinning forever
  // with no feedback (e.g. AI provider quota errors) — see useAgent's `error`.
  const isDisplayedSceneProcessing =
    typeof selectedScene === "number" && selectedScene === processingSceneRef.current;
  const streamErrorMessage =
    isGenerating && error && isDisplayedSceneProcessing ? error.message : undefined;
  // Background render failures (compile error, timeout, etc.) surface after the
  // agent's chat step already finished, so the scene may already read "complete"
  // with no videoUrl — without this it silently falls back to the live code
  // preview (or nothing) instead of telling the user the render never finished.
  const backgroundRenderErrorMessage =
    displayScene && renderError?.sceneId === String(displayScene.id)
      ? renderError.message
      : undefined;
  const displayErrorMessage = streamErrorMessage || backgroundRenderErrorMessage;

  const handleRetryCurrentScene = useCallback(() => {
    if (typeof selectedScene === "number") {
      startProcessingScene(selectedScene);
    }
  }, [selectedScene, startProcessingScene]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-card border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              fromVideos
                ? navigate("/videos")
                : navigate("/storyboard", { state: { prompt, scenes } })
            }
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <span
            className="font-semibold text-sm text-foreground"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {prompt.split(" ").slice(0, 4).join(" ")}
          </span>
          {!allDone && (
            <span className="flex items-center gap-1.5 text-[11px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating...
            </span>
          )}
          {allDone && (
            <span className="flex items-center gap-1.5 text-[11px] text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full">
              <Check className="h-3 w-3" />
              Complete
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allDone && !allRendered && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Rendering videos...
            </span>
          )}
          {(allDone || sceneStatuses.some(s => s.previewUrl || s.videoUrl)) && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-md text-xs border-border/60 text-muted-foreground hover:text-foreground"
                onClick={() => setIsFullscreenPreviewOpen(true)}
              >
                <Maximize className="h-3 w-3" />
                Preview
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-md text-xs bg-accent hover:bg-accent/90 text-accent-foreground"
                onClick={() =>
                  navigate("/export", {
                    state: {
                      prompt,
                      scenes,
                      projectId: currentProjectIdRef.current,
                      sceneStatuses,
                      sceneSteps,
                      audioTrack,
                    },
                  })
                }
              >
                <Download className="h-3 w-3" /> Export
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main content with resizable panels */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left: Scene List */}
        <ResizablePanel defaultSize={15} minSize={12} maxSize={25}>
          <Tabs defaultValue="scenes" className="h-full flex flex-col w-full border-r border-border">
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent h-12 p-0">
              <TabsTrigger 
                value="scenes" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none flex-1"
              >
                Scenes
              </TabsTrigger>
              <TabsTrigger 
                value="assets" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none flex-1"
              >
                Assets
              </TabsTrigger>
              <TabsTrigger 
                value="music" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none flex-1"
              >
                Music
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="scenes" className="flex-1 mt-0 overflow-hidden outline-none">
              <SceneList
                scenes={scenes}
                selectedScene={selectedScene}
                onSelectScene={handleSelectScene}
                sceneStatuses={sceneStatuses}
                onOpenAddScene={() => setIsAddSceneModalOpen(true)}
                sceneVersions={allSceneVersions}
                onReorderScenes={handleReorderScenes}
              />
            </TabsContent>
            
            <TabsContent value="assets" className="flex-1 mt-0 overflow-hidden outline-none">
              <AssetList sceneAssets={[...passedAssets, ...brandLogos, ...brandBackdrops].filter((v, i, a) => a.indexOf(v) === i)} />
            </TabsContent>

            <TabsContent value="music" className="flex-1 mt-0 overflow-hidden outline-none">
              <AudioTrackSelector
                selectedTrackId={audioTrack?.trackId || null}
                volume={audioTrack?.volume ?? 0.3}
                onSelectTrack={handleSelectAudioTrack}
                onVolumeChange={handleAudioVolumeChange}
              />
            </TabsContent>
          </Tabs>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center + Bottom */}
        <ResizablePanel defaultSize={55}>
          <ResizablePanelGroup direction="vertical">
            {/* Main Preview */}
            <ResizablePanel defaultSize={70}>
              <MainPreview
                scene={displayScene}
                isGenerating={isGenerating}
                isQueued={isQueued}
                isComplete={isComplete}
                isAllScenes={selectedScene === "all"}
                allScenesGenerating={anyGenerating}
                previewUrl={displayStatus?.previewUrl}
                previewSceneId={displayPreviewSceneId}
                videoUrl={displayVideoUrl}
                generatingMessage={generatingMessage}
                errorMessage={displayErrorMessage}
                onRetry={handleRetryCurrentScene}
                videoRef={videoRef}
                sceneIndex={typeof selectedScene === "number" ? selectedScene : undefined}
                sceneCount={scenes.length}
                onPrevScene={handlePrevScene}
                onNextScene={handleNextScene}
                onExport={() =>
                  navigate("/export", {
                    state: {
                      prompt,
                      scenes,
                      projectId: currentProjectIdRef.current,
                      sceneStatuses,
                      sceneSteps,
                      audioTrack,
                    },
                  })
                }
                onFullscreen={() => setIsFullscreenPreviewOpen(true)}
                // Combined video props
                allScenes={scenes}
                allVideoUrls={sceneStatuses.map(s => s.videoUrl)}
                combinedTime={playheadTime}
                onCombinedTimeUpdate={setPlayheadTime}
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying(p => !p)}
                combinedPlayerRef={combinedPlayerRef}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Video Output / Timeline */}
            <ResizablePanel
              defaultSize={35}
              minSize={15}
              maxSize={55}
              onResize={setVideoPanelSize}
            >
              <VideoOutput
                scenes={scenes}
                selectedScene={selectedScene}
                isPlaying={isPlaying}
                currentTime={playheadTime}
                totalDuration={totalDuration}
                onTogglePlay={handleTogglePlay}
                onReset={handleReset}
                onSelectScene={handleSelectScene}
                onReorderScenes={handleReorderScenes}
                onSeek={handleSeek}
                sceneStatuses={sceneStatuses}
                allDone={allDone}
                panelSize={videoPanelSize}
                singleSceneTime={singleSceneTime}
                onSingleSceneSeek={handleSingleSceneSeek}
                selectedTimestamp={selectedTimestamp}
                onTimestampSelect={handleTimestampSelect}
                onScrub={handleScrub}
                audioUrl={audioTrack ? `/audio/${audioTrack.trackId}.mp3` : undefined}
                audioTrackName={audioTrack ? audioTrack.trackId : undefined}
                videoRef={videoRef}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Agent Thoughts — one isolated instance per scene + one for "all" */}
        <ResizablePanel defaultSize={30} minSize={20} collapsible>
          {/* "All Scenes" instance — keeps its own chat/refinement state */}
          <div style={{ display: selectedScene === "all" ? "flex" : "none", height: "100%", flexDirection: "column" }}>
            <AgentThoughts
              steps={[]}
              isGenerating={anyGenerating}
              isComplete={allDone}
              selectedScene="all"
              allDone={allDone}
              selectedTimestamp={selectedTimestamp}
              onClearTimestamp={() => setSelectedTimestamp(null)}
              sceneContext={undefined}
              allScenes={scenes}
              onRefinementStart={handleRefinementStart}
              onRefinementComplete={handleRefinementComplete}
              versions={[]}
              currentVersion={1}
              projectId={currentProjectIdRef.current ?? undefined}
              allSceneStatuses={sceneStatuses}
            />
          </div>
          {/* Per-scene instances — each stays mounted so chat history is isolated */}
          {scenes.map((scene, i) => (
            <div key={scene.id} style={{ display: selectedScene === i ? "flex" : "none", height: "100%", flexDirection: "column" }}>
              <AgentThoughts
                steps={sceneSteps[i] || []}
                isGenerating={sceneStatuses[i]?.status === "generating"}
                isComplete={sceneStatuses[i]?.status === "complete"}
                selectedScene={i}
                allDone={allDone}
                selectedTimestamp={selectedTimestamp}
                onClearTimestamp={() => setSelectedTimestamp(null)}
                sceneContext={scene}
                allScenes={scenes}
                onRefinementStart={handleRefinementStart}
                onRefinementComplete={handleRefinementComplete}
                versions={currentProjectIdRef.current ? getSceneVersions(currentProjectIdRef.current, i) : []}
                currentVersion={currentProjectIdRef.current ? getSceneCurrentVersion(currentProjectIdRef.current, i) : 1}
                onRestoreVersion={(versionIndex) => handleRestoreVersion(i, versionIndex)}
                projectId={currentProjectIdRef.current ?? undefined}
                allSceneStatuses={sceneStatuses}
              />
            </div>
          ))}
        </ResizablePanel>
      </ResizablePanelGroup>

      <FullscreenPreviewModal
        isOpen={isFullscreenPreviewOpen}
        onClose={() => setIsFullscreenPreviewOpen(false)}
        scenes={scenes}
        sceneStatuses={sceneStatuses}
      />
      <AddSceneModal
        isOpen={isAddSceneModalOpen}
        onClose={() => setIsAddSceneModalOpen(false)}
        onAdd={handleAddScene}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        scenes={scenes}
        videoUrls={sceneStatuses.map(s => s.videoUrl)}
        projectId={currentProjectIdRef.current}
      />
    </div>
  );
};

export default EditorPage;
