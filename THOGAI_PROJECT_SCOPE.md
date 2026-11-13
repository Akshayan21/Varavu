# THOGAI (தொகை) — Project Scope

**Product:** Multi-Entity Garment Printing Billing & Delivery Challan System  
**Document type:** Final simplified product requirements and implementation scope  
**Version:** 2.0 — 7 November 2026  
**Platform:** Private, responsive web application  
**Primary user:** Business owner / authorized operator  
**Initial setup:** Two business entities, with unlimited additional entities supported by design  
**Technology:** React + Vite + TypeScript · shadcn/ui · Tailwind CSS · Node.js + Fastify · Supabase

---

## 1. Product objective

Thogai is a **billing-first system for a garment-printing business**. The owner signs in once, chooses a company (called an *entity*), and uses the same screens and workflows for that company. Each entity's customers, bills, delivery challans, receipts, numbering, templates and reports remain separate. A **centralized dashboard** provides authorized, read-only consolidated visibility across every entity.

The product deliberately **does not include** quotations, production job cards, garment stock, purchasing, warehouse management, artwork approvals, employee attendance, or full accounting. A bill can describe production/printing work without introducing those extra modules.

### Core outcomes

1. Create, manage, switch between, and archive multiple entities.
2. Create garment-printing bills using each entity's own invoice template.
3. Create delivery challans (DCs) and optionally link them to bills.
4. Cancel issued bills without deleting the record or **ever reusing its invoice number**.
5. Record payments against bills to calculate paid, outstanding and overdue amounts.
6. See detailed dashboards within each entity and consolidated analytics across all entities.
7. Generate downloadable PDFs and browser-printable bills, challans and reports.

## 2. Application flow and navigation

```text
Login
  |
  v
Entity Selection  <---->  Create / Edit / Archive Entity
  |
  +---- Select Entity A --> Entity A Dashboard
  |                             |
  |                             +-- Bills / Invoices
  |                             +-- Delivery Challans
  |                             +-- Customers
  |                             +-- Reports
  |                             +-- Entity Settings / Invoice Template
  |
  +---- Select Entity B --> Entity B Dashboard (identical modules, different data)
  |
  +---- Select Entity N --> Entity N Dashboard (same modules)
  |
  +---- Central Dashboard --> Combined Analytics / Consolidated Reports

Always visible in app header: [Current Entity ▼] [Central Dashboard] [Profile]
```

**Navigation rule:** The first screen after successful login is the entity selector. The system remembers the most recently used entity only as a convenience; it must not silently skip the selector on the first login unless the owner later opts in.

**Entity isolation:** Selecting a company changes the complete data context for every module. Bills created for Entity A cannot appear in Entity B's bill list, and Entity B's template cannot be applied to Entity A's invoice. The central dashboard is a special combined, primarily read-only view.

### Shared navigation for every entity

- **Dashboard** — Entity-specific financial and operating summary.
- **Billing** — Bill list, create/edit drafts, issue, view, cancel, PDF, print and payment recording.
- **Delivery Challans** — DC list, create, view, optional linkage to bill, PDF and print.
- **Customers** — Customer details and customer-wise billing history.
- **Reports** — Filterable report catalogue and exports.
- **Settings** — Company identity, numbering, bank details and invoice/DC templates.

Global navigation: **Entity Switcher**, **Central Dashboard**, **Manage Entities**, **Logout**.

## 3. Entity management

An entity represents one independent company / billing identity, not a user account.

**Fields:** entity name, legal/billing name, logo, business address, contact number, email, optional GSTIN, optional PAN, invoice prefix, DC prefix, financial-year numbering preference, bank name, account holder, account number, IFSC, optional UPI ID, payment terms, default tax settings, invoice template settings, DC template settings, active/archived state.

**Actions:** create, view, edit, activate, archive, select and switch entities. Archiving hides an entity from ordinary active selection but preserves all its past financial and delivery records. Deleting an entity with issued documents is not allowed in the MVP.

**Template separation:** All entities use the *same billing module and editor*, but the header, logo, seller information, styles/colors and bank/payment footer are loaded from that entity's template.

## 4. Billing / invoice module

### 4.1 Bill list

Show searchable, sortable, paginated records with **Invoice No., Date, Billed To, Total Amount, Amount Received, Outstanding, Document Status and Payment Status**. Include filters for date range, customer, document status, payment status and overdue. Actions: **View, Download PDF, Print, Duplicate as New Draft, Cancel** (permission- and status-dependent).

### 4.2 Bill form — based on the handwritten reference

| Section | Field | Behavior |
|---|---|---|
| Seller | Selected entity | Read-only from current entity; captured in issued invoice snapshot |
| Header | **Billed To** | Select/create an entity-specific customer with billing address |
| Header | **Bill Date** | Date picker, default today |
| Header | **Bill ID / Bill Number** | Server-assigned when issued; visible in issued view |
| Line items | **S. No.** | Automatic sequential row number |
| Line items | **Service / Style Code** | Free text; may describe service, garment style or internal code |
| Line items | **Print Type** | DTF, Sublimation, Heat Transfer, Puff, Plastisol, HD, Screen Printing, Other |
| Line items | **Placement** | Front, Back, Left Chest, Right Chest, Sleeve, Neck, Other; editable description |
| Line items | **Production / Particulars** | Description/reference of the work; not a production tracking module |
| Line items | **Quantity (pcs)** | Positive numeric quantity |
| Line items | **Rate per Piece (₹)** | Decimal amount |
| Line items | **Line Amount (₹)** | Calculated: quantity × rate, with optional explicit adjustment |
| Summary | Subtotal, optional discount, optional tax, grand total | Auto calculated and validated on backend |
| Footer | Bank details, payment terms, notes | Pre-fill from entity, snapshot on issue |

**Print-type handling:** The method list is configurable per entity. A bill may contain multiple items with different print types, styles and placements. Size breakdowns and job-card production details are intentionally **not required** in V1.

**Bill creation flow:**

1. Open **Billing → Create Bill** within an entity.
2. Select the customer and date.
3. Add one or more garment-printing particulars and rates.
4. Preview the invoice with that entity's template.
5. Save Draft or **Issue Bill**.
6. On issue, the server validates totals, allocates a unique invoice number, freezes the snapshot and stores the issued document.
7. Download PDF, print, or later record receipts against the bill.

**Drafts** may be edited and deleted while unnumbered. **Issued bills** must not be silently edited; correction requires cancellation and creation of a replacement bill (with a *new* number). The invoice view can show an optional `replacement_for_invoice_id` reference.

### 4.3 Invoice numbering and permanent cancellation

Suggested independent sequences:

- Entity A: `A/26-27/0001`, `A/26-27/0002`, ...
- Entity B: `B/26-27/0001`, `B/26-27/0002`, ...
- Entity N: its own configured prefix and sequence.

**Mandatory business rules:**

- Number is allocated **only on issue**, in a database transaction, never on initial draft creation.
- A number is unique for its entity and numbering period and **never used again**, even if the bill is cancelled, voided or replaced.
- Cancelled bills are **not deleted**. Preserve bill number, full snapshot, issue date, cancellation timestamp, reason, cancelling user and audit trail.
- Cancelled documents visibly display a **CANCELLED** watermark/status and are unavailable for ordinary editing.
- A cancelled bill is excluded from active billed/receivable totals, but is included in a dedicated cancellation report. Historical reporting can show gross issued and cancelled values separately.
- Cancellation must require confirmation and a reason. If payments exist, the UI must require those payments to be reversed/reallocated first or handled through a controlled adjustment flow; no negative or orphaned balances.
- The sequence counter never decrements. Database unique constraints and transactional locking protect against simultaneous requests.

**Example:** `A/26-27/0005` is cancelled. The next bill is `A/26-27/0006`, **not** `A/26-27/0005`.

### 4.4 Payment recording (inside Billing, not a separate complex module)

An issued, non-cancelled bill can have one or more receipts. Record: amount, date, method (cash/bank transfer/UPI/cheque/other), optional reference number, and notes. Show payment history on the bill view.

- **Outstanding = active invoice payable total − valid receipts allocated to that invoice.**
- **Payment status:** Unpaid / Partially Paid / Paid.
- **Overdue:** the unpaid balance of active invoices whose due date has passed.
- Prevent receipts above the payable balance unless a specifically implemented credit/refund workflow exists (not required in V1).

## 5. Delivery Challan (DC) module

### 5.1 Delivery Challan form — based on the handwritten reference

| Section | Field | Behavior |
|---|---|---|
| Header | **From Address** | Pre-fill from selected entity, editable/snapshotted |
| Header | **To Address** | Pre-fill from selected customer, editable/snapshotted |
| Header | **DC Date** | Date picker |
| Header | **DC Number** | Unique server-issued entity-specific number |
| Table | **S. No.** | Automatic row sequence |
| Table | **Particulars** | Garment / printing material or delivered item description |
| Table | **Quantity** | Quantity delivered |
| Table | **Unit** | pcs, bundles or configurable unit |
| Table | **Remarks** | Optional condition/description |
| Footer | Received by / signature / notes | Optional fields and print layout |
| Link | Related Bill | Optional; may select an invoice from the **same entity** |

**DC workflow:** Create Draft → Add delivery particulars → Preview → Issue → Download PDF / Print. All items and issued document data must be stored persistently.

DC numbering uses an independent sequence (for example `A/DC/26-27/0001`) and follows the same non-reuse rule for issued documents. A DC can be issued without an invoice; it is a delivery document rather than a financial invoice. Linked DCs help the owner find deliveries from a bill or customer profile without requiring warehouse/dispatch workflows.

## 6. Entity dashboard (same layout for every entity)

Show the following KPI cards for the active entity and selected reporting period:

1. **Total Billing** — total payable value of active issued bills in period.
2. **Amount Collected** — valid receipts posted in period.
3. **Outstanding Amount** — unpaid balance across all active bills, as of selected date.
4. **Overdue Amount** — past-due portion of outstanding.
5. **Total Issued Bills** — non-cancelled issued count for period.
6. **Cancelled Bills** — separate count/value for period.
7. **Total Delivery Challans** — issued DC count for period.

**Visual analytics:** Monthly billed vs collected chart, outstanding aging (0–30, 31–60, 61–90, 90+ days), top customers by billed amount, billing by print type, paid/unpaid status distribution, recent bills and recent DCs. Support month, quarter, financial year and custom date filters.

**Customer-wise analytics:** Customer name, total billed, collected, outstanding, most recent invoice, number of invoices and monthly trend.

## 7. Centralized dashboard — all entities

Accessible from the entity selector and application header. It is the consolidated view, not a separate billing identity.

**Summary metrics:** All-entity billed total, collections, outstanding, overdue, total invoices, total DCs and cancellations, with selectable date ranges.

**Comparisons:**

- Entity-wise billing, collections and outstanding in a table and bar chart.
- Monthly trends per entity and for all entities combined.
- Top billed customers (display entity name alongside customer, because customer records are entity-specific).
- Customer concentration and print-type breakdown by entity.
- Cancellation trend and overdue aging by entity.

**Controls:** All Entities / selected entities, period selector, date range, and drilldown to an individual entity dashboard. Combined analytics use permitted cross-entity aggregates only; creating or changing a bill always requires an explicitly selected entity.

**Analytics definitions:** Billing figures default to issued, non-cancelled invoices dated within the period. Collections are payments received within the period (not necessarily for bills issued in that period). Outstanding and overdue are **balances as of a selected date**, not simply invoices from that period. Clearly label these differing bases. Use consistent tax-inclusive or tax-exclusive labels in every report.

## 8. Reports and exports

One **Reports** module, same layout for each entity, and a consolidated Reports view from the central dashboard.

| Report | Key content | Filters |
|---|---|---|
| Billing Register | Invoice no., date, customer, total, status | Entity, period, customer |
| Collection Register | Receipt date, invoice, customer, amount, mode | Entity, period |
| Outstanding Report | Invoice, customer, due date, open balance | Entity, customer, aging |
| Customer-wise Billing | Invoice counts, billed, collected, outstanding | Entity, date range |
| Monthly Billing Trend | Month totals and growth | Entity, financial year |
| Print-Type Billing | DTF / Sublimation / Puff / etc. amounts and quantities | Entity, date range |
| Delivery Challan Register | DC no., date, recipient, particulars summary, quantities | Entity, period, customer |
| Cancelled Invoice Register | Number, original amount, cancelled date, reason | Entity, period |
| Entity Comparison | Side-by-side company KPIs | Selected entities, period |

**Report features:** On-screen filterable table, totals, print-friendly report page, **Download PDF**, **Print** via browser dialog, and optional CSV download for spreadsheets. Export files include report title, filters, generation date and the appropriate entity name(s). PDFs are generated server-side for consistent layout.

## 9. Screen inventory and UX requirements

| Screen | Contents / key actions |
|---|---|
| 1. Login | Email/password login; private access |
| 2. Entity Selector | Entity cards; Open; Create Entity; Manage; Central Dashboard |
| 3. Entity Dashboard | Financial cards, charts, recent records and entity switcher |
| 4. Billing List | Search, filters, status, create, view, print, download, cancel |
| 5. Bill Editor | Customer, item grid, garment print details, auto totals, save draft, preview, issue |
| 6. Bill Detail | Snapshot, PDF/print, receipts, cancel action, cancellation history |
| 7. DC List | Search/filter, create, view, download, print |
| 8. DC Editor / Detail | From/To, number, particulars, qty, optional bill link, PDF/print |
| 9. Customers | Per-entity directory and billing details |
| 10. Reports | Select report, filter, view, PDF/print/export |
| 11. Central Dashboard | Consolidated KPIs, entity comparisons and charts |
| 12. Entity Management / Settings | Add/edit/archive entities, prefixes, bank info, templates |

**Layout:** Desktop-first sidebar; top header with **Entity Switcher** and **Central Dashboard** shortcut; responsive mobile drawer. Neutral background, shadcn/ui data tables, searchable customer selectors, calendar date controls, modal cancellation confirmation, and a live A4 invoice/DC preview. Keep **Create Bill** prominent on the entity dashboard.

**Operational UX rules:** Show selected entity name/logo on all document creation and preview screens; confirmation before issuance or cancellation; visible status chips; clear validation and empty states; no cross-entity data leaking during switching (clear stale cached state or key queries by `entityId`).

## 10. Data model (focused, minimal)

| Table | Essential fields |
|---|---|
| `workspaces` | id, owner_user_id, name |
| `entities` | id, workspace_id, name, identity/contact/tax/bank fields, invoice_prefix, dc_prefix, active |
| `customers` | id, entity_id, name, address, phone, email, optional GSTIN |
| `document_templates` | id, entity_id, document_type, version, settings_json, is_default |
| `document_sequences` | entity_id, document_type, financial_year, next_number; unique combination |
| `invoices` | id, entity_id, customer_id, invoice_number, status, issue_date, due_date, subtotal, tax, total, snapshots_json, template_version, pdf_path, cancel_reason, cancelled_at |
| `invoice_items` | id, invoice_id, sort_order, style_code, print_type, placement, particulars, quantity, rate, amount |
| `payments` | id, invoice_id, entity_id, amount, paid_at, method, reference, notes, reversed_at |
| `delivery_challans` | id, entity_id, customer_id, dc_number, status, dc_date, from_snapshot, to_snapshot, related_invoice_id, pdf_path |
| `dc_items` | id, dc_id, sort_order, particulars, quantity, unit, remarks |
| `audit_logs` | id, entity_id, actor_id, action, resource_type, resource_id, metadata, created_at |

**Isolation:** Every customer, invoice, challan and payment belongs to exactly one entity. The selected entity is a required scope on all operational queries. The workspace owner may read combined authorized data for analytics.

**Integrity:** Store monetary values as PostgreSQL `NUMERIC`, calculate totals on the backend, enforce unique issued invoice/DC numbers, foreign-key entity consistency and transaction-safe number allocation. Preserve seller, customer and template snapshots for issued documents. Do not cascade-delete issued financial documents.

## 11. API outline (Node.js + Fastify)

```text
POST   /api/auth/session                         # Verify active user session
GET    /api/entities
POST   /api/entities
PATCH  /api/entities/:entityId
POST   /api/entities/:entityId/archive

GET    /api/entities/:entityId/dashboard
GET    /api/entities/:entityId/customers
POST   /api/entities/:entityId/customers
PATCH  /api/entities/:entityId/customers/:customerId

GET    /api/entities/:entityId/invoices
POST   /api/entities/:entityId/invoices            # Create draft
PATCH  /api/entities/:entityId/invoices/:invoiceId # Edit draft only
POST   /api/entities/:entityId/invoices/:invoiceId/issue
POST   /api/entities/:entityId/invoices/:invoiceId/cancel
GET    /api/entities/:entityId/invoices/:invoiceId/pdf
POST   /api/entities/:entityId/invoices/:invoiceId/payments

GET    /api/entities/:entityId/challans
POST   /api/entities/:entityId/challans
POST   /api/entities/:entityId/challans/:dcId/issue
GET    /api/entities/:entityId/challans/:dcId/pdf

GET    /api/entities/:entityId/reports/:reportType
GET    /api/entities/:entityId/reports/:reportType/pdf
GET    /api/analytics/central
GET    /api/reports/central/:reportType
GET    /api/reports/central/:reportType/pdf
```

All endpoints require authenticated workspace membership and server-side entity authorization. PDF render/generation requests should be idempotent and should not issue another bill. Document-number allocation and issuance belong together in a single transaction.

## 12. Technology and code organization

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| Components | shadcn/ui |
| Styling | Tailwind CSS |
| Routing | React Router |
| Forms | React Hook Form + Zod |
| Data and caching | TanStack Query + TanStack Table |
| Charts | Recharts |
| Backend | Node.js + Fastify + TypeScript |
| Database | Supabase PostgreSQL |
| Authentication | Supabase Auth |
| File storage | Private Supabase Storage bucket for logos and PDFs |
| PDF / print rendering | Server-rendered HTML + Playwright PDF; CSS print media |
| Tests | Vitest, API integration tests and Playwright E2E |

```text
thogai/
  apps/
    web/src/
      app/                  # Providers, router, app shell
      features/
        auth/
        entity-selection/
        dashboard/
        billing/
        delivery-challans/
        customers/
        reports/
        central-dashboard/
        settings/
      components/ui/        # shadcn/ui
    api/src/
      modules/
        entities/
        customers/
        invoices/
        payments/
        challans/
        dashboard/
        reports/
      services/pdf/
      middleware/auth/
  packages/shared/         # Types and validation schemas
  supabase/migrations/
  tests/e2e/
  docs/
  README.md
```

## 13. Security, reliability and compliance considerations

- Private login with Supabase Auth; do not allow uncontrolled public registration.
- Enforce Row Level Security and backend authorization; never expose service-role credentials to the browser.
- Server controls invoice totals, number issuance, cancellation and payment validation.
- Preserve signed-off documents and an immutable record of cancellation events.
- Store PDFs privately and authorize all retrieval/downloads.
- Use transactional writes, retry-safe PDF generation and tested database backups.
- Support optional GSTIN and configurable tax fields, but validate statutory invoice requirements for each actual business before issuing legally binding tax invoices.

## 14. Development order

**Phase 1 — Foundation and entities**  
Project setup, Supabase Auth, entity creation/selection/switching, protected app shell and per-entity settings.

**Phase 2 — Billing**  
Customers, editable bill template per entity, bill editor, invoice calculations, draft/issue flow, atomic numbering, cancellation/no-reuse, PDF and print.

**Phase 3 — Delivery challans**  
DC editor, number generation, particulars, optional bill link, history, PDF and print.

**Phase 4 — Payments and dashboards**  
Receipt recording, outstanding and overdue, per-entity dashboard and visual analytics.

**Phase 5 — Central dashboard and reports**  
All-entity comparative analytics, report filtering, PDF generation, print and export.

**Phase 6 — Release checks**  
Security, cross-entity isolation, concurrency, cancellations, calculations, templates, responsive design and deployment.

## 15. Acceptance criteria / definition of done

- [ ] Login leads to the entity selector.
- [ ] Owner can create, edit, select and switch any number of entities.
- [ ] Every entity displays identical modules but only its own operational records.
- [ ] Every entity can have a distinct invoice logo, header, numbering and bank footer.
- [ ] Bill form includes billed to, date, bill number, S.No., service/style code, print type, placement, production particulars, quantity, per-piece rate and amount.
- [ ] Multiple bill line items calculate correctly and produce A4 PDF and print output.
- [ ] Cancelling bill `...0005` permanently reserves its number; next issued bill gets `...0006`.
- [ ] Cancelled bill remains searchable with reason, timestamp and cancelled PDF view.
- [ ] Payments correctly calculate unpaid, partial, paid, outstanding and overdue values.
- [ ] DC includes from/to address, date, unique DC number, S.No., particulars and quantity.
- [ ] DC records can optionally link to a bill within the same entity.
- [ ] Entity dashboards show billing, collections, outstanding, overdue, trend charts and customer insights.
- [ ] Central dashboard combines data from all authorized entities without mixing their document records.
- [ ] Reports can be filtered, downloaded as PDF and printed.
- [ ] Entity switching never shows stale records from a different entity.
- [ ] All issued documents are stored securely; backups and recovery have been tested.

## 16. Explicitly out of scope for this version

Quotation and enquiry management; garment stock/inventory; production job cards; artwork approval workflow; purchase orders; fabric/size-wise stock matrices; warehouse/dispatch management; payroll; full GST filing; bank synchronization; payment gateway; multi-employee role systems; complex accounting journal entries.

---

**Final product definition:** A straightforward **multi-entity garment-printing billing and delivery challan application** with separate operational data, permanent invoice-number history, entity-specific document templates, strong analytics and consolidated reports — using the agreed React/Vite, shadcn/ui, Tailwind, Supabase and Node.js stack.
