"use client";

import { Info } from "lucide-react";
import { useId } from "react";

export function InfoTooltip({ label, content }: { label: string; content: string }) {
  const tooltipId = useId();

  return (
    <span className="info-tooltip">
      <button
        type="button"
        aria-label={`More information: ${label}`}
        aria-describedby={tooltipId}
        className="info-tooltip__trigger"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span id={tooltipId} role="tooltip" className="info-tooltip__content">
        {content}
      </span>
    </span>
  );
}
