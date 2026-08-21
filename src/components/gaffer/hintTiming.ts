/**
 * When to show the "here's how to hang up" hint.
 *
 * Hanging up is the one thing a first-time voice caller cannot guess, and the
 * moment they've just been asked a question is the moment they're looking at
 * the screen. So the panel shows itself once, in the first natural gap — when
 * Gaffer stops talking after its opening question — then gets out of the way.
 *
 * Pulled out of the provider so the timing can actually be tested: it's a state
 * machine over a stream of mode changes, and the failure modes (never fires, or
 * fires every single time Gaffer pauses) are both invisible until someone is on
 * a real call.
 */

export type HintController = {
  /** Feed every agent mode change in. */
  noteTalking: (talking: boolean) => void;
  /** New call — arm it again. */
  reset: () => void;
};

export function createHintController({
  show,
  hide,
  ms,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  show: () => void;
  hide: () => void;
  ms: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): HintController {
  let wasTalking = false;
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    noteTalking(talking: boolean) {
      // the falling edge — Gaffer has just finished saying something
      if (wasTalking && !talking && !fired) {
        fired = true;
        show();
        timer = setTimer(() => {
          timer = null;
          hide();
        }, ms);
      }
      wasTalking = talking;
    },
    reset() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      wasTalking = false;
      fired = false;
    },
  };
}
