import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GeneratingAnimationProps {
  sceneTitle?: string;
  message?: string;
  /** When set, shows an error state with this message instead of the spinner. */
  errorMessage?: string;
  onRetry?: () => void;
}

const GeneratingAnimation = ({ sceneTitle, message, errorMessage, onRetry }: GeneratingAnimationProps) => {
  if (errorMessage) {
    return (
      <div className="flex items-center justify-center h-full bg-card relative overflow-hidden">
        <div className="text-center z-10 max-w-sm px-6">
          <div className="mx-auto w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Generation failed{sceneTitle ? ` for "${sceneTitle}"` : ""}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 break-words">{errorMessage}</p>
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full bg-card relative overflow-hidden">
      {/* Subtle ambient gradient animation */}
      <motion.div
        className="absolute inset-0 opacity-30"
        animate={{
          background: [
            "radial-gradient(circle at 30% 30%, hsl(var(--primary)/0.15) 0%, transparent 50%)",
            "radial-gradient(circle at 70% 70%, hsl(var(--primary)/0.15) 0%, transparent 50%)",
            "radial-gradient(circle at 30% 70%, hsl(var(--primary)/0.15) 0%, transparent 50%)",
            "radial-gradient(circle at 70% 30%, hsl(var(--primary)/0.15) 0%, transparent 50%)",
            "radial-gradient(circle at 30% 30%, hsl(var(--primary)/0.15) 0%, transparent 50%)",
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="text-center z-10">
        {/* Clean pulsing dots indicator */}
        <div className="flex items-center justify-center gap-1.5 mb-5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-primary"
              animate={{
                scale: [1, 1.3, 1],
                opacity: [0.4, 1, 0.4],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>

        <p className="text-sm font-medium text-foreground">
          {message || `Creating ${sceneTitle || "scene"}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">AI is working on your video</p>
      </div>
    </div>
  );
};

export default GeneratingAnimation;
