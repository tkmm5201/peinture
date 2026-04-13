import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronsLeftRight } from "lucide-react";

interface ImageComparisonProps {
  beforeImage: string;
  afterImage: string;
  alt: string;
  labelBefore?: string;
  labelAfter?: string;
}

export const ImageComparison: React.FC<ImageComparisonProps> = ({
  beforeImage,
  afterImage,
  alt,
  labelBefore = "Original",
  labelAfter = "After",
}) => {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const newPos = Math.min(Math.max((x / rect.width) * 100, 0), 100);
      setPosition(newPos);
    }
  }, []);

  const onMouseDown = () => (isDragging.current = true);
  const onMouseUp = () => (isDragging.current = false);
  const onMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) handleMove(e.clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => (isDragging.current = false);
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging.current) handleMove(e.clientX);
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    window.addEventListener("mousemove", handleGlobalMouseMove);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      window.removeEventListener("mousemove", handleGlobalMouseMove);
    };
  }, [handleMove]);

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div
        className="relative inline-flex max-w-full max-h-full select-none overflow-hidden"
        style={{ touchAction: "none" }} // Prevents scrolling on mobile while sliding
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onTouchStart={onMouseDown}
        onTouchEnd={onMouseUp}
        onTouchMove={onTouchMove}
      >
        {/* 
           Layout Strategy:
           1. 'After' image (Upscaled) is the Base. It sets the dimensions of the container 
              naturally because it is relative/static. We constrain it with max-w/max-h.
           2. 'Before' image (Original) is Absolute Overlay. It sits on top.
           3. We clip the 'Before' image from the right side.
        */}

        {/* Base Layer: Upscaled Image (Visible on the Right) */}
        <img
          src={afterImage}
          alt={`${alt} After`}
          className="block max-w-full max-h-full w-auto h-auto object-contain pointer-events-none"
          draggable={false}
        />

        {/* Overlay Layer: Original Image (Visible on the Left) */}
        <div
          className="absolute inset-0 w-full h-full overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={beforeImage}
            alt={`${alt} Before`}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        </div>

        {/* Slider Handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/60 cursor-ew-resize z-20 group"
          style={{ left: `${position}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 backdrop-blur-md border border-white/50 rounded-full flex items-center justify-center text-white shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-110">
            <ChevronsLeftRight className="w-4 h-4" />
          </div>
        </div>

        {/* Labels */}
        <div
          className={`absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white/90 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded border border-white/10 z-10 pointer-events-none transition-opacity duration-300 ${position < 15 ? "opacity-0" : "opacity-100"}`}
        >
          {labelBefore}
        </div>
        <div
          className={`absolute top-3 right-3 bg-purple-600/90 backdrop-blur-md text-white text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded border border-white/10 z-10 pointer-events-none transition-opacity duration-300 ${position > 85 ? "opacity-0" : "opacity-100"}`}
        >
          {labelAfter}
        </div>
      </div>
    </div>
  );
};
