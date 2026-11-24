"use client";

import type { ReactNode } from "react";
import { EmailLink } from "@/components/EmailLink";

export type FormattedChatLink = {
  href: string;
  label: string;
  kind: "action" | "email" | "inline";
  ariaLabel?: string;
  subject?: string;
  openInNewTab?: boolean;
};

export type FormattedChatLinkResolver = (
  rawUrl: string,
  suppliedLabel: string | undefined,
  isMarkdownLink: boolean,
) => FormattedChatLink | null;

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|javascript:[^\s)]+|\/(?!\/)[^\s)]+|\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|javascript:[^\s<>"']+|(?<![\w.])\/(?!\/)[^\s<>"']+|\/\/[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

function linkDedupeKey(href: string) {
  try {
    const url = new URL(href, "https://dbcinemarentals.com");
    if (url.protocol === "mailto:") return `${url.protocol}${url.pathname.toLowerCase()}${url.search}`;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    if (hostname === "dbcinemarentals.com" && pathname === "/contact") return "https://dbcinemarentals.com/contact";
    return `${url.protocol}//${hostname}${pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

function actionLinkLabel(link: FormattedChatLink) {
  try {
    const url = new URL(link.href, "https://dbcinemarentals.com");
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (url.protocol === "mailto:") return "Email the team";
    if (hostname === "dbcinemarentals.com" && pathname === "/contact") return "Open contact form";
    if (hostname === "checkout.stripe.com") return "Open secure payment";
    if (hostname === "verify.didit.me" || hostname === "verification.didit.me") return "Continue verification";
    if (hostname === "maps.google.com" || hostname === "google.com" && /^\/maps(?:\/|$)/.test(pathname)) return "Open map";
  } catch {
    return "Open approved link";
  }

  const label = link.label.replace(/\s+/g, " ").trim();
  return label.length <= 48 ? label : `${label.slice(0, 47).trimEnd()}…`;
}

function ActionGlyph({ href }: { href: string }) {
  let kind: "verify" | "payment" | "message" | "link" = "link";
  try {
    const url = new URL(href, "https://dbcinemarentals.com");
    if (url.hostname === "verify.didit.me" || url.hostname === "verification.didit.me") kind = "verify";
    else if (url.hostname === "checkout.stripe.com") kind = "payment";
    else if (url.hostname.replace(/^www\./, "") === "dbcinemarentals.com" && /^\/contact\/?$/.test(url.pathname)) kind = "message";
  } catch { kind = "link"; }
  return <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-current/20 bg-black/[.07] text-current">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      {kind === "verify" ? <><path d="M12 3 5 6v5c0 4 2.5 7.4 7 10 4.5-2.6 7-6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></> : kind === "payment" ? <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/></> : kind === "message" ? <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/> : <path d="M9 15 15 9M8 11l-2 2a3 3 0 0 0 4 4l2-2M16 13l2-2a3 3 0 0 0-4-4l-2 2"/>}
    </svg>
  </span>;
}

function inlineNodes(
  text: string,
  keyPrefix: string,
  resolveLink?: FormattedChatLinkResolver,
  linkMode: "resolved" | "literal" = "resolved",
  actionClassName = "",
  inlineClassName = "",
  seenLinks = new Set<string>(),
  standaloneAction = false,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  const links = new RegExp(LINK_RE.source, LINK_RE.flags);

  const addFormattedText = (value: string, key: string) => value.split(/(\*\*[^*]+\*\*)/g).forEach((part, index) => {
    output.push(part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${key}-bold-${index}`} className="font-semibold text-white">{part.slice(2, -2)}</strong>
      : part);
  });

  while ((match = links.exec(text))) {
    const at = match.index;
    if (at > cursor) addFormattedText(text.slice(cursor, at), `${keyPrefix}-${cursor}`);
    if (linkMode === "literal") {
      output.push(match[0]);
      cursor = at + match[0].length;
      continue;
    }
    const isMarkdownLink = match[1] !== undefined;
    const suppliedLabel = match[1]?.trim();
    const matchedUrl = match[2] ?? match[3];
    const rawUrl = isMarkdownLink ? matchedUrl : matchedUrl.replace(/[.,!?;:]+$/, "");
    const punctuation = isMarkdownLink ? "" : matchedUrl.slice(rawUrl.length);
    const isBareEmailAddress = !isMarkdownLink && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(rawUrl);
    const link = resolveLink?.(rawUrl, suppliedLabel, isMarkdownLink);

    if (!link) {
      const untrustedLabel = suppliedLabel?.trim() ?? "";
      const unresolvedTarget = /^(?:https?:\/\/|mailto:|javascript:|\/\/|\/)/i.test(rawUrl) || rawUrl.includes("@") && !isBareEmailAddress;
      const labelLooksLikeTarget = /^(?:https?:\/\/|mailto:|\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(untrustedLabel);
      if (unresolvedTarget) {
        const safeLabel = untrustedLabel.slice(0, 72);
        const unavailableLabel = isMarkdownLink && safeLabel && !labelLooksLikeTarget ? `${safeLabel} · unavailable` : "Link unavailable";
        output.push(<span key={`${keyPrefix}-${at}-unavailable`} aria-label="Link unavailable" className="font-medium text-white/55">{unavailableLabel}</span>);
        if (punctuation) output.push(punctuation);
      } else {
        addFormattedText(isMarkdownLink ? untrustedLabel : matchedUrl, `${keyPrefix}-${at}-plain`);
      }
    } else if (seenLinks.has(linkDedupeKey(link.href)) || seenLinks.size >= 6) {
      if (link.kind === "inline") {
        addFormattedText(suppliedLabel ?? link.label, `${keyPrefix}-${at}-duplicate`);
      } else {
        const lastIndex = output.length - 1;
        const previous = output[lastIndex];
        if (typeof previous === "string") {
          const withoutJoiner = previous.replace(/\s+(?:or|and)(?:\s+(?:use|click|open|visit|follow))?\s*$/i, "");
          if (withoutJoiner) output[lastIndex] = withoutJoiner;
          else output.pop();
        }
      }
    } else {
      seenLinks.add(linkDedupeKey(link.href));
      const className = link.kind === "inline" || link.kind === "email" ? inlineClassName : standaloneAction
        ? "my-1 inline-flex min-h-12 w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-xl border border-[#f4d699] bg-gradient-to-r from-[#f5d68f] to-[#c99b5e] px-3 py-2 text-left text-xs font-semibold text-[#20160b] shadow-[inset_0_1px_rgba(255,255,255,.4),0_8px_24px_-14px_rgba(215,163,91,.8)] transition-colors motion-reduce:transition-none hover:from-[#ffe2a4] hover:to-[#ddb679] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3d499]"
        : actionClassName;
      const label = link.kind === "action" ? actionLinkLabel(link) : link.label;
      if (link.kind === "email") {
        output.push(<EmailLink
          key={`${keyPrefix}-${at}-email`}
          label={label}
          ariaLabel={link.ariaLabel}
          subject={link.subject}
          className={className}
        />);
      } else {
        output.push(<a
          key={`${keyPrefix}-${at}-link`}
          href={link.href}
          {...(link.openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          aria-label={link.ariaLabel}
          className={className}
        >
          {link.kind === "action" && <ActionGlyph href={link.href} />}
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{label}</span>
          {link.kind === "action" && <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0"><path d="M5 15 15 5M7 5h8v8" /></svg>}
        </a>);
      }
      if (punctuation) output.push(punctuation);
    }
    cursor = at + match[0].length;
  }

  if (cursor < text.length) addFormattedText(text.slice(cursor), `${keyPrefix}-${cursor}`);
  return output;
}

export function FormattedChatMessage({
  text,
  resolveLink,
  tone = "rental",
  linkMode = "resolved",
}: {
  text: string;
  resolveLink?: FormattedChatLinkResolver;
  tone?: "gaffer" | "rental";
  linkMode?: "resolved" | "literal";
}) {
  const actionClassName = tone === "gaffer"
    ? "my-1 inline-flex min-h-12 min-w-0 max-w-full items-center gap-2 whitespace-normal rounded-xl border border-[#d6b17d]/35 bg-gradient-to-r from-[#d5a66a]/20 via-[#bd8a54]/10 to-[#171615]/20 px-3 py-2 text-left text-xs font-semibold text-[#f5dfbd] no-underline shadow-[inset_0_1px_rgba(255,255,255,.08),0_8px_24px_-16px_rgba(224,170,104,.8)] transition-colors motion-reduce:transition-none hover:border-[#f1cf99]/70 hover:from-[#d5a66a]/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3d499]"
    : "my-1 inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 whitespace-normal rounded-xl border border-[#d6b17d]/35 bg-gradient-to-r from-[#d5a66a]/15 to-[#171615]/20 px-3 py-2 align-middle text-left text-xs font-semibold leading-tight text-[#f5dfbd] shadow-[inset_0_1px_0_rgba(255,255,255,.08)] transition-colors motion-reduce:transition-none hover:border-[#f1cf99]/70 hover:from-[#d5a66a]/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3d499]";
  const inlineClassName = "break-words font-medium text-accent-300 underline decoration-accent-400/40 underline-offset-2 [overflow-wrap:anywhere] transition-colors hover:text-accent-200 hover:decoration-accent-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-200/70";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const seenLinks = new Set<string>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      blocks.push(<Heading key={`heading-${index}`} className="my-1 min-w-0 max-w-full font-semibold text-white [overflow-wrap:anywhere]">{inlineNodes(heading[2], `heading-${index}`, resolveLink, linkMode, actionClassName, inlineClassName, seenLinks)}</Heading>);
      index += 1;
      continue;
    }

    const listItem = line.match(/^\s*(?:[-*•]\s+|\d+[.)]\s+)(.*)$/);
    if (listItem) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: { text: string; line: number }[] = [];
      while (index < lines.length) {
        const current = lines[index].match(/^\s*(?:([-*•])\s+|(\d+)[.)]\s+)(.*)$/);
        if (!current || Boolean(current[2]) !== ordered) break;
        items.push({ text: current[3], line: index });
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={`list-${items[0]?.line ?? index}`} className={`${ordered ? "list-decimal" : "list-disc"} rounded-xl border border-white/10 bg-black/15 py-1 pl-8 pr-3 marker:text-[#e1b97f]`}>
        {items.map((item) => <li key={`item-${item.line}`} className="min-w-0 border-b border-white/[.07] py-2 pl-0.5 last:border-0 [overflow-wrap:anywhere]">{inlineNodes(item.text, `item-${item.line}`, resolveLink, linkMode, actionClassName, inlineClassName, seenLinks)}</li>)}
      </List>);
      continue;
    }

    const paragraph: { text: string; line: number }[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (index > 0 && /^\s*(?:[-*•]\s+|\d+[.)]\s+)/.test(lines[index])) break;
      if (/^\s{0,3}#{1,3}\s+/.test(lines[index])) break;
      paragraph.push({ text: lines[index], line: index });
      index += 1;
    }
    if (!paragraph.length) continue;
    const renderedParagraph = paragraph.map((part) => ({
      ...part,
      nodes: inlineNodes(part.text, `paragraph-${part.line}`, resolveLink, linkMode, actionClassName, inlineClassName, seenLinks, new RegExp(`^(?:${LINK_RE.source})$`, "i").test(part.text.trim())),
    })).filter((part) => part.nodes.some((node) => typeof node !== "string" || node.length > 0));
    if (!renderedParagraph.length) continue;
    blocks.push(<p key={`paragraph-${paragraph[0].line}`} className="m-0 min-w-0 max-w-full leading-relaxed [overflow-wrap:anywhere]">
      {renderedParagraph.map((part, partIndex) => <span key={`line-${part.line}`}>
        {partIndex > 0 && <br />}
        {part.nodes}
      </span>)}
    </p>);
  }

  return <div className="min-w-0 max-w-full space-y-2 break-words [overflow-wrap:anywhere]">{blocks}</div>;
}
