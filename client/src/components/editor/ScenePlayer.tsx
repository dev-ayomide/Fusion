import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import GeneratingAnimation from "./GeneratingAnimation";

export type PlayerStage = "generating" | "preview" | "rendered";

interface ScenePlayerProps {
  /** Remotion composition ID — used to detect URL type */
  sceneId?: string | null;
  /** Current lifecycle stage */
  stage: PlayerStage;
  /** Player URL from triggerPreview (localhost:3200/player?...) */
  playerUrl?: string | null;
  /** Rendered MP4 URL */
  videoUrl?: string | null;
  /** Playback state controlled by parent */
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onNextScene?: () => void;
  /** Message shown during generating stage */
  generatingMessage?: string;
  /** When set during the generating stage, shows an error + retry instead of the spinner. */
  errorMessage?: string;
  onRetry?: () => void;
  sceneTitle?: string;
  /** Ref forwarded for the native <video> element (rendered stage) */
  videoRef?: React.RefObject<HTMLVideoElement>;
  /** True when a refinement/re-render is in progress — shows status overlay */
  isRefining?: boolean;
  className?: string;
}

/**
 * ScenePlayer — the unified preview canvas.
 *
 * Stage transitions:
 *   generating → show GeneratingAnimation
 *   preview    → iframe → PlayerApp (localhost:3200) with PlayerControls overlay
 *   rendered   → native <video> element with PlayerControls overlay
 *
 * postMessage bridge (preview stage):
 *   parent → iframe: { type: 'play' | 'pause' | 'seek', frame?: number }
 *   iframe → parent: { type: 'timeupdate', frame } | { type: 'ended' }
 */
const ScenePlayer = ({
  stage,
  playerUrl,
  videoUrl,
  sceneTitle,
  isPlaying = false,
  onTogglePlay,
  onNextScene,
  generatingMessage,
  errorMessage,
  onRetry,
  videoRef,
  isRefining = false,
  className,
}: ScenePlayerProps) => {
  return (
    <div className={cn("w-full h-full", className)}>
      <AnimatePresence mode="wait">
        {stage === "generating" ? (
          <motion.div
            key="generating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full"
          >
            <GeneratingAnimation
              sceneTitle={sceneTitle}
              message={generatingMessage}
              errorMessage={errorMessage}
              onRetry={onRetry}
            />
          </motion.div>
        ) : stage === "rendered" && videoUrl ? (
          <motion.div
            key="rendered"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full h-full bg-black relative"
          >
            <RenderedStage
              videoUrl={videoUrl}
              videoRef={videoRef}
              isPlaying={isPlaying}
              onNextScene={onNextScene}
            />
            {/* Refinement overlay — shown while agent is writing updated code */}
            <AnimatePresence>
              {isRefining && (
                <motion.div
                  key="refining-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 pointer-events-none"
                >
                  {/* Animated top border */}
                  <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
                  {/* Status badge */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-full">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-[11px] text-white/70 font-medium">Updating scene...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : stage === "preview" && playerUrl ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full h-full bg-black relative"
          >
            <PreviewStage
              playerUrl={playerUrl}
              isPlaying={isPlaying}
              onTogglePlay={onTogglePlay}
            />
            {/* Refinement overlay — shown while rendering the final video */}
            <AnimatePresence>
              {isRefining && (
                <motion.div
                  key="rendering-badge"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="absolute top-3 right-3 pointer-events-none flex items-center gap-1.5 bg-black/70 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-full"
                >
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="text-[11px] text-white/70 font-medium">Rendering final...</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full h-full flex items-center justify-center text-muted-foreground"
          >
            <p className="text-xs">Waiting for scene...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Preview stage — iframe to PlayerApp at localhost:3200 ─────────────────────

interface PreviewStageProps {
  playerUrl: string;
  isPlaying: boolean;
  onTogglePlay?: () => void;
}

const PreviewStage = ({
  playerUrl,
  isPlaying,
  onTogglePlay,
}: PreviewStageProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);
  // Only show the iframe content once Remotion confirms a valid frame
  const [isSceneReady, setIsSceneReady] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fallback: if no timeupdate within 3s of iframe loading, show anyway
  const readyFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for messages from the PlayerApp iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const { type } = (e.data ?? {}) as { type?: string };
      if (type === "ended") {
        onTogglePlay?.();
      }
      // Remotion confirms it's rendering — safe to show
      if (type === "timeupdate" || type === "ready" || type === "play") {
        if (readyFallbackRef.current) clearTimeout(readyFallbackRef.current);
        setIsSceneReady(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onTogglePlay]);

  // Reset ready state whenever the playerUrl changes (new scene)
  useEffect(() => {
    setIsSceneReady(false);
    setIframeLoaded(false);
    setIframeFailed(false);
  }, [playerUrl]);

  // Send play/pause commands to the iframe
  useEffect(() => {
    if (!iframeLoaded) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: isPlaying ? "play" : "pause" },
      "*",
    );
  }, [isPlaying, iframeLoaded]);

  const handleIframeLoad = () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    setIframeLoaded(true);
    setIframeFailed(false);
    // Fallback: show iframe after 3s even if no timeupdate received
    readyFallbackRef.current = setTimeout(() => setIsSceneReady(true), 3000);
  };

  const handleIframeLoadStart = () => {
    loadTimeoutRef.current = setTimeout(() => {
      if (!iframeLoaded) setIframeFailed(true);
    }, 4000);
  };

  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (readyFallbackRef.current) clearTimeout(readyFallbackRef.current);
    };
  }, []);

  return (
    <div className="w-full h-full relative bg-black">
      {/* Building overlay — shown until Remotion confirms scene is ready */}
      {!isSceneReady && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.2s]" />
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.4s]" />
          </div>
          <p className="text-xs text-white/50">Building scene preview...</p>
        </div>
      )}

      {iframeFailed && !iframeLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black p-6">
          <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Terminal className="h-4 w-4 text-white/60" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white mb-1">
              Player not running
            </p>
            <p className="text-xs text-white/50">
              Run <code className="bg-white/10 px-1 rounded">npm run dev:all</code> to start the player server on port 3200.
            </p>
            <p className="text-xs text-white/40 mt-2">
              The rendered video will appear here once complete.
            </p>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={playerUrl}
        className={cn(
          "absolute inset-0 w-full h-full border-0 transition-opacity duration-500",
          isSceneReady ? "opacity-100" : "opacity-0",
        )}
        title="Scene Player"
        allow="autoplay"
        onLoad={handleIframeLoad}
        onLoadStart={handleIframeLoadStart}
      />
    </div>
  );
};

// ─── Rendered stage — native <video> element ───────────────────────────────────

interface RenderedStageProps {
  videoUrl: string;
  videoRef?: React.RefObject<HTMLVideoElement>;
  isPlaying: boolean;
  onNextScene?: () => void;
}

const RenderedStage = ({
  videoUrl,
  videoRef: externalRef,
  isPlaying,
  onNextScene,
}: RenderedStageProps) => {
  const internalRef = useRef<HTMLVideoElement>(null);
  const ref = externalRef ?? internalRef;

  // Sync video playback state
  useEffect(() => {
    if (!ref.current) return;
    if (isPlaying) {
      ref.current.play().catch(() => {});
    } else {
      ref.current.pause();
    }
  }, [isPlaying, ref]);

  return (
    <div className="w-full h-full relative bg-black">
      <video
        ref={ref}
        src={videoUrl}
        className="absolute inset-0 w-full h-full object-contain"
        muted
        playsInline
        loop
        onEnded={() => onNextScene?.()}
      />
    </div>
  );
};

export default ScenePlayer;
