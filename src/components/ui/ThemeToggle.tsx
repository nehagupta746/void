"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/ThemeProvider";

const options = [
  { value: "dark", label: "Dark space", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`Use ${label} theme`}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn("theme-toggle__button", theme === value && "theme-toggle__button--active")}
        >
          <Icon size={13} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
