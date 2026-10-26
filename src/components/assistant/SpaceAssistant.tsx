"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, Send, X } from "lucide-react";
import { useSpaceAssistantContext } from "@/components/assistant/SpaceAssistantContext";
import { answerSpaceQuestion, getSuggestedQuestions } from "@/components/assistant/space-assistant-answers";

type AssistantPage = "mission" | "explorer" | "iss" | "settings";
type AssistantMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: "Explanation" | "Displayed data" | "Unavailable";
};

function pageFromPath(pathname: string): AssistantPage {
  if (pathname.startsWith("/explorer")) return "explorer";
  if (pathname.startsWith("/iss")) return "iss";
  if (pathname.startsWith("/settings")) return "settings";
  return "mission";
}

export function SpaceAssistant() {
  const pathname = usePathname();
  const page = pageFromPath(pathname);
  const { pageData } = useSpaceAssistantContext();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const nextId = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const currentPageData = pageData?.page === page ? pageData : null;
  const suggestions = useMemo(() => getSuggestedQuestions(page), [page]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    setDraft("");
  }, [page]);

  function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    const userMessage: AssistantMessage = { id: nextId.current++, role: "user", text: trimmed };
    const responses = answerSpaceQuestion(currentPageData, page, trimmed).map((answer) => ({
      id: nextId.current++,
      role: "assistant" as const,
      text: answer.text,
      kind: answer.kind,
    }));
    setMessages((current) => [...current, userMessage, ...responses]);
    setDraft("");
  }

  const pageStatus = currentPageData?.status;
  const statusText = pageStatus === "loading"
    ? "Syncing this page's data…"
    : pageStatus === "error"
      ? "Page data unavailable. Explanations are still available."
      : page === "explorer" && currentPageData?.page === "explorer" && !currentPageData.object
        ? "Select an asteroid to ask about its record."
        : page === "settings"
          ? "Ready · ask about the space-science topics VOID explains."
        : pageData?.page !== page
          ? "Connecting to this page's data…"
          : "Ready · answers use page data and built-in explanations.";

  return (
    <div className="space-assistant">
      {open && (
        <section
          id="space-assistant-panel"
          className="space-assistant__panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="space-assistant-title"
        >
          <header className="space-assistant__header">
            <div>
              <p className="space-assistant__eyebrow">VOID / CONTEXTUAL EXPLAINER</p>
              <h2 id="space-assistant-title">Space Assistant</h2>
            </div>
            <button
              type="button"
              className="space-assistant__close"
              aria-label="Close Space Assistant"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <p className="space-assistant__status" role="status">{statusText}</p>
          <p className="space-assistant__disclaimer">
            Local explanations only. Displayed measurements are kept separate from explanations; unavailable values are never estimated.
          </p>

          <div className="space-assistant__messages" aria-live="polite" aria-relevant="additions text">
            {messages.length === 0 ? (
              <div className="space-assistant__welcome">
                <p>Ask about the information shown on this page.</p>
                <span>Try one of these:</span>
                <div className="space-assistant__suggestions">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => sendQuestion(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : messages.map((message) => (
              <article
                key={message.id}
                className={`space-assistant__message space-assistant__message--${message.role}`}
              >
                {message.kind && <p className="space-assistant__message-kind">{message.kind}</p>}
                <p>{message.text}</p>
              </article>
            ))}
            <div ref={messageEndRef} />
          </div>

          <form
            className="space-assistant__form"
            onSubmit={(event) => {
              event.preventDefault();
              sendQuestion(draft);
            }}
          >
            <label className="sr-only" htmlFor="space-assistant-question">Ask about this VOID page</label>
            <input
              id="space-assistant-question"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about this page…"
              autoComplete="off"
            />
            <button type="submit" disabled={!draft.trim()} aria-label="Send question">
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </section>
      )}

      <button
        ref={triggerRef}
        type="button"
        className="space-assistant__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="space-assistant-panel"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={18} aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}
        <span>{open ? "Close assistant" : "Space assistant"}</span>
      </button>
    </div>
  );
}
