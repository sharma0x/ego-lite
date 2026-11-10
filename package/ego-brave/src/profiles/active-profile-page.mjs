const READY_ATTEMPTS = 15;
const READY_DELAY_MS = 150;

/**
 * Evaluates a script in a temporary browser page (chrome://version,
 * chrome://extensions) of the active profile, then closes the page.
 * CDP only opens targets in the most recently active profile, so callers
 * switch profiles first.
 */
export class ActiveProfilePage {
  #client;

  constructor(client) {
    this.#client = client;
  }

  /**
   * @param {string} url
   * @param {string} readyExpression truthy once the page can run `expression`
   * @param {string} expression awaited and returned by value
   * @returns {Promise<{ value: unknown, browserContextId: string }>}
   */
  async evaluate(url, readyExpression, expression) {
    const { targetId } = await this.#client.call("Target.createTarget", {
      url,
      background: true,
    });
    try {
      const sessionId = await this.#client.session(targetId);
      await this.#waitUntil(readyExpression, sessionId);
      const value = await this.#run(expression, sessionId);
      const { targetInfo } = await this.#client.call("Target.getTargetInfo", {
        targetId,
      });
      return { value, browserContextId: targetInfo.browserContextId };
    } finally {
      await this.#client
        .call("Target.closeTarget", { targetId })
        .catch(() => {});
    }
  }

  async #waitUntil(readyExpression, sessionId) {
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      if (await this.#run(readyExpression, sessionId)) return;
      await new Promise((settle) => setTimeout(settle, READY_DELAY_MS));
    }
  }

  async #run(expression, sessionId) {
    const { result, exceptionDetails } = await this.#client.call(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    }
    return result?.value;
  }
}
