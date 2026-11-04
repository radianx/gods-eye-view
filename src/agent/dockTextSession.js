import { createAgentSession } from './agentLoop.js';

/**
 * Opt-in bridge from the shared dock's text lifetime to COMMAND's engine.
 * The host supplies an explicit account/model selection after authorization.
 * No credential, model fallback, provider picker or second tool loop lives here.
 * A changed account must stop this session before another selection is started.
 */
export function createDockTextSession({
  emit,
  runAction,
  signal,
  fetchImpl,
  getSelection,
  getAuthNote = () => '',
}) {
  let active = false;
  let selection;
  let engine;
  let generation = 0;
  let sequence = 0;
  let pending = null;
  const state = (value, detail) =>
    emit({ type: 'state', state: value, detail });
  const stop = ({ preserveStatus = false, removeUi = false } = {}) => {
    generation++;
    active = false;
    engine?.abort();
    engine = null;
    pending = null;
    selection = null;
    if (!preserveStatus && !removeUi) state('idle');
  };
  signal?.addEventListener('abort', () => stop({ removeUi: true }), {
    once: true,
  });
  return {
    getAuthNote,
    start() {
      if (signal?.aborted) return false;
      if (active) return true;
      const chosen = getSelection?.();
      // ChatGPT must never silently use an API key or a default account/model.
      if (
        chosen?.provider !== 'chatgpt' ||
        typeof chosen.model !== 'string' ||
        !chosen.model.trim() ||
        typeof chosen.binding !== 'string' ||
        !chosen.binding
      ) {
        state('error', 'Select an authorized ChatGPT account and model.');
        return false;
      }
      selection = { ...chosen };
      engine = createAgentSession({ runAction, fetchImpl });
      active = true;
      state('listening');
      return true;
    },
    stop,
    cancelTurn() {
      if (!active || !pending) return false;
      pending.cancelled = true;
      engine.abort();
      return true;
    },
    sendText(text) {
      if (!active || pending || !text?.trim() || signal?.aborted) return false;
      const owner = { generation, cancelled: false };
      pending = owner;
      const current = () => active && owner.generation === generation;
      const responseId = `chatgpt-dock-${++sequence}`;
      let item = 0;
      state('executing');
      void engine
        .send(text, {
          ...selection,
          onEvent(event) {
            if (!current() || owner.cancelled) return;
            if (event.type === 'message' && event.message.role === 'assistant')
              emit({
                type: 'transcript',
                role: 'assistant',
                text: event.message.content,
                final: true,
                responseId,
                itemId: `${responseId}-${++item}`,
              });
            // runAction already publishes action-call/result via the session.
            if (event.type === 'warning') emit(event);
          },
        })
        .then((result) => {
          if (!current()) return;
          pending = null;
          if (result.error && !owner.cancelled) {
            // Keep engine history after a failed reply, like the dock's key path.
            state('error', result.error);
            return;
          }
          state('listening');
          emit({
            type: 'completion',
            responseId,
            status: owner.cancelled ? 'cancelled' : 'completed',
            spoken: false,
          });
        });
      return true;
    },
    // COMMAND currently derives context through server-owned tools. Do not
    // inject a second prompt or claim to support the dock's radio handoff.
    sendMapEvent: () => false,
  };
}
