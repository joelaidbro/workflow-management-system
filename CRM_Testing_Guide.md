# CRM Feature — Testing Guide

Test in this order — later sections assume earlier setup exists (a lead status, a lead source, an item, etc.).

## 0. One-time setup before any testing

1. **Run the migration.** In `backend/`: `alembic upgrade head`. Confirm it applies `q7e8f9a0b1c2_add_crm_tables` with no errors.
2. **Set a Sales department on your test users.** Open Staff Management → edit a staff member and an admin (if you have one) → set Department to exactly `Sales` (case doesn't matter, but it must be that word, not "Sales Team" or similar).
3. Log in as **super_admin** — you should immediately see a **CRM** nav item (super_admin always sees it, no department needed).
4. Log in as the **admin** and **staff** accounts you tagged as Sales — they should also now see **CRM** in their nav. A staff/admin account *without* Sales department should **not** see it at all.

Expected result: three roles (super_admin, Sales-admin, Sales-staff) can open the CRM panel; a non-Sales staff/admin cannot.

---

## 1. Settings tab — master data

Do this first; nothing else works without it.

| Step | Action | Expected result |
|---|---|---|
| 1.1 | As super_admin, open CRM → Settings | Four cards: Lead Sources, Lead Statuses, Item Categories, Items — all empty initially |
| 1.2 | Add a Lead Source, e.g. "Website" | Appears in the list immediately |
| 1.3 | Add a Lead Status "New Enquiry" with nature **New** | Appears in the list, tagged "(New)" |
| 1.4 | Add 2–3 more statuses, e.g. "Contacted" (In Follow Up), "Deal Won" (Won), "Not Interested" (Lost) | All appear correctly tagged |
| 1.5 | Try deleting a Lead Status that's not yet used by any lead | Succeeds |
| 1.6 | Add an Item Category, e.g. "Services" | Appears in the list |
| 1.7 | Add an Item, e.g. "Consulting" with category "Services" and default rate 5000 | Appears showing category + rate |
| 1.8 | Log in as a **Sales-department staff** (not admin) and open Settings | Can see all four lists, but **no Delete buttons and no add-forms visible** (read-only) |
| 1.9 | Log in as a **Sales-department admin** | Can see delete buttons and add-forms (same as super_admin) |
| 1.10 | Try deleting a Lead Status that IS in use by a lead (do this after section 2) | Should fail with "This status is in use by existing leads and can't be removed" |

If step 1.3 is skipped, the CRM panel should show an amber warning banner: *"No lead status is configured with the 'New' stage yet..."* — verify that banner appears before you add one, and disappears after.

---

## 2. Leads tab — enquiry creation & pipeline

| Step | Action | Expected result |
|---|---|---|
| 2.1 | Click "Create Enquiry", fill customer name + phone (required), leave rest optional, submit | Toast "Enquiry created"; new lead appears in the list under the **New** tab with number `ENQ-0001` |
| 2.2 | Create a second enquiry | Gets `ENQ-0002` — confirms auto-numbering increments correctly and doesn't collide |
| 2.3 | Try submitting with empty customer name or phone | Blocked client-side with a toast, no request sent |
| 2.4 | Click a lead row | Detail modal opens showing all fields + an empty Followup History |
| 2.5 | Edit the customer's place/business value/quality in the modal, Save | Toast "Lead updated"; reopen the lead — changes persisted |
| 2.6 | In the Status section, change status to "Contacted" (In Follow Up nature), click Update Status | Toast "Status updated"; lead now shows under the **In Follow Up** tab, not New |
| 2.7 | Change status to a **Lost**-nature status without typing a reason | Blocked with "Enter a reason for marking this lead lost" |
| 2.8 | Change status to Lost with a reason filled in | Succeeds; lead moves to the **Lost** tab; reopening shows the lead is marked lost (check via API response `lost_reason`/`lost_at` if you want to confirm in DB) |
| 2.9 | Change status to a **Won**-nature status | Lead moves to **Won** tab; `won_at` gets set, any previous lost_reason clears |
| 2.10 | In the "Log a Followup" box, add a note + a next followup date, click Log Followup | Toast "Followup logged"; entry appears at the top of Followup History with your note and the status name at the time |
| 2.11 | Search leads by partial customer name, phone, or ENQ number in the search box | Only matching leads show |
| 2.12 | Filter using the stage tabs (New / In Follow Up / Won / Lost / All) | List updates correctly per tab |
| 2.13 | Create enough leads to exceed one page (25 by default) | Pagination controls (Prev/Next, "Page X of Y") appear and work |

---

## 3. Followups tab — bucketed view

| Step | Action | Expected result |
|---|---|---|
| 3.1 | Log a followup on a lead with next-followup-date set to **yesterday** | Under Followups tab → **Delayed** bucket, that lead appears |
| 3.2 | Log a followup with next-followup-date set to **today** | Appears under **Today** |
| 3.3 | Log a followup with a date a few days in the future | Appears under **Upcoming** |
| 3.4 | A lead with no next-followup-date set at all | Appears under **No date set** |
| 3.5 | Switch between the four bucket tabs | List refreshes correctly for each, no stale data from the previous bucket |

---

## 4. Quotations tab

| Step | Action | Expected result |
|---|---|---|
| 4.1 | From a lead's detail modal, click "Create Quotation" | Switches to Quotations tab, modal opens pre-filled with "For lead: <name> (<number>)" |
| 4.2 | Opening "Create Quotation" directly from the Quotations tab (not via a lead) | Shows an amber note telling you to open it from a lead instead — this is expected, since a quotation must always be tied to a lead |
| 4.3 | Add one line item using the "Custom item…" dropdown left as-is, type a name, rate, qty | Live total preview at the bottom updates as you type |
| 4.4 | Add a second line by selecting one of your Settings-tab Items from the dropdown | Rate auto-fills from the item's default rate; item_name field becomes disabled (locked to the item's name) |
| 4.5 | Set a tax % on one line | Preview's Tax figure increases accordingly |
| 4.6 | Set a Discount % of e.g. 10 | Preview's Discount and Payable figures adjust |
| 4.7 | Switch discount type to "flat" and enter a flat amount | Payable recalculates using the flat amount instead of a percentage |
| 4.8 | Remove a line item using the ✕ button | Preview recalculates without that line |
| 4.9 | Submit with zero line items (remove all) | Blocked: "Add at least one line item" |
| 4.10 | Submit a line with rate left blank | Blocked: "Every line item needs a valid rate" |
| 4.11 | Submit successfully | Toast "Quotation created"; appears in the Quotations list with a `QUO-0001` number and the correct total payable |
| 4.12 | Click the quotation row to reopen it | All fields and line items reload exactly as saved |
| 4.13 | Edit an existing quotation — change a rate or add a line, save | Toast "Quotation updated"; totals recalculate correctly, confirm by reopening |
| 4.14 | **Verify server-side trust**: open browser DevTools, intercept the create-quotation request, and try changing the JSON's line item rate or a total field before it's sent (or just confirm by reading the code) | The `gross_total`/`tax_total`/`total_payable` fields are never read from the request — only `rate`/`qty`/`tax_percent` per line are used; the response always reflects the server's own computed totals regardless of what the client sent |
| 4.15 | As a plain Sales-department **staff** user, create a quotation | No "Sales executive" dropdown shown (by design — only admin/super_admin can assign an executive) |
| 4.16 | As an **admin/super_admin**, create a quotation | "Sales executive" dropdown appears, populated from Sales-department users |

---

## 5. Bulk tab — Task Assignment & Lead Transfer

This tab requires **admin or super_admin** (plain sales staff should not see meaningful access — see 5.5).

| Step | Action | Expected result |
|---|---|---|
| 5.1 | Open Bulk tab, leave all filters blank, click "Preview Matching Leads" | Shows every lead in the company with a count |
| 5.2 | Set the Stage filter to "New" and preview again | Only New-stage leads shown |
| 5.3 | Combine filters (e.g. stage + lead source + quality) | Only leads matching **all** selected filters appear |
| 5.4 | Pick a target staff member, click "Assign" | Toast with count of leads assigned; reopen one of those leads — `assigned_to` is now the target user; **no** new followup note was added (this is the "quiet" bulk-assign path) |
| 5.5 | Switch to "Lead Transfer" mode, filter, preview, pick a target, click "Transfer" | Toast with count; reopen one affected lead — assignment changed **and** a new Followup History entry appears reading "Lead transferred from X to Y" |
| 5.6 | Click "Assign"/"Transfer" without previewing first | Blocked: "Preview the filter first — nothing to act on" |
| 5.7 | Preview, then change a filter without re-previewing, then click Assign | Should act on the **stale preview's filters** only if you didn't re-preview — verify the count shown matches what's about to be applied; if this feels surprising, note it for a possible improvement (re-preview should probably be forced after any filter change) |
| 5.8 | Attempt this whole tab as a plain Sales-department staff account (call the API directly, or temporarily check the button states) | Backend should reject with 403 — the frontend `/api/users/list` call may itself fail for staff (it requires admin), which will surface as a toast error loading the staff dropdown |

---

## 6. Cross-cutting / access control checks

| Step | Action | Expected result |
|---|---|---|
| 6.1 | Log in as a staff/admin with department **not** "Sales" (e.g. blank, or "Support") | No CRM nav item anywhere |
| 6.2 | Call a CRM API endpoint directly (e.g. `GET /api/crm/leads`) as that non-Sales user, using browser dev tools or curl with their token | 403 Forbidden |
| 6.3 | As Sales-department plain staff, try to add/delete a Lead Source via direct API call (not through UI, since UI hides the button) | 403 Forbidden — `require_crm_manage` blocks non-admin roles even within Sales |
| 6.4 | Confirm company isolation: create leads in two different companies (if you have multiple companies set up), log in as each | Each company only ever sees its own leads/quotations/settings — never the other company's data |

---

## 7. Known limitations to be aware of while testing (not bugs)

- Bulk tab currently has no confirmation dialog before Assign/Transfer executes — double-check your filters before clicking.
- The Followups tab list is view-only; you can't log a followup directly from there (go to the Leads tab and open the lead instead).
- WhatsApp lead auto-capture is **not** part of this build — that's still pending your team's input on the in-house WhatsApp tool.
- No CRM reporting/dashboard/charts yet (e.g. conversion rate, leaderboard) — only the raw list/detail views described above.

---

Report back anything that doesn't match the "Expected result" column and I'll dig into it.
