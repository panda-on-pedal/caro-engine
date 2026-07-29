/** Keep PersistentExperienceStore background seeding off the network in tests. */
beforeEach(() => {
  if (typeof globalThis.fetch === "function" && !("mock" in globalThis.fetch)) {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
    } as Response);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});
