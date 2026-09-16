/**
 * Clerk Appearance Configuration
 * Light/white theme that matches the CrowdFund brand: white surfaces,
 * subtle gray borders, indigo accents, rounded-full buttons.
 */
const clerkAppearance = {
  variables: {
    colorPrimary: "#6366F1",           // Indigo-500
    colorBackground: "#FFFFFF",        // White
    colorInputBackground: "#F9FAFB",   // Gray-50
    colorText: "#111827",              // Gray-900
    colorTextSecondary: "rgba(17,24,39,0.6)",       // Gray-900/60
    colorTextOnPrimaryBackground: "#FFFFFF",
    colorInputText: "#111827",
    colorDanger: "#EF4444",
    colorSuccess: "#22C55E",
    // Base (md) radius. Clerk SCALES this per element (lg x1.35, xl x2.7, 2xl x3.35),
    // so a huge value like 999px turns large panels into giant circles.
    borderRadius: "0.75rem",
    fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontSize: "0.9375rem",
    spacingUnit: "1rem",
    fontFamilyButtons: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
  elements: {
    // ─── Card / Modal Container ───
    card: {
      background: "#FFFFFF",
      border: "1px solid rgba(17,24,39,0.08)",
      borderRadius: "1.5rem",
      boxShadow: "0 8px 32px rgba(17,24,39,0.10)",
      // Clips the absolutely-positioned "Secured by Clerk" badge that
      // Clerk hangs off the card edge (it has no styleable class).
      overflow: "hidden",
    },
    rootBox: {
      backgroundColor: "transparent",
      border: "none",
      boxShadow: "none",
      padding: 0,
      width: "auto",
      minHeight: "auto",
    },
    page: {
      backgroundColor: "#F9FAFB",
      minHeight: "100vh",
      borderRadius: "1.5rem",
    },

    // ─── Form Fields ───
    formFieldInput: {
      backgroundColor: "#F9FAFB",
      border: "1px solid rgba(17,24,39,0.12)",
      color: "#111827",
      borderRadius: "0.75rem",
      padding: "0.75rem 1rem",
      fontSize: "0.9375rem",
      transition: "border-color 150ms ease, box-shadow 150ms ease",
      outline: "none",
      "::placeholder": { color: "rgba(17,24,39,0.35)" },
      "&:focus": {
        borderColor: "#6366F1",
        boxShadow: "0 0 0 3px rgba(99,102,241,0.15)",
        backgroundColor: "#FFFFFF",
      },
    },
    formFieldLabel: {
      color: "rgba(17,24,39,0.7)",
      fontSize: "0.8125rem",
      fontWeight: 500,
      marginBottom: "0.375rem",
    },
    formFieldRow: {
      marginBottom: "1.125rem",
    },

    // ─── Primary Button (Continue, etc.) ───
    formButtonPrimary: {
      backgroundColor: "#6366F1",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "0.75rem 1.5rem",
      fontSize: "0.9375rem",
      fontWeight: 600,
      letterSpacing: "0.01em",
      transition: "background-color 150ms ease, box-shadow 150ms ease",
      boxShadow: "none",
      border: "none",
      cursor: "pointer",
      "&:hover": {
        backgroundColor: "#818CF8",
        boxShadow: "none",
      },
      "&:active": {
        backgroundColor: "#4F46E5",
      },
      "&:disabled": {
        opacity: 0.5,
        cursor: "not-allowed",
      },
    },

    // ─── Social / OAuth Buttons ───
    socialButtonsBlockButton: {
      backgroundColor: "#FFFFFF",
      border: "1px solid rgba(17,24,39,0.12)",
      color: "#111827",
      borderRadius: "9999px",
      padding: "0.75rem 1rem",
      fontSize: "0.875rem",
      fontWeight: 500,
      transition: "background-color 150ms ease, border-color 150ms ease",
      "&:hover": {
        backgroundColor: "#F9FAFB",
        borderColor: "rgba(17,24,39,0.2)",
      },
    },

    socialButtonsIconButton: {
      backgroundColor: "#FFFFFF",
      border: "1px solid rgba(17,24,39,0.12)",
      color: "#111827",
      borderRadius: "9999px",
      "&:hover": {
        backgroundColor: "#F9FAFB",
      },
    },

    // ─── Divider ───
    dividerLine: {
      backgroundColor: "rgba(17,24,39,0.1)",
    },
    dividerText: {
      color: "rgba(17,24,39,0.4)",
      fontSize: "0.8125rem",
    },

    // ─── Links ───
    footerActionLink: {
      color: "#4F46E5",
      fontWeight: 500,
      fontSize: "0.875rem",
      transition: "color 150ms ease",
      "&:hover": {
        color: "#6366F1",
      },
    },
    actionLink: {
      color: "#4F46E5",
      fontWeight: 500,
      "&:hover": {
        color: "#6366F1",
      },
    },

    // ─── Header ───
    headerTitle: {
      color: "#111827",
      fontSize: "1.5rem",
      fontWeight: 700,
      letterSpacing: "-0.01em",
    },
    headerSubtitle: {
      color: "rgba(17,24,39,0.6)",
      fontSize: "0.875rem",
      fontWeight: 400,
    },

    // ─── Navbar ───
    navbar: {
      backgroundColor: "#F9FAFB",
      borderBottom: "1px solid rgba(17,24,39,0.08)",
      // Override Clerk's border-radius inheritance so the nav rail stays rectangular.
      borderRadius: "0",
      overflow: "hidden",
    },
    navbarButton: {
      color: "rgba(17,24,39,0.6)",
      "&:hover": {
        backgroundColor: "rgba(17,24,39,0.05)",
        color: "#111827",
      },
    },
    navbarButtonActive: {
      color: "#4F46E5",
      backgroundColor: "rgba(99,102,241,0.1)",
    },

    // ─── OTP / Code Input ───
    otpCodeFieldInput: {
      backgroundColor: "#F9FAFB",
      border: "1px solid rgba(17,24,39,0.12)",
      color: "#111827",
      borderRadius: "0.75rem",
      fontSize: "1.25rem",
      fontWeight: 600,
      "&:focus": {
        borderColor: "#6366F1",
        boxShadow: "0 0 0 3px rgba(99,102,241,0.15)",
      },
    },

    // ─── Checkboxes / Switches ───
    formFieldCheckboxInput: {
      accentColor: "#6366F1",
    },
    switchButton: {
      backgroundColor: "rgba(17,24,39,0.15)",
      "&:checked": {
        backgroundColor: "#6366F1",
      },
    },

    // ─── Alerts / Errors ───
    alertBox: {
      backgroundColor: "rgba(239,68,68,0.06)",
      border: "1px solid rgba(239,68,68,0.25)",
      color: "#B91C1C",
      borderRadius: "0.75rem",
    },
    alertText: {
      color: "#111827",
    },

    // ─── Footer ───
    footer: {
      backgroundColor: "transparent",
    },
    footerAction: {
      color: "rgba(17,24,39,0.5)",
    },

    // ─── Verification Code ───
    verificationCodeFieldInput: {
      backgroundColor: "#F9FAFB",
      border: "1px solid rgba(17,24,39,0.12)",
      color: "#111827",
      "&:focus": {
        borderColor: "#6366F1",
        boxShadow: "0 0 0 3px rgba(99,102,241,0.15)",
      },
    },

    // ─── Badges ───
    // NOTE: the "Secured by Clerk" branding badge has NO element class; it is
    // hidden via globals.css (attribute selector on its inner clerk.com link).
    badge: {
      display: "none",
    },

    // ─── User Button (Avatar / Popover) ───
    userButtonAvatarBox: {
      width: 36,
      height: 36,
      borderRadius: "9999px",
      border: "2px solid rgba(17,24,39,0.1)",
    },
    userButtonPopoverCard: {
      backgroundColor: "#FFFFFF",
      border: "1px solid rgba(17,24,39,0.08)",
      borderRadius: "0.75rem",
      boxShadow: "0 8px 32px rgba(17,24,39,0.10)",
      color: "#111827",
    },
    userButtonPopoverActionButton: {
      color: "#111827",
      borderRadius: "0.5rem",
      "&:hover": {
        backgroundColor: "rgba(17,24,39,0.05)",
      },
    },
    userButtonPopoverActionButtonText: {
      color: "inherit",
      fontSize: "0.875rem",
    },
    userButtonPopoverFooter: {
      display: "none",
      color: "rgba(17,24,39,0.5)",
      borderTop: "1px solid rgba(17,24,39,0.08)",
    },

    // ─── Profile Page ───
    profilePage: {
      backgroundColor: "#F9FAFB",
    },
    profileSectionPrimaryButton: {
      backgroundColor: "#FFFFFF",
      color: "#111827",
      borderRadius: "0.375rem",
      border: "1px solid rgba(17,24,39,0.12)",
      "&:hover": {
        backgroundColor: "#F9FAFB",
      },
    },

    // ─── Modal / Overlay ───
    modalBackdrop: {
      backgroundColor: "rgba(17,24,39,0.4)",
      backdropFilter: "blur(8px)",
    },
    modalContent: {},

    // ─── Button Arrow ───
    socialButtonsBlockButtonArrow: {
      color: "rgba(17,24,39,0.4)",
    },

    // ─── Form Reset Password ───
    formResendCodeLink: {
      color: "#4F46E5",
      fontSize: "0.8125rem",
      "&:hover": {
        color: "#6366F1",
      },
    },

    // ─── Hide Help Link ───
    footerAction__getHelp: {
      display: "none",
    },

    // ─── Checkbox / Password Toggle ───
    formFieldLabelRow: {
      color: "rgba(17,24,39,0.7)",
    },
    formFieldInputShowPasswordButton: {
      color: "rgba(17,24,39,0.4)",
      "&:hover": {
        color: "rgba(17,24,39,0.7)",
      },
    },

    // ─── Breadcrumbs ───
    breadcrumbs: {
      color: "rgba(17,24,39,0.4)",
    },
    breadcrumbsItem: {
      color: "rgba(17,24,39,0.6)",
    },
    breadcrumbsItemDivider: {
      color: "rgba(17,24,39,0.2)",
    },
    breadcrumbsItemActive: {
      color: "#4F46E5",
    },
  },
};

export default clerkAppearance;
