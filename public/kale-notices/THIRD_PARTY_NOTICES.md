# Third-party notices

kale-tts-1 (weights and code: Apache-2.0; dataset: CC BY 4.0) includes or is derived from the works below. Their licences and notices
travel with every copy. The full Apache License 2.0 text is in `LICENSE` (and in `frontend/dizione/LICENSE`).

## Model weights
- **Kokoro-82M** (hexgrad, huggingface.co/hexgrad/Kokoro-82M, Apache-2.0). The kale-tts-1 text side starts from Kokoro-82M's weights.
  Changes: fine-tuned on the kale-tts-1 voices, distilled to smaller text sides, joined to a new decoder, and exported to ONNX.
  The IPA-to-id table (`tokenizer.json`, `frontend/words/ipa2kokoro.json`) is Kokoro's.
- **Maya-1** (Maya Research, huggingface.co/maya-research/maya1, Apache-2.0). All training audio is original Maya-1 output from text
  voice descriptions (decoded with SNAC, MIT, Copyright (c) 2023 Descript, Copyright (c) 2024 Hubert Siuzdak). Based on Maya. Every voice
  is synthetic and is nobody real; follow the Maya-1 use policy (no impersonation, never present the audio as a human recording).
- **StyleTTS2** (github.com/yl4579/StyleTTS2, MIT, Copyright (c) 2023 Aaron (Yinghao) Li) and **kikiri-tts** (github.com/semidark/kikiri-tts,
  Apache-2.0): the teacher's training code.

- **Ettin encoder 17M** (jhu-clsp/ettin-encoder-17m, github.com/JHU-CLSP/ettin-encoder-vs-decoder, MIT): kale-tts-1-tiny's text side
  contains its weights (frozen) and ships its tokenizer as `ettin-tokenizer.json`; `frontend/ettin.js` reimplements the tokenizer.

```
MIT License

Copyright (c) 2025 Johns Hopkins University Center for Language and Speech Processing

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Text front end (`frontend/`)
- **CMUdict** (github.com/cmusphinx/cmudict, BSD-2-Clause style). `frontend/words/lexicon.tsv`, the en-gb word list
  (`frontend/words/en-gb/lexicon.tsv`), the unknown-word guessers (`g2p.bin`) and the `kokoro-compatible/lexicon-us-en.txt` files are
  made from it. Its licence:

```
Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
   The contents of this file are deemed to be source code.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

This work was supported in part by funding from the Defense Advanced
Research Projects Agency, the Office of Naval Research and the National
Science Foundation of the United States of America, and by member
companies of the Carnegie Mellon Sphinx Speech Consortium. We acknowledge
the contributions of many volunteers to the expansion and improvement of
this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND
ANY EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

- **Britfone 3.0.1** (github.com/JoseLlarena/Britfone, MIT). The en-gb word list (`frontend/words/en-gb/lexicon.tsv`) uses it.

```
MIT License

Copyright (c) 2017 Jose Llarena

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

- **dizione** (github.com/n4ze3m/dizione, Apache-2.0, `frontend/dizione/LICENSE`): the number, date, time, unit and abbreviation rules in
  `frontend/dizione/` are a port of its text rules. The homograph tables (`frontend/dizione/homographs.data.js`) come from
  github.com/n4ze3m/tiny-voca (Apache-2.0), trained on the Wikipedia Homograph Data (github.com/google-research-datasets/WikipediaHomographData,
  Apache-2.0; Gorman, Mazovetskiy and Nikolaev, LREC 2018); the tables hold word lists and weights only, no Wikipedia text.

## Training recipe (`recipe/`)
- **Paradee** (github.com/sahilmahendrakar/paradee @ 2de547e45da92840a636c499eb0782e988be1e47, Apache-2.0): `vhead.py`,
  `student_decoder.py` and `discriminators.py`, copied unchanged into `recipe/train/third_party/paradee/` with its LICENSE and NOTICE.
  No Paradee weights are used.
- StyleTTS2 / AuxiliaryASR (MIT, Copyright (c) 2022-2023 Aaron (Yinghao) Li) and kikiri-tts (Apache-2.0): cloned at pinned revisions by
  `recipe/teacher/`; one class copied from AuxiliaryASR is marked in `recipe/teacher/teacher.py`.

## Browser demo (`space/`)
- **onnxruntime-web** (github.com/microsoft/onnxruntime, MIT, Copyright (c) Microsoft Corporation): `space/ort/`, with its `LICENSE`.
