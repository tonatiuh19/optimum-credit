import { describe, expect, it } from "vitest";
import reducer, {
  clearAdminAsk,
  closeAdminAsk,
  openAdminAsk,
  sendAdminAiChat,
} from "./adminAiSlice";

describe("adminAiSlice", () => {
  it("replaces case context when opening global Ask", () => {
    let state = reducer(
      undefined,
      openAdminAsk({ case_id: 9, case_number: "CR-9" }),
    );
    expect(state.context?.case_id).toBe(9);
    state = reducer(state, openAdminAsk(null));
    expect(state.context).toBeNull();
    expect(state.open).toBe(true);
  });

  it("clears messages but keeps context", () => {
    let state = reducer(
      undefined,
      openAdminAsk({ case_id: 3, case_number: "CR-3" }),
    );
    state = {
      ...state,
      messages: [{ role: "user", content: "hi" }],
    };
    state = reducer(state, clearAdminAsk());
    expect(state.messages).toEqual([]);
    expect(state.context?.case_id).toBe(3);
  });

  it("drops optimistic user message on rejected send", () => {
    let state = reducer(undefined, openAdminAsk(null));
    state = reducer(
      state,
      sendAdminAiChat.pending("req-1", { content: "hello" }),
    );
    expect(state.messages).toHaveLength(1);
    state = reducer(
      state,
      sendAdminAiChat.rejected(
        new Error("fail"),
        "req-1",
        { content: "hello" },
        "Ask failed",
      ),
    );
    expect(state.sending).toBe(false);
    expect(state.error).toBe("Ask failed");
    expect(state.messages).toHaveLength(0);
    state = reducer(state, closeAdminAsk());
    expect(state.open).toBe(false);
  });
});
