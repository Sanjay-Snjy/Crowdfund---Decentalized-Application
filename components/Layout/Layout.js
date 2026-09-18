import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Toaster } from "react-hot-toast";
import Header from "./Header";
import DemoHeader from "./DemoHeader";
import ErrorBoundary from "./ErrorBoundary";
import { useDemoMode } from "../../lib/demoMode";

export default function Layout({ children }) {
  const demoMode = useDemoMode();

  // Ensure theme is applied synchronously on mount to prevent flash.
  useEffect(() => {
    if (typeof document === "undefined") return;

    let savedTheme;
    try {
      savedTheme = localStorage.getItem("theme");
    } catch {
      savedTheme = null;
    }

    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (savedTheme === "light") {
      document.documentElement.classList.remove("dark");
    }
    document.documentElement.style.colorScheme =
      document.documentElement.classList.contains("dark") ? "dark" : "light";
  }, []);

  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const router = useRouter();
  const [isDark, setIsDark] = useState(false);

  // Check dark mode and update on theme change
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="bg-[var(--bg)] min-h-screen flex flex-col"
      suppressHydrationWarning
    >
      {/* Fixed background */}
      <div className="fixed inset-0 bg-[var(--bg)] z-0 pointer-events-none" />

      <div
        className="relative z-10 flex-1 flex flex-col"
        onMouseMove={(e) => {
          setMousePosition({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Dots background — same stacking context as cards so backdrop-filter works */}
        <div
          className="hidden md:block fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.02)"} 1.2px, transparent 1.4px)`,
            backgroundSize: "8px 8px",
            zIndex: 1,
          }}
        />
        <div
          className="hidden md:block fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(${isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.5)"} 1px, transparent 1.2px)`,
            backgroundSize: "8px 8px",
            maskImage: `radial-gradient(circle 200px at ${mousePosition.x}px ${mousePosition.y}px, white 0%, transparent 80%)`,
            WebkitMaskImage: `radial-gradient(circle 200px at ${mousePosition.x}px ${mousePosition.y}px, white 0%, transparent 80%)`,
            zIndex: 1,
          }}
        />

        {/* Header */}
        {demoMode ? <DemoHeader /> : <Header />}

        <main className="relative flex-1 pt-28 px-3 pb-4 md:pt-24 md:px-6 md:pb-6" style={{ zIndex: 2 }}>
          <ErrorBoundary key={router.asPath}>
            <div>{children}</div>
          </ErrorBoundary>
        </main>
      </div>

      {/* Footer */}
      <footer className="relative z-10 rounded-t-[20px] bg-[var(--bg-secondary)] mx-[8px] backdrop-blur-md border border-secondary dark:border-[rgba(255,255,255,0.1)] text-slate-300 mt-auto">
        <div className="mx-auto flex flex-col items-center gap-2 px-4 py-4 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
            <p className="text-sm font-semibold text-black dark:text-white">CrowdFund DApp</p>
            <p className="text-xs text-slate-400">Built for secure, modern crowdfunding on-chain.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <a className="transition hover:text-indigo-400">Create</a>
            <span className="text-slate-300 dark:text-[rgba(255,255,255,0.2)]">/</span>
            <a className="transition hover:text-indigo-400">Contribute</a>
          </div>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} CrowdFund. All rights reserved.</p>
        </div>
      </footer>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { background: "#363636", color: "#fff" },
          success: { duration: 3000, theme: { primary: "#4aed88" } },
        }}
      />
    </div>
  );
}
