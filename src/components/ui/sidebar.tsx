"use client";

/**
 * Hover-expand sidebar adapted from Manu Arora / Aceternity UI (MIT),
 * wired for TradeCatch: light theme only, Lucide icons, framer-motion,
 * next-intl Link, and keyboard / ARIA support.
 */
import { cn } from "@/lib/cn";
import { Link } from "@/i18n/navigation";
import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";
import type { ComponentProps } from "react";

export interface SidebarNavLink {
  label: string;
  href: ComponentProps<typeof Link>["href"];
  icon: React.JSX.Element | React.ReactNode;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(
  undefined,
);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

export function SidebarProvider({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;
  const shouldAnimate = animate && !prefersReducedMotion;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate: shouldAnimate }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
}

export function SidebarBody({
  mobileLeading,
  mobileTrailing,
  openMenuLabel = "Open navigation",
  closeMenuLabel = "Close navigation",
  ...props
}: ComponentProps<typeof motion.div> & {
  /** Content shown on the left of the mobile top bar (brand, etc.). */
  mobileLeading?: React.ReactNode;
  /** Content shown before the menu button on the mobile top bar. */
  mobileTrailing?: React.ReactNode;
  openMenuLabel?: string;
  closeMenuLabel?: string;
}) {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar
        mobileLeading={mobileLeading}
        mobileTrailing={mobileTrailing}
        openMenuLabel={openMenuLabel}
        closeMenuLabel={closeMenuLabel}
        className={props.className}
      >
        {props.children as React.ReactNode}
      </MobileSidebar>
    </>
  );
}

export function DesktopSidebar({
  className,
  children,
  ...props
}: ComponentProps<typeof motion.div>) {
  const { open, setOpen, animate } = useSidebar();

  return (
    <motion.div
      className={cn(
        "sticky top-0 hidden h-screen w-[300px] shrink-0 overflow-hidden border-r border-[rgb(var(--ink-rgb)/0.08)] bg-neutral-100 px-3 py-4 md:flex md:flex-col",
        className,
      )}
      animate={{
        width: animate ? (open ? "300px" : "60px") : "300px",
      }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MobileSidebar({
  className,
  children,
  mobileLeading,
  mobileTrailing,
  openMenuLabel = "Open navigation",
  closeMenuLabel = "Close navigation",
}: {
  className?: string;
  children: React.ReactNode;
  mobileLeading?: React.ReactNode;
  mobileTrailing?: React.ReactNode;
  openMenuLabel?: string;
  closeMenuLabel?: string;
}) {
  const { open, setOpen } = useSidebar();
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, setOpen]);

  return (
    <>
      <div
        className={cn(
          "flex h-14 w-full flex-row items-center justify-between border-b border-[rgb(var(--ink-rgb)/0.08)] bg-neutral-100 px-4 md:hidden",
        )}
      >
        <div className="z-20 flex w-full items-center gap-3">
          <div className="min-w-0 flex-1">{mobileLeading}</div>
          {mobileTrailing}
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={openMenuLabel}
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <AnimatePresence>
          {open ? (
            <motion.div
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-100%", opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className={cn(
                "fixed inset-0 z-[100] flex h-full w-full flex-col justify-between bg-white p-6",
                className,
              )}
            >
              <span id={titleId} className="sr-only">
                TradeCatch
              </span>
              <button
                type="button"
                className="absolute right-4 top-4 z-50 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2"
                aria-label={closeMenuLabel}
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </button>
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}

export function SidebarLink({
  link,
  className,
  active = false,
  onNavigate,
  ...props
}: {
  link: SidebarNavLink;
  className?: string;
  active?: boolean;
  onNavigate?: () => void;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">) {
  const { open, animate, setOpen } = useSidebar();

  return (
    <Link
      href={link.href}
      aria-label={link.label}
      aria-current={active ? "page" : undefined}
      title={!open && animate ? link.label : undefined}
      onClick={() => {
        onNavigate?.();
        // Close the full-screen drawer after choosing a destination.
        if (typeof window !== "undefined" && window.innerWidth < 768) {
          setOpen(false);
        }
      }}
      className={cn(
        "group/sidebar flex min-h-11 items-center justify-start gap-2 rounded-md px-2 py-2 text-sm text-heading transition-colors",
        active
          ? "bg-[rgb(var(--ink-rgb)/0.08)] font-medium"
          : "hover:bg-[rgb(var(--ink-rgb)/0.05)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      {link.icon}
      <motion.span
        transition={{ duration: 0 }}
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="!m-0 inline-block whitespace-pre !p-0 text-sm text-heading"
      >
        {link.label}
      </motion.span>
    </Link>
  );
}
