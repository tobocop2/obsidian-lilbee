/**
 * chat demo: towing question against cv-manual + click chip → source preview.
 *
 * cv-manual must be indexed before this runs. The `add` storyboard
 * leaves it indexed; or run the seed script before chat.
 */
import {
  beat,
  clickChip,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  waitChatIdle,
} from "../src/lib.ts";

const QUESTION = "I'm prepping this car to tow my boat. What does the manual say I need to check?";

export default storyboard("chat", {
  window: [1400, 900],
  layout: "chat-and-tasks",
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold", sleep(500)),
    beat("Type the towing question", fillChat(QUESTION), { holdMs: 600 }),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Qwen3 8B streams the cited answer", waitChatIdle(120_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 500 },
    ),
    beat("Click the first citation", clickChip(0), { holdMs: 5500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
