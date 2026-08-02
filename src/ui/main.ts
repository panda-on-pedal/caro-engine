// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/app.css";
import { session } from "./lib/gameSession.svelte.ts";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app mount point");
}

mount(App, { target });

session.init().catch((error: unknown) => {
  console.error(error);
});
