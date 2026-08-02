// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Legal banner prepended to every shipped bundle.
 *
 * Minifiers strip `//` comments, so the per-file SPDX headers do not survive
 * into `dist/`. This banner is injected after minification and is the notice
 * that actually reaches anyone running or redistributing a built copy.
 */

export const COPYRIGHT_YEAR = "2026";
export const COPYRIGHT_HOLDER = "Dang Nguyen <haidang009@outlook.com>";
export const SOURCE_URL = "https://github.com/panda-on-pedal/caro-engine";

export function legalBanner(version) {
  return `/*!
 * caro-tournament v${version}
 * Copyright (C) ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER}
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3 only,
 * as published by the Free Software Foundation. It is distributed WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.
 *
 * If you run a modified version of this program to interact with users over
 * a network, section 13 of the AGPL requires you to offer those users the
 * complete corresponding source code of your version, at no charge.
 *
 * Source: ${SOURCE_URL}
 */`;
}
