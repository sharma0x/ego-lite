// The ego-brave CLI evaluates egoBrave.call() here over CDP. The call is
// forwarded to the service worker, which owns Spaces and tab groups.
globalThis.egoBrave = {
  async call(op, args) {
    const response = await chrome.runtime.sendMessage({
      channel: "ego-brave",
      op,
      args,
    });
    if (!response?.ok)
      throw new Error(
        response?.message ?? "ego-brave service worker did not respond",
      );
    return response.value;
  },
};

// egoBraveNotify is a Runtime binding added by each connected CLI process.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.channel !== "ego-brave-event") return;
  if (typeof globalThis.egoBraveNotify === "function")
    globalThis.egoBraveNotify(JSON.stringify(message.event));
});
