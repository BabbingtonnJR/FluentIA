# Credits

Fluentia's Japanese content is built from open datasets. Their licenses require attribution,
and derived data (`public/packs/ja/*.json`) stays under the same terms.

| Data | Source | License |
|---|---|---|
| JLPT vocabulary lists (N5–N3) | [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) by Jamie Sinclair, based on [Jonathan Waller's JLPT lists](http://www.tanos.co.uk/jlpt/) | MIT; original lists CC BY |
| Kanji meanings and readings | [KANJIDIC](http://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (EDRDG), via [kanji-data](https://github.com/davidluzgouveia/kanji-data) by David Gouveia | CC BY-SA 4.0 |
| Kanji JLPT levels | Jonathan Waller's JLPT lists, via kanji-data | CC BY |
| Stroke order | [KanjiVG](https://kanjivg.tagaini.net/) by Ulrich Apel | CC BY-SA 3.0 |
| Spaced repetition | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (FSRS algorithm) | MIT |
| Reading sentences, English translations and furigana | [Tatoeba](https://tatoeba.org/) contributors (each sentence keeps its Tatoeba ID and links back to it in the app) | CC BY 2.0 FR |
| Word segmentation (at build time, and in the app for imported subtitles) | [kuromoji.js](https://github.com/takuyaa/kuromoji.js) with the IPADIC dictionary | Apache 2.0; IPADIC license |
| Manga text recognition (on your own computer, not shipped) | [mokuro](https://github.com/kha-white/mokuro) and manga-ocr by Maciej Budyś, used by tools/manga-to-fluentia.ps1 | GPL-3.0 (mokuro), Apache 2.0 (manga-ocr) |
| Literature texts | [Aozora Bunko (青空文庫)](https://www.aozora.gr.jp/), typed and proofread by volunteers (each story credits its source edition, input and proofreading staff in the app) | Public domain (authors died before 1968) |
| Comic | [Pepper&Carrot](https://www.peppercarrot.com/) by David Revoy, Japanese translation by its volunteer translators (named on each episode in the app). Page images load from peppercarrot.com; the text comes from the translation's SVG files | CC BY 4.0 |
| Story audio | [LibriVox](https://librivox.org/) volunteer readings of ごん狐, 杜子春 and 赤い蝋燭と人魚, streamed from archive.org | Public domain |
| Anki deck import (in the app) | [sql.js](https://github.com/sql-js/sql.js) (SQLite in WebAssembly) and [fzstd](https://github.com/101arrowz/fzstd) (zstd decoder) | MIT |

WaniKani fields present in the kanji-data source are not used.

The grammar points in `content/ja/grammar/` (explanations and their own example sentences) were
written for Fluentia and are under the project's MIT license. Extra grammar examples marked with a
Tatoeba ID come from Tatoeba under CC BY 2.0 FR.

The stories in the literature reader (`content/ja/literature/works.json`) are public-domain works from Aozora Bunko. Their furigana is the
original ruby where the text has it, otherwise generated with kuromoji; the word breakdowns are generated.

The graded readers (`content/ja/literature/graded.json`, the N5 and N4 stories about Lucas and Hana) were written for
Fluentia, with their English translations, and are under the project's MIT license.

The test decks in `src/anki/fixtures/` are built from open-anki-jlpt-decks (MIT) with a few cards written for the tests.

The speaking practice (`content/ja/speaking/`: dialogues, quick replies and situations) and the reading passages
(`content/ja/reading/passages.json`) were written for Fluentia, with their translations and questions, and are under
the project's MIT license.

Recorded voices (`public/audio/ja/`, made with `tools/voices-to-fluentia.ps1`) are synthesized with
[VOICEVOX](https://voicevox.hiroshiba.jp/): VOICEVOX:冥鳴ひまり and VOICEVOX:青山龍星, used under each voice's
terms, which ask for this credit. The pitch accents in `public/packs/ja/pitch.json` come from the same engine's
dictionary (Open JTalk).
