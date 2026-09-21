import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { FiSun, FiMoon, FiUser, FiLogOut } from "react-icons/fi";

const NAV_ITEMS = [
  { id: "home", label: "Home", path: "/home" },
  { id: "dashboard", label: "Dashboard", path: "/dashboard" },
  { id: "create", label: "Create Campaign", path: "/create-campaign" },
];

export default function Header({ onMenuToggle, isCollapsed }) {
  const [isDark, setIsDark] = useState(false);
  const [walletUserName, setWalletUserName] = useState("");
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { user, isLoaded, isSignedIn } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const shouldUseDark = savedTheme ? savedTheme === "dark" : prefersDark;
    setIsDark(shouldUseDark);
    document.documentElement.classList.toggle("dark", shouldUseDark);
    document.documentElement.style.colorScheme = shouldUseDark
      ? "dark"
      : "light";
    if (!savedTheme) {
      window.localStorage.setItem(
        "theme",
        shouldUseDark ? "dark" : "light"
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      setWalletUserName("");
      return;
    }
    const fallbackName =
      user.fullName ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
      "Signed In";
    setWalletUserName(fallbackName);
  }, [isLoaded, isSignedIn, user]);

  useEffect(() => {
    const adminAddress = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
    setIsAdmin(
      address?.toLowerCase() === adminAddress?.toLowerCase()
    );
  }, [address]);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const nextIsDark = !prev;
      document.documentElement.classList.toggle("dark", nextIsDark);
      document.documentElement.style.colorScheme = nextIsDark
        ? "dark"
        : "light";
      localStorage.setItem("theme", nextIsDark ? "dark" : "light");
      return nextIsDark;
    });
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === "admin" && !isAdmin) return false;
    return true;
  });

  // Add admin if user is admin
  const allNavItems = isAdmin
    ? [...visibleNavItems, { id: "admin", label: "Admin Panel", path: "/admin" }]
    : visibleNavItems;

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 md:top-2 md:left-4 md:right-4 z-50 
        bg-white/80 dark:bg-[var(--bg-secondary)] border-b md:border border-secondary 
        dark:border-[rgba(255,255,255,0.1)] 
        transition-all duration-300 rounded-3xl backdrop-blur-md backdrop-saturate-150
      `}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        {/* Left: Logo */}
        <div className="flex items-center space-x-4">
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
        </div>

        {/* Center: Navigation Links */}
        <nav className="hidden md:flex items-center space-x-1">
          {allNavItems.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`
                  px-4 py-2 rounded-full text-[13px] font-medium transition-all duration-200
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

        {/* Right: Profile + Theme + Connect Wallet */}
        <div className="flex items-center space-x-3">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-white dark:hover:bg-[rgba(255,255,255,0.1)] transition-colors"
          >
            {isDark ? (
              <FiSun className="w-5 h-5 text-[rgba(255,255,255,0.5)]" />
            ) : (
              <FiMoon className="w-5 h-5 text-gray-600" />
            )}
          </button>

          {/* Profile Button (only show when signed in) */}
          {isSignedIn && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  // Open profile menu or navigate to profile
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-gray-100 dark:hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                title={walletUserName || "Profile"}
              >
                <div className="h-7 w-7 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                  {user?.imageUrl ? (
                    <img
                      src={user.imageUrl}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <FiUser className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  )}
                </div>
                <span className="hidden lg:inline text-sm font-medium text-gray-700 dark:text-[rgba(255,255,255,0.8)]">
                  {walletUserName || "Profile"}
                </span>
              </button>

              {/* Profile Dropdown */}
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {walletUserName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {user?.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
                <Link
                  href="/contributions"
                  className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  My Contributions
                </Link>
              </div>
            </div>
          )}

          {/* Connect Wallet Button */}
          <ConnectButton
            chainStatus="icon"
            accountStatus={{
              smallScreen: "avatar",
              largeScreen: "full",
            }}
            showBalance={{
              smallScreen: false,
              largeScreen: true,
            }}
          />
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden px-3 pb-2 overflow-x-auto">
        <nav className="flex space-x-2">
          {allNavItems.map((item) => {
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
