import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { LEGAL_PATHS } from "@/lib/legal";
import LegalLinks from "@/components/LegalLinks";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="flex flex-col min-h-[100dvh] bg-background text-foreground w-full max-w-[100vw] overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 backdrop-blur-xl bg-background/80">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link
              to="/"
              className="flex items-center transition-opacity hover:opacity-80"
            >
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
                alt="Optimum Credit"
                className="h-8 md:h-9 w-auto dark:hidden"
              />
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
                alt=""
                aria-hidden
                className="h-8 md:h-9 w-auto hidden dark:block"
              />
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              <Link
                to="/"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("nav.home")}
              </Link>
              <a
                href="#how-it-works"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("nav.howItWorks")}
              </a>
              <a
                href="#packages"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("nav.packages")}
              </a>
              <a
                href="#testimonials"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("nav.testimonials")}
              </a>
            </nav>

            {/* CTA Button */}
            <div className="hidden md:flex items-center gap-3">
              <Link
                to="/portal/login"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("nav.clientPortal")}
              </Link>
              <Link to="/register" className="btn-primary">
                {t("nav.getStarted")}
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden flex items-center gap-2">
              <button
                className="inline-flex items-center justify-center p-2 rounded-lg hover:bg-secondary transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <nav className="md:hidden pb-4 space-y-2">
              <Link
                to="/"
                className="block px-4 py-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.home")}
              </Link>
              <a
                href="#how-it-works"
                className="block px-4 py-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.howItWorks")}
              </a>
              <a
                href="#packages"
                className="block px-4 py-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.packages")}
              </a>
              <a
                href="#testimonials"
                className="block px-4 py-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.testimonials")}
              </a>
              <Link
                to="/portal/login"
                className="block px-4 py-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.clientPortal")}
              </Link>
              <Link
                to="/register"
                className="w-full mt-4 btn-primary"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.getStarted")}
              </Link>
            </nav>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">{children}</main>

      {/* Footer */}
      <footer className="w-full border-t border-border/40 bg-card">
        <div className="section-inner section-container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div>
              <div className="mb-4">
                <img
                  src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
                  alt="Optimum Credit"
                  className="h-8 w-auto dark:hidden"
                />
                <img
                  src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
                  alt=""
                  aria-hidden
                  className="h-8 w-auto hidden dark:block"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("footer.tagline")}
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold mb-4 text-sm">
                {t("footer.product")}
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href="#how-it-works"
                    className="hover:text-foreground transition-colors"
                  >
                    {t("footer.howItWorks")}
                  </a>
                </li>
                <li>
                  <a
                    href="#packages"
                    className="hover:text-foreground transition-colors"
                  >
                    {t("footer.packages")}
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-foreground transition-colors"
                  >
                    {t("footer.pricing")}
                  </a>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="font-semibold mb-4 text-sm">
                {t("footer.company")}
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href="#"
                    className="hover:text-foreground transition-colors"
                  >
                    {t("footer.aboutUs")}
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-foreground transition-colors"
                  >
                    Blog
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="hover:text-foreground transition-colors"
                  >
                    Contact
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold mb-4 text-sm">
                {t("footer.legal")}
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <Link
                    to={LEGAL_PATHS.privacy}
                    className="hover:text-foreground transition-colors"
                  >
                    {t("legal.privacyPolicy")}
                  </Link>
                </li>
                <li>
                  <Link
                    to={LEGAL_PATHS.terms}
                    className="hover:text-foreground transition-colors"
                  >
                    {t("legal.termsOfService")}
                  </Link>
                </li>
                <li>
                  <Link
                    to={LEGAL_PATHS.smsTerms}
                    className="hover:text-foreground transition-colors"
                  >
                    {t("legal.smsTerms")}
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin/login"
                    className="hover:text-foreground transition-colors"
                  >
                    Admin Panel
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Footer Bottom */}
          <div className="border-t border-border/40 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground text-center md:text-left">
              {t("footer.allRightsReserved", {
                year: new Date().getFullYear(),
              })}
            </p>
            <div className="flex items-center gap-4">
              <ThemeToggle zone="portal" compact />
              <LanguageSwitcher variant="compact" />
              <LegalLinks className="text-sm text-muted-foreground hidden sm:inline-flex" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
