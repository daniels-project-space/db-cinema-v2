/**
 * Correlates streamed agent-response events for one live voice connection.
 * ElevenLabs can report a correction or an older response after a newer turn
 * has started. Those events must not complete, reset, or replace the active
 * answer.
 */
export type AgentResponseEvent = {
  type?: unknown;
  event_id?: unknown;
  response_id?: unknown;
  message?: unknown;
  text?: unknown;
};

const responseId = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 180) : null;
const eventId = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const normalizedText = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

export function createResponseTurnGate() {
  let activeResponseId: string | null = null;
  let activeStartEventId: number | null = null;
  let latestCallerEventId: number | null = null;
  let latestStartEventId: number | null = null;
  let latestAgentEventId: number | null = null;
  let activeResponseHasId = false;
  let activeTextFinished = false;
  let activeStopObserved = false;
  let activeMessageObserved = false;
  // The installed SDK's response-part and final-message payloads carry only a
  // monotonically increasing event_id, not a response_id. If another start
  // arrives while one answer is open, following deltas without response IDs
  // cannot safely be assigned to either answer.
  let activeResponseAmbiguous = false;
  let responsePartsObserved = false;
  let hasStartedResponse = false;
  let callerTurn = 0;
  let latestPartCallerTurn = -1;
  const closedResponseIds: string[] = [];
  const discardedResponseIds: string[] = [];
  const staleResponseText = new Map<string, string>();
  let activeResponseText = "";

  const remember = (list: string[], id: string | null) => {
    if (!id || list.includes(id)) return;
    list.push(id);
    if (list.length > 40) list.splice(0, list.length - 40);
  };
  const rememberStaleText = (id: string | null, text: string) => {
    if (!id || !text) return;
    staleResponseText.set(id, text.slice(0, 24_000));
    while (staleResponseText.size > 40) staleResponseText.delete(staleResponseText.keys().next().value!);
  };
  const appendText = (current: string, value: unknown) => {
    if (typeof value !== "string" || !value) return current;
    return `${current}${value}`.slice(0, 24_000);
  };
  const discardActive = () => {
    remember(closedResponseIds, activeResponseId);
    rememberStaleText(activeResponseId, activeResponseText);
    activeResponseId = null;
    activeStartEventId = null;
    activeResponseHasId = false;
    activeTextFinished = false;
    activeStopObserved = false;
    activeMessageObserved = false;
    activeResponseAmbiguous = false;
    activeResponseText = "";
  };
  const matchesActive = (event: AgentResponseEvent) => {
    const incomingId = responseId(event.response_id);
    const incomingEventId = eventId(event.event_id);
    if (activeResponseHasId) {
      if (incomingId) return incomingId === activeResponseId;
      // The SDK forwards event_id even on older payloads that omit response_id.
      // Accept the matching response sequence, but never an older answer.
      return incomingEventId !== null && activeStartEventId !== null && incomingEventId >= activeStartEventId;
    }
    if (activeStartEventId !== null) {
      if (incomingId) return false;
      return incomingEventId !== null && incomingEventId >= activeStartEventId;
    }
    return false;
  };

  return {
    /** The caller's transcript closes any response that it interrupted. */
    noteCallerTurn(event: AgentResponseEvent = {}) {
      const incoming = eventId(event.event_id);
      if (incoming !== null && latestCallerEventId !== null && incoming < latestCallerEventId) return false;
      if (incoming !== null) latestCallerEventId = incoming;
      callerTurn += 1;
      discardActive();
      return true;
    },

    /**
     * Interruptions invalidate the current response before its late events
     * arrive. An interruption event alone does not authorize another answer;
     * the caller transcript must arrive first.
     */
    interrupt(event: AgentResponseEvent = {}) {
      const incoming = eventId(event.event_id);
      if (activeResponseId) remember(discardedResponseIds, activeResponseId);
      discardActive();
      if (incoming !== null && (latestStartEventId === null || incoming > latestStartEventId)) latestStartEventId = incoming;
    },

    /**
     * A second start while a response is active is a duplicate/revision, not a
     * new spoken turn. Only a caller turn, interruption, or initial greeting
     * may open the next response.
     */
    acceptPart(event: AgentResponseEvent, allowNewResponse: boolean) {
      responsePartsObserved = true;
      const type = typeof event.type === "string" ? event.type : "";
      const incomingId = responseId(event.response_id);
      const incomingEventId = eventId(event.event_id);
      if (type === "start") {
        if (incomingId && (closedResponseIds.includes(incomingId) || discardedResponseIds.includes(incomingId))) return false;
        if (incomingId && incomingId === activeResponseId) return false;
        if (activeResponseId !== null || activeStartEventId !== null) {
          if (incomingId) {
            remember(discardedResponseIds, incomingId);
            if (!staleResponseText.has(incomingId)) staleResponseText.set(incomingId, "");
          } else if (incomingEventId === null || activeStartEventId === null || incomingEventId > activeStartEventId) {
            // Without response IDs, a distinct start means later event IDs
            // may be a second answer. Fail closed instead of appending its
            // conclusion to the earlier spoken turn.
            activeResponseAmbiguous = true;
          }
          return false;
        }
        if (!allowNewResponse) {
          if (incomingId) {
            remember(discardedResponseIds, incomingId);
            if (!staleResponseText.has(incomingId)) staleResponseText.set(incomingId, "");
          }
          return false;
        }
        if (incomingEventId !== null && latestStartEventId !== null && incomingEventId <= latestStartEventId) {
          if (incomingId) {
            remember(discardedResponseIds, incomingId);
            if (!staleResponseText.has(incomingId)) staleResponseText.set(incomingId, "");
          }
          return false;
        }
        if (!incomingId && incomingEventId === null && activeResponseId) return false;
        discardActive();
        activeResponseId = incomingId;
        activeStartEventId = incomingEventId;
        activeResponseHasId = !!incomingId;
        activeTextFinished = false;
        activeStopObserved = false;
        activeMessageObserved = false;
        activeResponseAmbiguous = false;
        activeResponseText = "";
        if (incomingEventId !== null) latestStartEventId = incomingEventId;
        hasStartedResponse = true;
        latestPartCallerTurn = callerTurn;
        return true;
      }
      if (type !== "delta" && type !== "stop") return false;
      if (incomingId && staleResponseText.has(incomingId) && incomingId !== activeResponseId) {
        staleResponseText.set(incomingId, appendText(staleResponseText.get(incomingId) ?? "", event.text));
        return false;
      }
      if (!matchesActive(event)) return false;
      if (activeResponseAmbiguous) {
        // A stop still closes the uncorrelatable provider turn so it cannot
        // leave the caller state pending forever. Its final text is discarded.
        if (type !== "stop" || activeStopObserved) return false;
        activeTextFinished = true;
        activeStopObserved = true;
        return true;
      }
      if (type === "delta" && activeTextFinished) return false;
      if (type === "stop") {
        if (activeStopObserved) return false;
        activeTextFinished = true;
        activeStopObserved = true;
      } else activeResponseText = appendText(activeResponseText, event.text);
      return true;
    },

    /**
     * agent_response is the finalized text callback. When response-part events
     * are not enabled in the provider, preserve the SDK's older callback path.
     */
    acceptMessage(event: AgentResponseEvent, allowNewResponse: boolean) {
      const incomingId = responseId(event.response_id);
      const incomingEventId = eventId(event.event_id);
      const text = normalizedText(event.message);
      if (incomingEventId !== null && latestCallerEventId !== null && incomingEventId < latestCallerEventId) return false;
      if (activeResponseAmbiguous) return false;
      if (incomingId && (closedResponseIds.includes(incomingId) || discardedResponseIds.includes(incomingId))) return false;
      if (!incomingId && text && [...staleResponseText.values()].some(stale => normalizedText(stale) === text)) return false;
      if (responsePartsObserved && activeResponseId === null && activeStartEventId === null && latestPartCallerTurn === callerTurn) return false;
      if (activeResponseId || activeStartEventId !== null) {
        if (activeMessageObserved || !matchesActive(event)) return false;
        // The installed SDK omits response_id from onMessage. When overlapping
        // response IDs were observed in the stream, use their chunk text to
        // reject a final transcript that belongs to one of the stale streams.
        const matchesActiveText = !!text && text === normalizedText(activeResponseText);
        const matchesStaleText = !!text && [...staleResponseText.values()].some(stale =>
          !!normalizedText(stale) && normalizedText(stale) === text);
        if (!incomingId && matchesStaleText && !matchesActiveText) return false;
        if (!incomingId && staleResponseText.size > 0 && [...staleResponseText.values()].some(Boolean) && !matchesActiveText && !matchesStaleText) return false;
      } else {
        // A final transcript without a matching active start must not bypass
        // the same caller/tool gate that rejected its start event. Otherwise
        // a partial tool result can still land as a complete answer through
        // the separate `onMessage` callback.
        if (!allowNewResponse) return false;
        if (latestAgentEventId !== null && incomingEventId !== null && incomingEventId <= latestAgentEventId) return false;
      }
      if (incomingEventId !== null) latestAgentEventId = Math.max(latestAgentEventId ?? incomingEventId, incomingEventId);
      activeTextFinished = true;
      activeMessageObserved = true;
      hasStartedResponse = true;
      latestPartCallerTurn = callerTurn;
      return true;
    },

    acceptCorrection(event: AgentResponseEvent) {
      const incomingId = responseId(event.response_id);
      const incomingEventId = eventId(event.event_id);
      if (incomingEventId !== null && latestCallerEventId !== null && incomingEventId < latestCallerEventId) return false;
      if (incomingId && (closedResponseIds.includes(incomingId) || discardedResponseIds.includes(incomingId))) return false;
      if (responsePartsObserved && activeResponseId === null && activeStartEventId === null) return false;
      if (activeResponseId || activeStartEventId !== null) return matchesActive(event);
      if (latestAgentEventId !== null && incomingEventId !== null && incomingEventId < latestAgentEventId) return false;
      return true;
    },

    /** Seal only after both response text and audible speech have finished. */
    complete() {
      discardActive();
    },

    reset() {
      activeResponseId = null;
      activeStartEventId = null;
      latestCallerEventId = null;
      latestStartEventId = null;
      latestAgentEventId = null;
      activeResponseHasId = false;
      activeTextFinished = false;
      activeStopObserved = false;
      activeMessageObserved = false;
      activeResponseText = "";
      responsePartsObserved = false;
      hasStartedResponse = false;
      callerTurn = 0;
      latestPartCallerTurn = -1;
      closedResponseIds.length = 0;
      discardedResponseIds.length = 0;
      staleResponseText.clear();
    },

    get hasStartedResponse() { return hasStartedResponse; },
    get hasUnansweredCallerTurn() { return callerTurn > latestPartCallerTurn; },
    get hasActiveResponse() { return activeResponseId !== null || activeStartEventId !== null; },
    get isAmbiguous() { return activeResponseAmbiguous; },
  };
}
