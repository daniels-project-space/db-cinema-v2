import { GafferCall } from "@/components/GafferCall";

/**
 * "Ask Gaffer" panel for the pages where someone is most likely to be stuck:
 * guides, the FAQ and contact.
 *
 * It starts the same voice call as everywhere else — the difference is that
 * Gaffer is told, at connect, which page it was opened from (see callContext),
 * so a call from a gimbal guide opens as setup help and a call from the FAQ
 * opens as troubleshooting. Pass `topic` when the page knows more than the URL
 * does, e.g. the guide's actual title.
 */
export function AskGaffer({
  title = "Rather just ask?",
  blurb = "Talk to Gaffer — our voice assistant. It knows the catalogue, your basket and what you're reading right now.",
  topic,
  className = "",
}: {
  title?: string;
  blurb?: string;
  topic?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-4 rounded-2xl glass px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${className}`}
    >
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold text-white/90">{title}</h3>
        <p className="mt-1 max-w-xl text-sm text-white/50">{blurb}</p>
      </div>
      <GafferCall label="Ask Gaffer" topic={topic} className="shrink-0" />
    </div>
  );
}
