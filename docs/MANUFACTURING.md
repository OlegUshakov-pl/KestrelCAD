# Manufacturing drafting

The **Drafting** ribbon tab adds machine-drawing annotations on top of the
production drafting tools: dimension tolerances, surface finish symbols,
balloon callouts, rotation by reference points, and right-click command repeat.
All objects are ordinary native entities: they save to `.kcad`, participate in
one-step undo/redo, copy through the clipboard, edit in the Properties panel,
and export to DXF as static lines, circles/text and filled triangles — no
proprietary DXF extensions.

## 1. Dimension tolerances

Select a dimension and use either the Properties panel or right-click
**Tolerance…** (`TOLERANCE`, `TOL`). A tolerance is one to four letters/digits:

| Input | Meaning |
| --- | --- |
| `H7` | Uppercase letter = hole basis (ISO 286 / GOST 25346) |
| `g6` | Lowercase letter = shaft basis |
| `a`, `Z` | Letter only |
| `7`, `12` | Tolerance grade only |

Spaces, symbols and values longer than four characters are rejected with an
error message. The case is preserved. Two display modes are available:
**Right of dimension** (`Ø40 H7`) and **In parentheses** (`Ø40 (H7)`).

The tolerance is stored in `DIMENSION.tolerance` with
`DIMENSION.tolerancePosition`. It is appended to the computed measurement or
to a manual text override, follows associative geometry updates, exports in
DXF TEXT, and is searchable/replaceable through `FIND` / `REPLACE` as a
separate target. Numerical ISO 286 limit deviations are not computed in this
version.

## 2. Surface finish (roughness)

**Drafting → Surface finish** places `Ra 1.6`, `Ra 3.2`, `Ra 6.3` or
`Ra 12.5`. Click a line, arc, circle, polyline or mesh edge; the symbol tip
snaps to the nearest point, and the symbol is oriented by the surface normal.
The tool stays active for repeated placement until **Esc** or **Enter**.
Type `F` while placing to mirror the symbol to the other side of the edge.

The symbol is drawn as a GOST 2.309 check mark and text using ordinary lines
and TEXT. `ROUGHNESS` stores `position`, `normal`, `tangent`, `text`, `style`
(`plain`, `removal`, `no-removal`) and `flipped`. The Properties panel edits
all of them; right-click **Surface finish settings…** opens the same dialog.
Symbol height follows the drafting text-height default and scales with the
entity. Standard values live in `K.Production.ROUGHNESS_VALUES`, so more can
be added without changing the placement code.

## 3. Rotate by reference points

`ROTATEP` (`RP`) or **Drafting → Tolerance & rotate → Rotate by points**
extends the usual center + angle flow:

1. select objects;
2. pick the rotation center;
3. pick the reference point (initial direction from the center);
4. pick the target point, or type an angle for the rotation from the
   reference direction.

A dashed rubber line shows center → reference and center → cursor, with the
live angle. Typing `P` while the ordinary `ROTATE` tool is active switches to
this mode. The result is identical to rotating by the equivalent angle.
The default center + angle workflow is unchanged; `P` is only an option while
ROTATE is active (outside a tool `P` remains Pan).

## 4. Position callouts

`POSITION` (`POS`) or **Drafting → Positions → Position callout** opens a
dialog with the number form (**Circle** or **Shelf line**), leader end
(**Arrow** or **Dot**) and the number. By default the number auto-increments.
Pick the anchor on the part, then the number location. The callout stores
`points` (anchor + label), `text`, `form`, `end` and `textHeight`; all are
editable in the Properties panel and via right-click **Callout settings…**.

The number is a normal text slot and can host an associative `FIELD` (for
example to link a bill of materials); field-controlled text is protected from
ordinary edits and displays evaluated text in DXF. DXF export flattens the
circle or shelf, leader, arrow/dot and number into LINE/TEXT/3DFACE geometry.

## 5. Repeat last command

Right-clicking the drawing while idle now shows **Repeat: <last command>**
as the first item of the context menu (`REPEAT`, `RPT`). It is disabled until a
command has been used. The repeat reuses the same tool with the same options —
for example the last Ra value, the last callout form/end, and a callout number
increased by one. If a tool is active, the menu keeps its previous
Finish/Close/Cancel items, so right-click behaviour is not hijacked during
polylines or other multi-click commands. Enter with no active tool still
repeats the last tool.

## Tests and persistence

`tests/manufacturing.test.js` checks tolerance validation/display/search,
all roughness and callout variants, `.kcad` round trips, atomic undo/redo,
clipboard cloning, field binding and static DXF output.
`tests/manufacturing.browser.py` checks the real ribbon, context menu,
dialogs, placement, mirroring, auto-increment and rotate-by-point workflows.
Old version 1/2 projects without these entity types continue to load.
