import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChatBubble } from "@/components/chat/ChatKit";
import { FormattedChatMessage } from "@/components/chat/FormattedChatMessage";
import { HumanHandoffOffer } from "@/components/rentals/HumanHandoffOffer";
import { OpenGafferChat } from "@/components/gaffer/OpenGafferChat";
import { resolveRentalChatLink } from "@/lib/chatLinks";
import { suppressIneligibleGafferSupportActions } from "../../shared/gafferSupportActions";

const answered = suppressIneligibleGafferSupportActions("The FX3 hire is £100 per day. [Open contact form](/contact)", false);
const unresolved = suppressIneligibleGafferSupportActions("I checked the details, but this needs the team to confirm. https://www.dbcinemarentals.com/contact/?source=rental-chat", true);

(window as any).fixture = { openEvents: [] as string[], handoffCount: 0 };

function App() {
  useEffect(() => {
    const onOpen = (event: Event) => (window as any).fixture.openEvents.push((event as CustomEvent).detail?.prompt ?? "");
    window.addEventListener("dbc:open-gaffer-chat", onOpen);
    return () => window.removeEventListener("dbc:open-gaffer-chat", onOpen);
  }, []);
  const resolveRentalLink = (rawUrl: string, suppliedLabel?: string) => resolveRentalChatLink(rawUrl, suppliedLabel);
  return <main>
    <section aria-label="Contact Us Gaffer entry"><OpenGafferChat /></section>
    <section data-testid="resolved-answer"><ChatBubble role="assistant" text={answered} /></section>
    <section data-testid="unresolved-contact-answer"><ChatBubble role="assistant" text={unresolved} /></section>
    <section data-testid="rental-chat-contact-answer"><FormattedChatMessage text={unresolved} resolveLink={resolveRentalLink} tone="rental" /></section>
    <section aria-label="Current rental conversation"><HumanHandoffOffer onRequest={async () => { (window as any).fixture.handoffCount++; }} /></section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
