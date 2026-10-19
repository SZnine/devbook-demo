# Content model

Markdown stores the editable content. Books and chapters organize independent body items; headings, lists, code and media remain Markdown elements within those items.

| Object | Purpose |
| --- | --- |
| `Note.kind = memo` | Independent note with timestamps, draft, archive state and optional source snapshot |
| `Note.kind = document` | Automatically saved body content belonging to a book or chapter |
| `Collection` | Book or chapter with title, summary and ordered content references |
| `Ref` | Leaf reference to a note or a bundled reference section; also identifies reading activity |
| `ContentRef` | Leaf or chapter reference in the collection order |
| `MemoSource` | Source location, title, path, Markdown quote, section context and capture time |
| `DeletedContent` | Deleted summary or body snapshot with its original location |

## Books and chapters

A collection with no parent is a book. A collection referenced by a parent is a chapter. Both can contain a summary, body items and child chapters. Parent traversal detects cycles; moving a chapter into itself or a descendant is rejected.

Archive and deletion preserve parent references. Restoring a chapter restores its hierarchy. Continuous reading expands child content in stored order without creating a combined document.

Adding a note to a book creates a new document ID and copies its content. The copies have independent editing and reading histories. Grouping, moving and reordering keep existing IDs.

## Citations

A quoted note stores its own Markdown and a source snapshot. The snapshot includes `kind`, `collectionId`, optional `ref`, `title`, `path`, `quote`, `quoteFormat` and `capturedAt`.

`contextMarkdown` and `contextTitle` capture the nearest section heading and body, ending at the next heading of equal or higher level. The Markdown AST and selection position determine that range; headings inside code fences and quotes do not split the surrounding section. Code selections retain language fences.

Changing or deleting the source does not change the note. Saving the note commits its snapshot. Citation-only drafts are cleared when dismissed; typed drafts are retained.

## Deletion and recovery

Text deletion uses the editor's undo history. Whole-item deletion records the deleted identity for session undo, with a limit of 100 entries. Manual recovery removes the corresponding undo entry.

Book and chapter deletion uses `Collection.deletedAt`, retaining descendants. Deleted bodies keep their content, position and reading alias. Summary recovery preserves an existing summary. Archive and Trash have separate restore actions.

## Storage compatibility

`read-notebook-v1` stores notes, documents, collections, summaries, drafts and deletion snapshots. Existing database names and content IDs must remain stable across migrations.

Older notes may omit `kind`. When a legacy shared note or document is first edited in a book, that position receives an independent document ID. The original content and reading history remain intact. The editor instance and its draft follow the new identity without losing undo history.

Legacy flat collections remain root books. Earlier section notes and drafts migrate once. Copies do not inherit reading activity, and deleting content does not erase its learning events.

Body drafts in `sessionStorage` are separate from the persistent note draft. A failed save keeps the input available for retry.

## Rendering and reference content

The editor uses Vditor for live Markdown and source editing. Static content uses the [Markdown renderer](../src/content/README.md). The same body content supplies editing, arrangement and continuous reading.

Bundled reference sections in `manual.json` keep stable IDs and separate question/answer or reading layouts. Creating an editable copy preserves the reference source and starts an independent reading history.

Reading activity is recorded for leaf content. Books, chapters and summaries have no aggregate freshness value. See [Reading and Memory](../DESIGN.md#reading-and-memory) for activity and scoring rules.
