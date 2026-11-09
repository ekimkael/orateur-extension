# Pocket TTS WebAssembly

`tts_wasm.js` and `tts_wasm_bg.wasm` are the unmodified Pocket runtime built
by the [idle-intelligence/tts-web Pages workflow](https://github.com/idle-intelligence/tts-web/blob/4ac4680af1dbe02dfbc78bf85f51e8523d614caf/.github/workflows/pages.yml)
from commit [`4ac4680af1dbe02dfbc78bf85f51e8523d614caf`](https://github.com/idle-intelligence/tts-web/tree/4ac4680af1dbe02dfbc78bf85f51e8523d614caf).
The deployed worker's build tag identified that revision. The runtime is
distributed under its [MIT license](LICENSE). See
[third-party notices](THIRD_PARTY_NOTICES.txt) for dependencies.
Orateur's `worker.js` wraps it
with a local message protocol and yields periodically for cancellation.

| File | SHA-256 |
| --- | --- |
| `tts_wasm.js` | `a343be88a628014116f72533333ca90dbca4fe505d160ddd030034671040899e` |
| `tts_wasm_bg.wasm` | `21a5b6b6d32d1fb3308b069ca77e2722552fe04bea1154b6b63aaa1c5de5e518` |

To rebuild, check out the linked revision. Use Rust 1.99.0, its
`wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.111, and
`wasm-pack` as described by the workflow. Run `scripts/build.sh` and take
only the two `tts_wasm` files from `_site/pkg/`. The build does not require
the speech models.

The English and French weights are [Idle Intelligence's Q8_0 conversions](https://huggingface.co/idle-intelligence/pocket-tts-gguf/tree/dab28d3740c448b4932d4414b4e473ee16b14331)
of [Kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The conversions
quantize the weights and omit the voice cloning encoder. The tokenizer and
compatible voice states use [Kyutai's model revision](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/4e1e0a3e611c51c0b4ed8174fc10f32a54644303).
Orateur downloads these model files on first use and verifies each size and
SHA-256 before use. The download never includes article text.
