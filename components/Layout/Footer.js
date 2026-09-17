import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t mt-auto" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="CrowdFund" className="w-7 h-7 rounded" />
              <span className="text-base font-semibold" style={{ color: "var(--color-text)" }}>CrowdFund</span>
            </div>
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Decentralized crowdfunding for the future.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--color-text-muted)" }}>Product</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/home" className="hover:underline" style={{ color: "var(--color-text-secondary)" }}>Browse Campaigns</Link></li>
              <li><Link href="/create-campaign" className="hover:underline" style={{ color: "var(--color-text-secondary)" }}>Start a Campaign</Link></li>
              <li><Link href="/dashboard" className="hover:underline" style={{ color: "var(--color-text-secondary)" }}>Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--color-text-muted)" }}>Contact</h4>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>support@crowdfund.in</p>
          </div>
        </div>
        <div className="mt-8 pt-4 border-t text-center text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
          © {new Date().getFullYear()} CrowdFund. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
