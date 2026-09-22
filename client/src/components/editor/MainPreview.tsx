import { motion } from "framer-motion";
import { Scene } from "@/lib/mockData";
import ScenePlayer, { PlayerStage } from "./ScenePlayer";
import CombinedVideoPlayer, { CombinedVideoPlayerHandle } from "./CombinedVideoPlayer";
import GeneratingAnimation from "./GeneratingAnimation";

interface MainPreviewProps {
  scene: Scene | null;
  isGenerating: boolean;
  isQueued?: boolean;
  isComplete?: boolean;
  isAllScenes?: boolean;
  allScenesGenerating?: boolean;
  /** Player URL (localhost:3200/player?...) — available after triggerPreview */
  previewUrl?: string | null;
  previewSceneId?: string | null;
  /** Rendered MP4 URL */
  videoUrl?: string | null;
  /** True once triggerPreview fires during a refinement cycle */
  refinementPreviewReady?: boolean;
  /** True when a refinement (or re-render) is in progress */
  isRefining?: boolean;
  generatingMessage?: string;
  /** When set while generating, shows an error + retry instead of the spinner. */
  errorMessage?: string;
  onRetry?: () => void;
  videoRef?: React.RefObject<HTMLVideoElement>;
  // Per-scene extras for ScenePlayer controls
  sceneIndex?: number;
  sceneCount?: number;
  onPrevScene?: () => void;
  onNextScene?: () => void;
  onExport?: () => void;
  onFullscreen?: () => void;
  // All scenes props
  allScenes?: Scene[];
  allVideoUrls?: (string | undefined)[];
  combinedTime?: number;
  onCombinedTimeUpdate?: (time: number) => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  combinedPlayerRef?: React.RefObject<CombinedVideoPlayerHandle>;
}

const MainPreview = ({
  scene,
  isGenerating,
  isQueued = false,
  isComplete = false,
  isAllScenes = false,
  allScenesGenerating = false,
  previewUrl,
  previewSceneId,
  videoUrl,
  refinementPreviewReady = false,
  isRefining = false,
  generatingMessage,
  errorMessage,
  onRetry,
  videoRef,
  sceneIndex,
  sceneCount,
  onPrevScene,
  onNextScene,
  onExport,
  onFullscreen,
  allScenes,
  allVideoUrls,
  combinedTime = 0,
  onCombinedTimeUpdate,
  isPlaying = false,
  onTogglePlay,
  combinedPlayerRef,
}: MainPreviewProps) => {
  // ── All scenes view ──────────────────────────────────────────────────────────
  if (isAllScenes) {
    if (allScenesGenerating) {
      return (
        <div className="h-full w-full overflow-hidden bg-card">
          <GeneratingAnimation message="Generating all scenes..." />
        </div>
      );
    }

    const hasVideos = allScenes && allVideoUrls && allVideoUrls.some((url) => url);

    if (hasVideos && allScenes && allVideoUrls) {
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="h-full w-full relative overflow-hidden bg-black"
        >
          <CombinedVideoPlayer
            ref={combinedPlayerRef}
            scenes={allScenes}
            videoUrls={allVideoUrls}
            currentTime={combinedTime}
            onTimeUpdate={onCombinedTimeUpdate}
            isPlaying={isPlaying}
            onTogglePlay={onTogglePlay}
          />
        </motion.div>
      );
    }

    return (
      <div className="h-full w-full flex items-center justify-center bg-secondary/30">
        <div className="text-center p-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-accent mb-3">
            Combined Preview
          </p>
          <h2
            className="text-2xl font-bold text-foreground mb-3"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            All Scenes Ready
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your complete video is ready for preview and export.
          </p>
        </div>
      </div>
    );
  }

  // ── No scene selected ────────────────────────────────────────────────────────
  if (!scene) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-secondary/30">
        <p className="text-sm text-muted-foreground">No scene selected</p>
      </div>
    );
  }

  // ── Single scene view ─────────────────────────────────────────────────────────
  let stage: PlayerStage = "generating";
  if (errorMessage) {
    // A failure (agent call or background render) always wins — otherwise a
    // completed-but-videoless scene silently falls through to the live code
    // preview (or nothing) with no indication the render never finished.
    stage = "generating";
  } else if (isQueued) {
    stage = "generating";
  } else if (isGenerating && refinementPreviewReady && previewUrl) {
    // Refinement in progress AND triggerPreview has fired with updated code:
    // show the live player so the user sees new code before the render finishes.
    stage = "preview";
  } else if ((isComplete || isGenerating) && videoUrl) {
    stage = "rendered";
  } else if (previewUrl) {
    stage = "preview";
  } else if (isGenerating) {
    stage = "generating";
  } else if (!isComplete) {
    // idle / storyboard
    return (
      <motion.div
        key={scene.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={`h-full w-full flex items-center justify-center bg-gradient-to-br ${
          scene.gradient ?? "from-primary/10 to-primary/5"
        }`}
      >
        <div className="text-center px-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-3">
            {scene.category}
          </p>
          <h2
            className="text-2xl font-bold text-foreground mb-3"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {scene.name}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {scene.notes ?? scene.elements.map((e) => e.description).join(" ")}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key={scene.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="h-full w-full flex flex-col overflow-hidden bg-black"
    >
      <ScenePlayer
        sceneId={previewSceneId}
        stage={stage}
        playerUrl={previewUrl}
        videoUrl={videoUrl}
        sceneTitle={scene.name}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onNextScene={onNextScene}
        generatingMessage={isQueued ? "Queued..." : generatingMessage}
        errorMessage={isQueued ? undefined : errorMessage}
        onRetry={onRetry}
        videoRef={videoRef}
        isRefining={isRefining}
      />
    </motion.div>
  );
};

export default MainPreview;
