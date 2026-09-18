import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Replaces `next-themes` (inventory §2.7).
 *
 * The legacy app pulled in `next-themes` for one reason: `sonner.tsx` needed
 * to know whether to render toasts light or dark. There is no theme switcher
 * anywhere in the product — `globals.css` defines a `.dark` block, but nothing
 * ever adds that class — so this reads the same signal the CSS already keys
 * on, plus the OS preference, without a provider or a dependency.
 *
 * If a theme toggle is ever built, this is the one place that needs to change.
 */
export function useTheme(): { theme: Theme } {
  const [theme, setTheme] = useState<Theme>(() => detectTheme());

  useEffect(() => {
    // Track the `.dark` class, so a future toggle is picked up automatically.
    const observer = new MutationObserver(() => setTheme(detectTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Track the OS preference, which is what "system" resolves to today.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(detectTheme());
    media.addEventListener("change", onChange);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", onChange);
    };
  }, []);

  return { theme };
}

function detectTheme(): Theme {
  if (typeof document === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
