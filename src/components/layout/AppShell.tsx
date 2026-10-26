import { GlobalEffects } from "@/components/effects/GlobalEffects";
import { SpaceAssistant } from "@/components/assistant/SpaceAssistant";
import { SpaceAssistantProvider } from "@/components/assistant/SpaceAssistantContext";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import { StatusIndicator } from "@/components/mission/StatusIndicator/StatusIndicator";
import { UTCClock } from "@/components/mission/UTCClock/UTCClock";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export function AppShell({ children }: { children: React.ReactNode }) { return <SpaceAssistantProvider><div className="relative min-h-dvh overflow-x-hidden"><GlobalEffects /><header className="hud-header relative z-10 border-b border-[var(--color-line)] px-[var(--space-2)] py-[var(--space-2)]"><div className="mx-auto flex max-w-7xl items-center justify-between gap-[var(--space-2)]"><div><p className="m-0 font-[var(--font-display)] text-lg tracking-[0.28em] text-[var(--color-primary)] text-glow">VOID</p><p className="m-0 text-[0.5625rem] uppercase tracking-[0.2em] text-[var(--color-muted)]">Orbital Intelligence Network</p></div><div className="flex flex-col items-end gap-1 text-right"><UTCClock /><StatusIndicator /><ThemeToggle /></div></div></header><div className="relative z-10">{children}</div><BottomNavigation /><SpaceAssistant /></div></SpaceAssistantProvider>; }
