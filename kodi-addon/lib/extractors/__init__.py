"""Pi-local stream resolvers (scaffolding).

Empty registry today — the v1.3.3 pivot routes playback through
script.module.resolveurl rather than per-provider Python extractors,
since ResolveURL already covers 250+ file hosters and the embed-
aggregator targets (embedsu/vidsrc/miruro) are architecturally dead.

Kept as a hook in case a future provider needs custom Python logic
that ResolveURL doesn't cover. Add to LOCAL by provider name; the
playback path will pick it up when present.
"""

LOCAL = {}


class ExtractorError(Exception):
    pass
