"use client";

import { Component, Fragment, type ReactNode } from "react";
import { EmailLink } from "@/components/EmailLink";
import { BUSINESS_CONTACT_EMAIL } from "../../../shared/businessEmail";

type ChatErrorBoundaryProps = { children: ReactNode; fallbackHref?: string; fallbackLabel?: string };
type ChatErrorBoundaryState = { hasError: boolean; retryKey: number };

export class ChatErrorBoundary extends Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
  state: ChatErrorBoundaryState = { hasError: false, retryKey: 0 };

  static getDerivedStateFromError(): Partial<ChatErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[customer-chat] failed to render", error);
  }

  retry = () => this.setState(state => ({ hasError: false, retryKey: state.retryKey + 1 }));

  render() {
    if (this.state.hasError) {
      return (
        <section role="alert" data-testid="chat-load-error" className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-amber-100/15 bg-gradient-to-br from-amber-100/[0.055] via-white/[0.025] to-transparent px-5 py-8 text-center shadow-[inset_0_1px_0_#ffffff0a]">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full border border-amber-100/25 bg-amber-100/10 text-xl text-amber-100">↻</span>
          <p className="text-sm font-medium text-white/85">This conversation didn’t load.</p>
          <button type="button" data-testid="chat-load-retry" onClick={this.retry} className="rounded-full bg-[#d3aa7c] px-5 py-2.5 text-xs font-semibold text-[#17130f] shadow-[0_8px_24px_#d3aa7c24] transition hover:bg-[#e0bc92]">
            Retry chat
          </button>
          {this.props.fallbackHref === `mailto:${BUSINESS_CONTACT_EMAIL}` ? (
            <span data-testid="chat-contact-fallback"><EmailLink label={`${this.props.fallbackLabel ?? "Contact support"} ↗`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[.035] px-4 text-xs font-medium text-white/70 transition hover:border-white/20 hover:bg-white/[.07] hover:text-white" /></span>
          ) : (
            <a data-testid="chat-contact-fallback" href={this.props.fallbackHref ?? "/contact"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[.035] px-4 text-xs font-medium text-white/70 transition hover:border-white/20 hover:bg-white/[.07] hover:text-white">
              {this.props.fallbackLabel ?? "Contact support"} <span aria-hidden="true">↗</span>
            </a>
          )}
        </section>
      );
    }
    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}
