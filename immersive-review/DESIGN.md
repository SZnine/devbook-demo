# Interface

Read has three workspaces: Notes for capture, Library for books and chapters, and Memory for revisiting content. A collapsible sidebar provides navigation; the editor toolbar floats above the writing surface.

## Writing

Book and chapter pages use a continuous surface for the title, summary and body. Chapter navigation uses compact link rows. Cards are used for the book shelf, note feed and arrangement view.

The editor renders Markdown as you type. Source mode edits the same content. Insert commands operate on the current selection or insert an empty structure at the caret. Body content saves automatically; notes have a Save action.

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘+Enter` | Continue after a nested block, or save ordinary text |
| `Ctrl/⌘+Shift+Enter` | Save |
| `Ctrl/⌘+Z` | Undo text edits or the last item deletion |
| `Ctrl+Alt+M` | Toggle the block toolbar |
| `/` on an empty line | Search blocks |

Input method composition takes priority over editor shortcuts. Theme and language changes preserve the editor instance and undo history.

## Organization

Books are root collections; chapters belong to a parent. Arrangement supports selection, grouping, moving and reordering. Continuous reading follows the stored order and edits the original body items.

Adding a note to a book creates an independent body copy. Editing either copy does not change the other. Right-click actions include writing a note, copying and deleting. With selected text, Delete affects only that selection. Deleted items can be restored from Trash; archived items have a separate Archive view.

Quoted notes keep a Markdown snapshot with the selected text's section heading and body. Source and note remain independent. A citation border appears on click and clears when the pointer leaves.

## Reading and Memory

Reading activity accumulates while content is visible, the window is focused and the user is active. A record requires 20–90 seconds and sufficient content coverage. Editing, summaries, navigation and arrangement do not count. Repeated activity within 30 minutes is merged; same-day repeats do not increase long-term weight.

Memory shows each item's title and a green bar for:

`priority × (1 − freshness)^decayWeight`

Freshness estimates recent familiarity from reading activity. History, corrections and manual priority are available in item details. Memory settings control decay and optional model scoring. Scoring compares up to 20 recent items using chapter and section titles with short excerpts. Manual priority takes precedence.

## Assistant

The resizable right panel contains conversations, history and a composer. Selected text is attached only when enabled. Context can include the selection, its full section, or the section with chapter outline and book title. Response styles are Minimal, Essence, Normal and Detailed.

Model and style controls stay in the composer footer. Context preview and history overlay the panel. The divider supports dragging and arrow keys. Conversation history stays in the browser; responses do not modify content automatically.

## Layout and motion

The desktop sidebar is 244 px wide, the header 56 px high, and the body up to 736 px wide. The reference outline reserves 280 px below the header on wide screens and uses an overlay on narrower windows.

Dark mode uses neutral charcoal surfaces and colored action icons. Control feedback lasts 100–130 ms; tree expansion lasts 220 ms and supports reversal. Reduced-motion preferences are respected. Page changes keep the reading surface stationary.

## References

- [Craft: Blocks and pages](https://support.craft.do/en/write-and-edit/blocks-and-pages)
- [Craft Assistant](https://support.craft.do/en/ai-assistant/using)
- [GitBook: Page structure](https://gitbook.com/docs/create-content/content-structure/page)
- [Scrivener: Corkboard](https://www.literatureandlatte.com/blog/organize-your-scrivener-project-with-the-corkboard)
- [Excalidraw](https://excalidraw.com/)
- [Momos](https://momosz.com/)
- [Radix: Collapsible](https://www.radix-ui.com/primitives/docs/components/collapsible)

[Content model](docs/BLOCKS.md) · [Configuration](docs/CONFIGURATION.md)
