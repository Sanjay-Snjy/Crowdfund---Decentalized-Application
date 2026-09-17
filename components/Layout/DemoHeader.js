import { useRouter } from "next/router";
import Link from "next/link";
import { FiLogOut } from "react-icons/fi";
import { setDemoMode, DEMO_USERNAME, DEMO_ETH } from "../../lib/demoMode";

const NAV_ITEMS = [
  { id: "home", label: "All Campaigns", path: "/home" },
  { id: "dashboard", label: "Dashboard", path: "/dashboard" },
  { id: "create", label: "Create Campaign", path: "/create-campaign" },
  { id: "contributions", label: "My Contributions", path: "/contributions" },
];

export default function DemoHeader() {
  const router = useRouter();

  const handleLogout = () => {
    setDemoMode(false);
    router.push("/");
  };

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 z-50 
        bg-[var(--bg-secondary)] border-b md:border border-secondary 
        dark:border-[rgba(255,255,255,0.1)] 
        transition-all duration-300 rounded-2xl backdrop-blur-md backdrop-saturate-150 
        mx-2 mt-2 md:mx-2 md:mt-2
      `}
    >
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left: Logo */}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-3 rounded-2xl transition hover:opacity-90 focus:outline-none"
        >
          <div className="w-10 h-10 rounded-4xl flex items-center justify-center">
            <img
              src="/logo.png"
              alt="CrowdFund Logo"
              className="w-10 h-10 object-contain"
            />
          </div>
          <span className="text-lg font-bold text-gray-900 dark:text-white hidden sm:inline">
            CrowdFund
          </span>
        </button>

        {/* Center: Navigation Links */}
        <nav className="hidden md:flex items-center space-x-1">
          {NAV_ITEMS.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`
                  px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
                  ${
                    isActive
                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                      : "text-gray-600 hover:bg-gray-100 dark:text-[rgba(255,255,255,0.7)] dark:hover:bg-[rgba(255,255,255,0.06)]"
                  }
                `}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Demo Badge + Exit Button */}
        <div className="flex items-center gap-3">
          {/* Demo badge */}
          <div className="hidden lg:flex items-center gap-2 rounded-full border border-indigo-300 bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse dark:bg-indigo-400" />
            {DEMO_USERNAME} &middot; {DEMO_ETH}
          </div>

          {/* Mobile demo badge */}
          <span className="lg:hidden text-xs font-semibold text-indigo-700 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            Demo
          </span>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-full border border-red-300/50 bg-red-50/80 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-400 hover:bg-red-100 dark:border-red-900/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            title="Logout from demo"
          >
            <FiLogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Exit Demo</span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden px-4 pb-2 overflow-x-auto">
        <nav className="flex space-x-2">
          {NAV_ITEMS.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all
                  ${
                    isActive
                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                      : "text-gray-600 hover:bg-gray-100 dark:text-[rgba(255,255,255,0.7)] dark:hover:bg-[rgba(255,255,255,0.06)]"
                  }
                `}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
