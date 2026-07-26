import { Logger } from "./logger.ts";

describe("Logger sink", () => {
  it("forwards log/warn/error to the sink instead of console when set", () => {
    const logger = new Logger();
    const forwarded: Array<{ level: string; args: readonly unknown[] }> = [];
    logger.setDebug(true);
    logger.setSink((level, args) => {
      forwarded.push({ level, args });
    });

    logger.log("a", 1);
    logger.warn("b");
    logger.error("c");

    expect(forwarded).toEqual([
      { level: "log", args: ["a", 1] },
      { level: "warn", args: ["b"] },
      { level: "error", args: ["c"] },
    ]);
  });

  it("does not forward debug logs when debug is off", () => {
    const logger = new Logger();
    const forwarded: Array<{ level: string }> = [];
    logger.setSink((level) => {
      forwarded.push({ level });
    });

    logger.log("hidden");
    logger.warn("shown");

    expect(forwarded).toEqual([{ level: "warn" }]);
  });

  it("clears the sink and returns to local write", () => {
    const logger = new Logger();
    const forwarded: unknown[] = [];
    logger.setDebug(true);
    logger.setSink((_level, args) => {
      forwarded.push(...args);
    });
    logger.log("via-sink");
    logger.setSink(null);

    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    logger.log("local");
    expect(forwarded).toEqual(["via-sink"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
