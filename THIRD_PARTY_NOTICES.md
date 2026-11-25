<!-- Adapted from openclaw/openclaw (MIT), modified for Squidbot. -->

# Third-party notices

Squidbot is Apache-2.0. This file keeps the upstream notices that must travel
with the code. OpenClaw's own MIT license is in `third_party/openclaw/LICENSE`.
OpenMausBot's Apache-2.0 license is in `third_party/openmausbot/LICENSE`.
Pi / pi-mono remains MIT, © 2025 Mario Zechner, below.

## OpenClaw

The gateway, channels, agent loop, and Control UI are adapted from OpenClaw.

- Upstream: https://github.com/openclaw/openclaw
- Version imported: v2026.11.10
- License: MIT
- Copyright: Copyright (c) 2026 OpenClaw Foundation

## OpenMausBot

Usage caps, connected-app grants, team export scrubbing, room routing,
assignment limits, the credential broker, the RFB input filter, and the Noise
phone handshake are adapted from OpenMausBot. The `enterprise/` tree was not
copied.

- Upstream: https://github.com/milind-soni/OpenMausBot
- Revision consulted: 96ff8445 (v0.1.180)
- License: Apache-2.0
- Copyright: Copyright 2026 Milind Soni and OpenMausBot contributors

## T3 Code

The public-address egress check is adapted from the policy OpenMausBot adapted
from T3 Code.

- License: MIT
- Copyright: Copyright (c) 2026 T3 Tools Inc.
- Text: `third_party/t3-code/LICENSE`

## Hermes Agent

The RFB input filter is adapted from Hermes Agent, via OpenMausBot.

- License: MIT
- Copyright: Copyright (c) 2025 Nous Research
- Text: `third_party/hermes-agent/LICENSE`

The rest of this file is OpenClaw's original third-party notice, kept intact.

This file records third-party notices for code or substantial implementation
portions incorporated into OpenClaw source, beyond normal package-manager
dependency metadata.

## SQLite

macOS standalone builds include SQLite, compiled by `scripts/build-mac-sqlite.sh`
from the source archive pinned in `scripts/lib/sqlite-macos.json`.

- Upstream: https://sqlite.org/
- License: Public domain (https://sqlite.org/copyright.html)

SQLite's source code is in the public domain. No copyright license is required
to use, copy, modify, or distribute it.

## Pi / pi-mono

Portions of OpenClaw were adapted from Pi / pi-mono, and OpenClaw also depends
on `@earendil-works/pi-tui` for terminal UI rendering.

- Upstream: https://github.com/earendil-works/pi-mono
- Package family: `@earendil-works/pi-*`
- License: MIT
- Copyright: Copyright (c) 2025 Mario Zechner

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## GitHub Octicons

The Control UI bundles the `issue-opened-16` and `git-pull-request-16` icon paths.

- Upstream: https://github.com/primer/octicons
- License: MIT
- Copyright: Copyright (c) 2026 GitHub Inc.

MIT License

Copyright (c) 2026 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Hermes Agent

OpenClaw's live repetition guard adapts the bounded streaming checks, repeated
text detection, and sampled exact-period expansion from Hermes Agent.

- Upstream: https://github.com/NousResearch/hermes-agent
- Source: https://github.com/NousResearch/hermes-agent/blob/acc3cada0da86c81efc8aa6c5a291989549ca900/agent/repetition_guard.py
- OpenClaw source: `packages/agent-core/src/repetition-guard.ts`
- License: MIT
- Copyright: Copyright (c) 2025 Nous Research

MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
