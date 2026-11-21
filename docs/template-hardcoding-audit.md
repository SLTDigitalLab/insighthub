# Template hard-coding audit (read-only)

Scope: whole repo (backend, frontend, scripts, config, seed data, `n8n-workflows/*.json`, bundled templates, stored template index).
Method: read the code paths for template upload, tag detection, mapping, AI generation, rendering and archiving; ran `extractTags` on the bundled and stored templates; read the system prompts of the exported n8n workflows. No code was changed.
Caveat: the exported n8n JSON in the repo may be older than what is deployed (the deployed Solution workflow returns `excel_ref_not_found`, the repo copy does not contain that string). Prompt findings below describe the repo copies.

---

## 1. Summary

**Verdict: Partly.**

| Flow | Template-agnostic today? |
|---|---|
| Solution proposal | **Mostly yes.** Tags are read from the uploaded template at run time, sent to n8n with the Excel grid, and the answer is rendered into whatever tags exist. Remaining coupling is in the agent prompt and in the fact that the author must pre-write the tags. |
| Product proposal | **No.** A fixed field schema (`proposal/fieldSchema.js`) is the contract. The template is adapted to the schema, not the other way round. A new or renamed tag is silently left empty, the AI never sees the template, and the editor screen has fixed sections. |

Findings: **26 total — 7 HIGH, 12 MEDIUM, 7 LOW.**

Proof that the Product flow is schema-bound, not template-bound: the bundled default template has 46 tags including `amPhoneClause` and `logoXml`-style names; the active stored version (v21) has 17 tags. Any tag whose name is not a key in `FIELDS` (for example `amPhoneClause`) gets no binding and prints empty (`autoBind.js:35-49`, `renderService.js:119-120`). No error is raised.

---

## 2. Findings table (sorted by severity)

| ID | Sev | Where | What is hard-coded |
|---|---|---|---|
| H1 | HIGH | `backend/proposal/fieldSchema.js:18-82`, `proposal/autoBind.js:35-49`, `services/renderService.js:119-120` | Fixed list of ~40 field keys = the only tag names that can be filled. Unknown tags print empty, silently. |
| H2 | HIGH | `backend/services/draftService.js:115,164-174` | n8n receives `aiFields` from the schema, never the template or its tags. AI fills only 4 fixed fields. |
| H3 | HIGH | `fieldSchema.js:35-49`, `draftService.js:18,131-152`, `renderService.js:77-82` | Fixed table structures: requirements, components, investment columns; `showFeatures`, `highPriority`; `recommendations` special case; max 5 rows. |
| H4 | HIGH | `fieldSchema.js:94-110`, `renderService.js:87-107`, `renderSettings.js:29-34` | Composed blocks (`letterXml`, `requirementsXml`, `aboutXml`, `address`) with fixed composition and wording ("1. Name", " — High priority"). |
| H5 | HIGH | `services/templateMappingService.js` (whole), `fieldSchema.js:19-71` (mapHints), `renderSettings.js:58`, `templateDraftService.js:310-318` | Product upload only works if the template marks variable parts in red and matches the schema's slots; otherwise upload is rejected (422). |
| H6 | HIGH | `services/templateTagWriter.js:117-166`, `fieldSchema.js:127-135`, `renderSettings.js:33` | Upload rewrites the "requirements" block into a `{#requirements}` loop (title line + description line + diagram). |
| H7 | HIGH | `frontend/src/components/ProposalAgent.jsx:68,168,854,869,898,927-942,946,957,971,1033` | Editor has fixed sections, fixed inputs, fixed table columns and page numbers in titles. A new tag has no input; a removed section still shows. |
| M1 | MED | `renderSettings.js:70-72`, `templateDraftService.js:202-209,261` | Sample address of the current template is whitelisted; other leftover sample data fails the upload. |
| M2 | MED | `templateDraftService.js:191-200,210-265` | Upload validation fills the template with schema dummy data and rejects on missing/looping mismatches. |
| M3 | MED | `renderSettings.js:91-99`, `services/templateFormats.js:204-229` | "Terms and Conditions" heading regex locates the formatting for product terms. Renamed heading: silent loss of formatting. |
| M4 | MED | `templateStoreService.js:14-19,79-94`, `renderSettings.js:14`, `routes/proposals.js:314-322`, `ProposalHub.jsx:176-186`, bundled `.docx` files | Bundled default template is a fallback and the "Restore Default" target. |
| M5 | MED | `draftService.js:24-28,46-59,87-113`, `renderSettings.js:19-22` | System-field resolvers: date format "23 OCT 2026", address split into 3 lines, Sri Lanka country strip, product properties (`service`, `accessMedia`, `ntu`). |
| M6 | MED | `renderSettings.js:75-84`, `autoBind.js:21` | Column synonym list and `toc\d+` pattern encode the naming habits of past templates. |
| M7 | MED | `services/templateSpacers.js:22-24,50-52,128` | Spacer cleanup assumes the cover and letter come before the first heading. |
| M8 | MED | `renderSettings.js:36-55`, `services/ooxml.js:38-98` | Generated paragraph formatting (style `BodyText`, colour `0B2A6F`, indents, bullet) is fixed. |
| M9 | MED | `frontend/src/pages/ProposalHub.jsx:~690-760` | Admin instructions and "Key Placeholder Tags Reference" table list the current schema tags and page-1 logo layout. |
| M10 | MED | `n8n-workflows/Proposal_Template_Mapper.json` (AI Agent prompt) | Prompt examples name `companyName` / `ackCompanyName` and the red-text convention. |
| M11 | MED | `n8n-workflows/Solution_Proposal_Agent.json` (AI Agent prompt, second half) | Rules tied to the current template: optional-items loop, terms loop of `{label, lines}`, initial/monthly/commitment charge answers. |
| M12 | MED | `services/solutionTemplateService.js:10-13,26-28` | Solution upload needs the author to have written the `{tags}`; no auto-tagging (documented TODO). |
| L1 | LOW | `n8n-workflows/Proposal Agent.json` (Format Response node) | Old workflow with the whole letter text, solution table and investment table hard-coded. Not called by the backend. |
| L2 | LOW | `fieldSchema.js:87`, `renderService.js:204-257`, `ProposalAgent.jsx:1033` | Preview chips (cover/letter/requirements/about/solution/investment) fixed; they hide themselves if not found. |
| L3 | LOW | `renderSettings.js:19-25`, `ProposalAgent.jsx:1169,1175` | Brand, locale and file-name prefix. |
| L4 | LOW | `ProposalAgent.jsx:~1160-1340` | HTML preview with fixed text ("Dear Sir / Madam", "Proposed Solution"). |
| L5 | LOW | `data/proposal_templates.json`, `backend/test/productTerms.test.js` | 21 stored product template versions; a test depends on the default template. |
| L6 | LOW | `renderSettings.js:113-125`, `services/logoService.js:15,99` | `{%client_logo}` tag / alt-text convention. Acceptable as a convention. |
| L7 | LOW | `services/solutionSchemaService.js:10`, `Solution_Proposal_Agent.json` (Parse AI Output) | Fixed set of 5 user details (`name, phone, email, designation, division`). |

---

## 3. Detailed findings

### H1 — The field schema is the template contract (Product)
- **File**: `backend/proposal/fieldSchema.js:1-4,18-82`; `proposal/autoBind.js:12-13,35-49`; `services/renderService.js:116-120`
- **Excerpt**: `// This is the ONLY place field names live. Templates are adapted to this list (see autoBind.js), not the other way round.` and `if (!binding || binding.kind === 'none') data[tag.name] = tag.type === 'loop' ? [] : ...''`
- **Hard-coded**: ~40 keys (`companyName`, `refNo`, `recipientDesignation`, `aboutDescription`, `amName`, `rebmName`, `ackInitialCharge`, ...), grouped in sections `cover|letter|requirements|about|solution|investment|contact|acknowledgement`.
- **Breaks when**: next year's template adds `{warrantyPeriod}`, renames `{amPhone}` to `{contactPhone}`, or adds a new section. The tag is detected at upload (`templateTagService`) but has no binding, so `renderService.buildData` prints `''` with no warning and no AI value. Evidence already in the repo: `amPhoneClause` in the default template.
- **Should live in**: n8n agent. Send the template's tag list (name, type, surrounding context, loop children) as the Solution flow already does, and let the agent fill any tag. Code only maps returned values to tags.

### H2 — The AI never sees the Product template
- **File**: `services/draftService.js:115,164-174`
- **Excerpt**: `const aiFields = () => FIELDS.filter(f => f.owner === 'ai');` and `payload = { aiFields: wanted.map(({ key, label, type, columns, hint }) => ...` 
- **Hard-coded**: which fields the AI writes: `recipientDesignation`, `aboutDescription`, `recommendations`, `solutionSummary`. All others are filled in code (`resolveSource`, `draftService.js:87-113`) or left for the rep.
- **Breaks when**: a new template needs a new narrative (e.g. "Why SLT") — nothing asks the AI for it. The n8n workflow `Proposal_Agent_v2.json` is generic (builds its prompt from `aiFields`), but is fed a fixed list.
- **Should live in**: generic code sends template tags + context; n8n agent decides what each tag needs.

### H3 — Hard-coded table structures (Product)
- **File**: `fieldSchema.js:35-49` (requirements, components, investment); `draftService.js:18,131-152`; `renderService.js:77-82,123-137`
- **Excerpt**: `columns: [{ key: 'service', source: 'product.service' }, { key: 'station', source: 'company.locality' }, { key: 'media', source: 'product.accessMedia' }, { key: 'ntu', source: 'product.ntu' }]`; `if (field.key === 'recommendations') {... .slice(0, MAX_RECOMMENDATIONS)`; `c.key === 'showFeatures' || c.key === 'highPriority' ? false : ''`.
- **Breaks when**: the components table gets a new column ("SLA") or the investment table drops "QoS template": the extra column prints empty; money formatting applies only to `oneTimeCharge` / `monthlyRental`.
- **Should live in**: n8n agent, using the loop's child tag names from the template. Money formatting can stay as generic mechanics (the Solution renderer already does this: `solutionRenderService.js:20-30`).

### H4 — Composed blocks and generated wording
- **File**: `fieldSchema.js:94-110`; `renderService.js:87-107`; `renderSettings.js:29-34`
- **Excerpt**: `wording: { prioritySuffix: ' — High priority', itemTitle: (n, name) => \`${n}. ${name}\`, itemLines: { title: '{number}. {title}', description: '{description}' } }`
- **Hard-coded**: how `letterXml` = two catalogue paragraphs, `requirementsXml` = numbered title + text per product, `aboutXml` = description + numbered recommendations, `address` = three fields joined with commas.
- **Breaks when**: the new letter has different structure (e.g. three paragraphs, bulleted list, different numbering). Code still emits the old layout into the tag.
- **Should live in**: n8n agent returns finished block text for a `rawXml` tag (Solution flow does this: "separate paragraphs with a newline, `- ` for a bullet").

### H5 — Product upload depends on red text and the schema's slot list
- **File**: `templateMappingService.js:3-24` (rules), `fieldSchema.js:19-71` (`mapHint` per slot, e.g. "NOT the 'Company Name :' line on the acknowledgement page"), `renderSettings.js:58` (`redMin: 0xb0`), `templateDraftService.js:310-318`
- **Excerpt**: `"only RED text and Word REF field values are variable; black text is template wording and is never mapped"`; `throw fail(422, 'No proposal field could be connected to this template, so it was not used.'`
- **Breaks when**: SLT stops marking variable text in red, uses a different colour, or uses content controls: nothing maps, upload rejected. If a new variable part has no schema slot, it stays as printed sample text. This also conflicts with #9: upload fails when nothing can be connected.
- **Should live in**: generic code detects `{tags}` only; the agent (or a one-time auto-tagging step like the planned Solution one) names tags from the sample text. No fixed slot list.

### H6 — Upload rewrites the requirements block into a loop
- **File**: `templateTagWriter.js:117-166`; `fieldSchema.js:127-135` (`ITEM_LOOP`); `renderSettings.js:33`
- **Excerpt**: `const LOOP = ITEM_LOOP.loop; const authorLoop = ...includes(\`{#${LOOP}}\`); const makeLoop = !authorLoop && !!(reqEntry || aloneReq);`
- **Breaks when**: the requirements section is a table, uses different line structure, or has no diagram place: the writer still builds title/description/picture paragraphs from the old sample paragraph's formatting.
- **Should live in**: template author writes loops; code stays out of the template's content.

### H7 — Product editor is fixed to today's template
- **File**: `ProposalAgent.jsx:68` (session must have `requirements` and `investment` arrays), `:168` (`SIDEBAR_OF`), `:854` "Cover & letter (pages 1–3)", `:869` "Your requirements (page 6)", `:898` "About you ... (page 7)", `:927-942` investment inputs (Description, Speed, QoS, One-time, Monthly), `:946,957,971` terms, contact, acknowledgement, `:1033` chips.
- **Breaks when**: a new tag appears (no input to edit it), a section is dropped (input still shown and does nothing), pages move ("page 6" wrong). The Solution editor does not have this problem (`SolutionProposal.jsx` builds inputs from the schema).
- **Should live in**: generic editor built from the template's tags and loop children, as `SolutionProposal.jsx` already does.

### M1 — Whitelisted sample address
- **File**: `renderSettings.js:70-72`; used `templateDraftService.js:202-209,261`
- **Excerpt**: `sampleValuesIgnored: ['No 125, Lotus Road, Colombo 01, Colombo, Western, Sri Lanka, 00100']`
- **Breaks when**: the new template's Word SET sample data differs: upload fails with "Old sample data ... is still printed" (`:261`). The string is content of the current template.
- **Fix**: remove the check or make it a warning.

### M2 — Upload validation is schema-driven
- **File**: `templateDraftService.js:191-200` (`dummyFields()` from `FIELDS`), `:229-259`
- **Excerpt**: `problems.push(\`The "${t.name}" loop did not repeat its rows\`)` (checks `TEST ${b.field}.${stored}1` via bindings)
- **Breaks when**: loops with unknown columns, new loops: unbound loops are skipped, bound loops are checked against schema columns. Requirement #9 (accept even if tags are missing) is met for missing tags, but not for non-matching ones.
- **Fix**: validate only generic things: valid docx, balanced tags, fills with dummy values from the template's own tags (what `solutionTemplateService.js:17-45` does).

### M3 — Terms heading regex
- **File**: `renderSettings.js:91-99`; `templateFormats.js:204-229`
- **Excerpt**: `headingPattern: 'terms\\s+(?:and|&)\\s+conditions'`
- **Breaks when**: heading becomes "General Conditions": formatting not captured, product terms print with default formatting, no error. Also the `{#productTerms}` loop must be hand-written by the author (`fieldSchema.js:73-79`).

### M4 — Bundled default template and Restore Default
- **File**: `templateStoreService.js:14-19,79-94`; `renderSettings.js:14`; `routes/proposals.js:314-322`; `ProposalHub.jsx:176-186`; files `backend/templates/default_proposal_template.docx`, `test-templates/Proposal Format 1 3.docx`, `test-templates/Proposal Format 1 3 - untagged.docx`
- **Excerpt**: `// First run: an empty index gets the default template as version 1, active.` and `const first = store.list().slice().sort((a, b) => a.version - b.version)[0];` (reset = version 1).
- **Breaks when**: the store is empty (new install) or an admin clicks Restore: the app silently uses this year's layout. Normal runs use the uploaded active version (`renderService.js:190`), which is correct.
- **Fix**: no bundled fallback; with no uploaded template, say "upload a template" (the Solution flow already does: `solutionService.js:67`). Keep the test files under `test-templates/` only.

### M5 — System-field resolvers and formats
- **File**: `draftService.js:24-28` (`colomboDate` → `23 OCT 2026`), `:46-59` (`splitAddress`, `localityOf`), `:87-113` (`resolveSource` switch on `company.addressLine1`, `product.ntu`, `catalog.intro1`, ...); `renderSettings.js:19-22`
- **Breaks when**: the new template wants a different date format, a single address line, or other product properties.
- **Fix**: pass raw context (company, rep, products, date ISO) to the agent; let it format per tag, as `Solution` does with `TODAY`.

### M6 — Naming conventions baked in
- **File**: `renderSettings.js:75-84` (`['media','accessMedia']`, `['bandwidth','speed']`, ...), `autoBind.js:21` (`/^toc\d+$/`)
- **Breaks when**: new author naming; unmatched column tags print empty.

### M7 — Spacer cleanup assumptions
- **File**: `templateSpacers.js:22-24,50-52,128`
- **Excerpt**: `// tables that start before the first heading (the cover, the letter) are not touched`
- **Breaks when**: the new template has headings on the cover, or starts with a heading: spacer clean-up may skip or remove the wrong rows. Page layout can shift.

### M8 — Fixed formatting of generated paragraphs
- **File**: `renderSettings.js:36-55`; `ooxml.js:38-98`
- **Excerpt**: `bodyStyle: 'BodyText'`, `captionColor: '0B2A6F'`, `bullet: { symbol: '•', indentLeft: 720, ... }`
- **Breaks when**: the template lacks style `BodyText` (falls back to Normal) or the brand colour changes. Cosmetic to partial.

### M9 — Admin instructions mirror today's schema
- **File**: `ProposalHub.jsx:~690-760` (instruction boxes incl. "insert a borderless 1-row, 2-column table at the top of page 1" and a table of `{companyName}`, `{refNo}`, `{proposalDate}` ...)
- **Breaks when**: the admin follows it for a template with other tags: confusion, and tags are ignored (H1).

### M10 — Mapper prompt
- **File**: `n8n-workflows/Proposal_Template_Mapper.json` → AI Agent system message
- **Excerpt**: "the company name in the letter is companyName, but the 'Company Name :' line of the acknowledgement page is ackCompanyName"
- **Breaks when**: slot list changes. Goes away with H5.

### M11 — Solution agent prompt rules tied to the current template
- **File**: `n8n-workflows/Solution_Proposal_Agent.json` → AI Agent system message (rules in the second half)
- **Excerpt**: "Use the optional-items loop only when the sheet has a SEPARATE optional-items table"; "a loop with a label and a nested list of lines is the terms and conditions"; "A tag that asks for a monthly / recurring charge or a commitment period ... gets 'N/A'"; "gets 'As per the selected option'".
- **Good**: it matches tags by meaning and never by name or page, and does not use fixed sheet cells. 
- **Breaks when**: next year's template has a different set of tables (for example "Warranty" or "Phase 2" loops) or different charge wording: the agent has no rule and falls back to `missing`.
- **Fix**: keep the generic rules (copy, never compute; user details; ref/date); move template-specific rules to a template-level "agent notes" stored with the template version.

### M12 — Solution templates need pre-written tags
- **File**: `solutionTemplateService.js:10-13,26-28`
- **Excerpt**: `// TODO (later, not built): generic red-text auto-tagging.` and `'No {tags} were found in this template, so it was not used.'`
- **Impact**: the admin must edit the Word file and write tags every year. Not hard-coding, but it conflicts with "upload latest template and it works".

### L1 — Old workflow `Proposal Agent.json`
- **File**: `n8n-workflows/Proposal Agent.json` (node "Format Response")
- **Hard-coded**: letter paragraphs ("We understand that every organisation needs to create an edge ...", "We are committed to partnering with you ..."), `solutionTable`, `investment` with `'To be confirmed'`. 
- **Status**: the backend does not call it (`N8N_PROPOSAL_WEBHOOK_URL` appears only in a comment at `draftService.js:16`). Candidate for removal from the repo and from n8n.

### L2–L7
- **L2** Preview chips are a fixed list (`fieldSchema.js:87`) located by field text in the PDF (`renderService.js:233-257`). They hide when not found: graceful.
- **L3** `SLT_Proposal_` file prefix, `Asia/Colombo`, "SLT-MOBITEL" brand in the preview. Env-overridable, cosmetic.
- **L4** HTML preview in the editor shows fixed text: "Dear Sir / Madam", "Proposed Solution", "CUSTOMER COMPANY", "ADDRESSED TO", "National Telecommunications Provider". The real Word/PDF is separate.
- **L5** 21 stored product template versions; `productTerms.test.js` uses the default template. Housekeeping.
- **L6** `{%client_logo}` or picture Alt Text marks the logo. A documented convention, no page or position in code (`logoService.js:4-5`).
- **L7** Five user detail names (`name, phone, email, designation, division`) in `solutionSchemaService.js:10` and the n8n parse node. If a template needs "mobile" or "office address", it is not available.

---

## 4. What is already generic

- **Template storage and versioning**: `templateStoreService.js` stores any `.docx` with an id/version, one active per type (`product`, `solution`), and keeps the original. Each saved proposal records `templateId` and `templateVersion` (`routes/proposals.js:208-214`, `solutionService.js`), so old proposals can still render with the template they were made from.
- **Tag detection**: `templateTagService.js` walks docxtemplater's parsed template: any tag name, text / raw XML / loops with nested children, context text, nearest heading. No names assumed (only filters the logo tag).
- **Solution flow end to end**:
  - `solutionTemplateService.js`: accepts any tags, no required names, checks only that it parses, fills and loops repeat.
  - `solutionSchemaService.js`: builds the schema from the template's own tags; validates the agent's answer against it; drops unknown keys; flags drift.
  - `solutionService.js` + `Solution_Proposal_Agent.json`: sends tag schema + whole sheet grid; agent maps by meaning.
  - `solutionRenderService.js`: renders text / raw XML / loops by type; "no tag name is written here".
  - `SolutionProposal.jsx`: builds the editor from the schema (rows, groups, loops).
- **Excel reading**: `xlsxGridService.js` reports every non-empty cell, merges and display text. No sheet names, cell addresses, column letters or headers in code (checked by search). Only size limits.
- **Generic rendering mechanics**: docxtemplater fill, DOCX → PDF (`pdfService.js`), money formatting at render time, client logo placement driven by the template's marker (`logoService.js`), loop-with-pictures handling, TOC clean-up by field type.
- **Archive, status and versioning**: `proposalStorageService.js`, `proposalDocsService.js`, `proposalVersionService.js`, status panel: no template knowledge.
- **Reference numbers**: built by n8n; `refService.js` only checks general shape (`REF_PATTERN`) and duplicates.
- **`Proposal_Agent_v2.json` (n8n)**: builds its prompt from whatever fields it is sent; no tag or page names in code nodes. The limit is what it is sent (H2).

---

## 5. End-to-end traces

### Product proposal

1. **Admin uploads the template** (Proposal Hub → Upload Latest Template) → `POST /api/proposals/templates/upload` (`proposalTemplates.js:50`) → `templateDraftService.uploadAndActivate`.
   - *Template knowledge enters*: tags are auto-bound by name against `FIELDS` (`autoBind.js`); remaining schema slots + an outline of the document go to the n8n **Template Mapper** (`templateMappingService.js:29`), which looks for **red** sample text; `templateTagWriter` writes tags into a copy and rewrites the requirements block into a loop (H5, H6); `validate` fills it with schema dummy data (M2); stored as the active version (`templateStoreService.addTagged`).
2. **Rep builds a proposal** (search business → pick products → `ProposalAgent`) → `POST /api/proposals/generate` (`routes/proposals.js:202`) → `draftService.generate`.
   - *Template knowledge enters*: the payload lists only the schema's AI fields (H2); n8n `proposal-v2` returns values plus a reference number built from the user's section; the backend then fills every other field from `resolveSource` and the catalogue (M5, H3). The active template is not read at this step except to record its id/version.
3. **Rep edits** in `ProposalAgent.jsx`.
   - *Template knowledge enters*: fixed sections, inputs and page numbers (H7); fixed HTML preview (L4).
4. **Export** → `POST /api/proposals/export` (`proposals.js:249`) → `renderService.render` → reads the stored template version → `buildData` per tag using its `bindings` (unbound tag → empty, H1) → composed blocks and wording (H4) → docxtemplater → `.docx`, or PDF via `pdfService`.
   - Preview chips computed from field text found in the PDF (L2).
5. **Archive**: `saveProposal` at generate time with fields, `templateId`, `templateVersion`; status/versions/documents via `proposalDocsService` / `proposalVersionService`. No template knowledge.

### Solution proposal

1. **Admin uploads a solution template** (type = solution) → `solutionTemplateService.uploadAndActivate`.
   - *Template knowledge*: none in code, but the author must have pre-written the tags (M12). Checked with dummy values from the template's own tags.
2. **Rep uploads the quotation Excel** → `POST /api/proposals/solution/upload` → stored pending; sheet names listed (`xlsxGridService.listSheets`).
3. **Rep picks a sheet → Generate** → `POST /api/proposals/solution/extract` → `solutionService.extract`.
   - Grid built from the sheet (generic); tag schema built from the active template (`solutionSchemaService.agentSchema`); `refRequest` (type, section, sub-section) added; sent to n8n `proposal-solution` (3 parallel runs, voted).
   - *Template knowledge enters*: only inside the agent prompt (M11), and via the tags it receives. Account-manager tags are filled by the backend from the user's record (`userSource`, L7).
4. **Rep reviews** in `SolutionProposal.jsx`: editor is built from the schema (generic). Save → `PUT /:refNo/fields`.
5. **Export** → `POST /api/proposals/solution/export` → `solutionRenderService.render` → docxtemplater with values for whichever tags exist → `.docx` / PDF.
6. **Archive**: `saveProposal` with `proposalType: 'solution'`, source Excel stored with the proposal; regenerate re-runs the agent on the stored Excel (generic).

---

## 6. Recommended changes (prioritised, for approval — nothing has been changed)

**Priority 1 — make the Product flow work like the Solution flow (removes H1-H4, H6, M2, M5, M6, M10)**
1. Send the active product template's tags (names, types, context, loop children) plus company, products, catalogue, rep, date to n8n. The agent returns a value for every tag. Reuse the Solution payload shape.
2. Replace `FIELDS` / `BLOCK_SLOTS` / `autoBind` / `composeBlocks` / `resolveSource` with generic code that maps returned values to tags by name (the way `solutionSchemaService` + `solutionRenderService` already do). Keep generic mechanics only: money format, raw-XML paragraph conversion, loop filling, logo and diagram insertion.
3. Build the Product editor from the schema like `SolutionProposal.jsx` (removes H7, L4).
4. Move wording and structure rules (numbered titles, high-priority suffix, "N/A", date format, address lines) into the n8n prompt.

**Priority 2 — remove upload assumptions (H5, M1, M3, M12)**
5. Upload accepts any `.docx`: store, detect tags, warn (do not reject) about leftovers. Drop `sampleValuesIgnored`, the red-text slot mapper and the requirements-loop rewrite for Product.
6. If red-text auto-tagging is still wanted, make it one generic step for both types (as the Solution TODO describes): the agent names tags from the sample text; no fixed slot list.
7. Make the terms-heading and column-synonym lists optional or remove them.

**Priority 3 — remove fallbacks and leftovers (M4, L1, L5, M9)**
8. Remove the bundled default template from the fallback and "Restore Default" path; with no template, show "upload a template" (as Solution does). Keep `test-templates/` for tests only.
9. Delete `n8n-workflows/Proposal Agent.json` (old, unused, hard-coded letter text) and the `N8N_PROPOSAL_WEBHOOK_URL` comment.
10. Replace the hard-coded tag table and page-1 instructions in `ProposalHub.jsx` with a live list of the active template's tags.
11. Prune old stored template versions as housekeeping.

**Priority 4 — prompts and polish (M11, M7, M8, L2, L3, L7)**
12. Split the Solution prompt into generic rules (kept) and template-specific notes stored with each template version (so a new template can carry its own "optional items" or "charge" rules).
13. Review spacer clean-up and generated formatting constants against two different templates; read style names and colours from the template where possible.
14. Let `userSource` accept any user profile field; keep chips and branding as config.
