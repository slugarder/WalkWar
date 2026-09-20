import React, { useEffect, useId, useRef, useState } from "react";

export function LiquidSurface({ radius = 12 }: { radius?: number }) {
  const id = "liquid-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const root = useRef<HTMLDivElement>(null);
  const [field, setField] = useState({ uri: "", width: 1, height: 1 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const resize = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.ceil(width),
        h = Math.ceil(height);
      if (!w || !h) return;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const image = ctx.createImageData(w, h),
        r = Math.min(radius, w / 2, h / 2);
      // Rounded-rectangle edge normals form a convex lens; the centre stays undistorted.
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const cx = Math.max(r, Math.min(w - r, x)),
            cy = Math.max(r, Math.min(h - r, y));
          let nx = x - cx,
            ny = y - cy;
          let depth: number;
          if (nx || ny) {
            const length = Math.hypot(nx, ny);
            depth = r - length;
            nx /= length;
            ny /= length;
          } else {
            const edges = [x, w - x, y, h - y];
            depth = Math.min(...edges);
            nx = depth === x ? -1 : depth === w - x ? 1 : 0;
            ny = depth === y ? -1 : depth === h - y ? 1 : 0;
          }
          const strength =
            depth >= 0 && depth < 13
              ? Math.sin(((1 - depth / 13) * Math.PI) / 2) * 0.42
              : 0;
          const i = (y * w + x) * 4;
          image.data[i] = 128 + nx * strength * 255;
          image.data[i + 1] = 128 + ny * strength * 255;
          image.data[i + 2] = 128;
          image.data[i + 3] = 255;
        }
      ctx.putImageData(image, 0, 0);
      setField({ uri: canvas.toDataURL(), width: w, height: h });
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, [radius]);
  const filter = field.uri
    ? `url(#${id}) blur(1.2px) saturate(1.3)`
    : "blur(5px) saturate(1.3)";
  return (
    <div
      ref={root}
      aria-hidden
      data-liquid-surface="refraction"
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: radius,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter
            id={id}
            x="0"
            y="0"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={field.uri || undefined}
              x="0"
              y="0"
              width={field.width}
              height={field.height}
              result="lens"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="lens"
              scale="24"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          backdropFilter: filter,
          WebkitBackdropFilter: filter,
          background:
            "linear-gradient(135deg,rgba(209,245,244,.17),rgba(23,44,62,.24) 36%,rgba(12,29,46,.37) 70%,rgba(113,167,173,.14))",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          border: "1px solid rgba(194,230,234,.37)",
          boxShadow:
            "inset 1px 1px 1px rgba(241,255,255,.8),inset -1px -1px 2px rgba(164,220,221,.4),inset 0 0 12px rgba(191,230,231,.1)",
          background:
            "linear-gradient(165deg,rgba(240,255,255,.13),transparent 28%,transparent 75%,rgba(141,203,203,.08))",
        }}
      />
    </div>
  );
}
