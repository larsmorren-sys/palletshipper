# Palletshipper

A shipment and pallet management application built with React, Vite, Tailwind CSS, Node.js and Express. Each shipment contains transport units (pallets, cases, suitcases or a specified Other type) and individual equipment items. Items and pallets have independent tracking for **Out warehouse**, **In location**, **Out location** and **In warehouse**.

## Start here: new installation

Each installation has its own database, users and optional route-service key. This repository contains application code only: it does not include the original installation's accounts, shipments, photos, API key or setup code. A fresh installation starts empty. You do not need a route-service account to use shipments, tracking, challenges or manually entered distances.

You need **Node.js 24.22.1 or a newer patched Node.js 24 release**, npm (included with Node.js), and Git if you want to clone the repository. Check your version with `node --version`. The `.nvmrc` and `.node-version` files select 24.22.1; with nvm, run `nvm install` followed by `nvm use` before installing dependencies. The Railway Docker image is pinned to the same security release.

### 1. Download and start locally

```sh
git clone https://github.com/larsmorren-sys/palletshipper.git
cd palletshipper
npm ci
cp .env.example .env
npm run dev
```

If you download a ZIP instead, extract it, open a terminal in the extracted project folder, and start from `npm ci`. On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open the Vite address printed in the terminal, normally http://localhost:5173. The backend listens on port 3001. Keep `PORT=3001` in development: the included Vite proxy points to that port. An internet or local network connection is required; offline synchronization is not implemented.

Both `npm run dev` and `npm start` load the optional `.env` file automatically through `server/env.js`. A missing file is silently skipped; Railway uses its Variables without needing a `.env` file. Already-set environment variables take precedence, including Railway Variables. Restart the application after changing `.env`. The example file contains no real credentials; keep your actual `.env` private.

### 2. Create your first administrator

On first backend startup, the application creates an empty SQLite database and a setup code in `data/setup-token.txt` (or the directory set by `DATA_DIR`). Open that file locally and enter its contents in **Create your administrator account**, together with your name, email address and a password of at least 12 characters.

The setup file is deleted after the first administrator is created. Its absence is normal after setup. There are no default credentials and no public sign-up. On an existing installation, log in with an existing account; downloading a new copy of the code does not create another account in the same database.

For Railway setup, use the deployment instructions below: configure `SETUP_TOKEN` in Railway Variables instead of looking for a setup file in GitHub.

### 3. Add users and create a shipment

Log in as the administrator and use **User management** to create accounts. Create a shipment and use **Shipment settings → User access → Manage user access** to assign users who may view and update it. Ordinary users cannot create their own account on the login screen.

The **New shipment** form groups each outbound/return location name with its address, followed by the outbound and return dates. Use **Find address** beside each address and select a match, just as in Shipment settings. The configured warehouse address and its confirmed coordinates are prefilled; you only need to find the outbound address. Confirming both addresses saves the straight-line challenge distance automatically when creating the shipment. Location names remain separate and are the only location text used on labels and reports. You can also create a shipment without confirming its addresses and configure distances later.

Add pallets, import or add equipment, and use **Transport overview** for unit-level transport checks. Item-level tracking is separate and does not earn challenge points.

### 4. Set up addresses and optional automatic distances

1. As an administrator, open **Transport Challenge → Challenge settings** and enter the **Default warehouse address**, use **Find address**, select a match and save the settings. Confirm it once; new shipments inherit its address and coordinates without searching again; existing shipments can be updated individually.
2. In **Shipment settings → Transport addresses and distances**, enter the warehouse address and outbound address. The warehouse is both the departure and return location. No location library is required.
3. For manual distances, enter outbound and return kilometres and select **Save manual route**. This works without an API key.
4. For automatic distances, create your own account at [HeiGIT](https://account.heigit.org/), confirm your email, and copy the **Standard API key** from your dashboard.
5. Locally, paste the key after `ORS_API_KEY=` in your private `.env` and restart `npm run dev`. On Railway, add `ORS_API_KEY` to your service's **Variables** and apply the deployment. Do not add it to `.env.example`, source code, screenshots or GitHub.
6. As an administrator, select **Transport Challenge → Test route connection**. A successful result confirms address-search access. Distance calculations run locally and do not require route-service access. A configured key is not necessarily a valid key; this test verifies it.
7. For each shipment, select **Find address** for both addresses and choose the correct matches. In Shipment settings, confirming the second address automatically calculates and saves the distance. New shipments save it when you select **Create shipment**. The straight-line distance is rounded to whole kilometres and saved for both outbound and return. It works across oceans and does not depend on road routes.

If address search fails, the error includes the HTTP status. Verify the key using **Test route connection**, check the full address and country, or use manual distances. Straight-line calculations make no external API call, so road-network restrictions and route-length quotas do not apply.

If the key is rejected, check that you copied the full active Standard key from the HeiGIT account dashboard. If a quota is reached or the service is unavailable, keep using manual distances. This optional integration is not required for the application to start.

### 5. Start the challenge

The **star icon in the footer** opens Transport Challenge. Participating users also see their current annual Shipment Finisher position beside their account name: round Warehouse League badges with a gold forklift, silver pallet jack and bronze wheelbarrow for ranks 1–3, and a star with the rank number after that. A neutral star means no pallet checks yet. Click the symbol to open the challenge. Positions refresh every five seconds while the page is visible and after local shipment changes. A position change shows a dismissible notification for 15 seconds. The initial position on login/refresh produces no notification; ties share the same rank, matching the leaderboard. Nonparticipants have no ranking symbol or notifications. It is available on computers and tablets and has a tooltip and accessible name.

Open **Transport Challenge** using the star button in the page footer for leaderboards, badges and your progress. Enable **Participate in the Transport Challenge** in your account settings to join. New pallet checks record the user automatically; no transport-responsible person needs to be assigned. Existing checks without a recorded user do not earn points. The scoring rules are explained below.

By default, each user sees scores from shipments they can access. To run a common competition, an administrator can enable **Share user names and total scores across all shipments** in Challenge settings. Shipment details remain restricted by access permissions.

## Configuration and storage

| Variable | Default / purpose |
| --- | --- |
| `PORT` | `3001`. Keep this value for the included development proxy. Railway supplies its own port. |
| `DATA_DIR` | Project `data/` directory when unset. Stores SQLite, photos and the local setup file. Use `/data` with a persistent volume on Railway. |
| `SETUP_TOKEN` | Optional first-administrator setup code. Without it, a fresh local installation generates `setup-token.txt` in its data directory. Remove the variable after setup. |
| `ORS_API_KEY` | Optional server-only HeiGIT Standard key for address search only. Straight-line calculations using confirmed coordinates and manual distances work without it. |
| `APP_URL` | Optional public base URL for printed QR codes. When unset, labels use the domain on which they are opened. Use an HTTPS URL in production. |
| `NODE_ENV` | Set to `production` for HTTPS hosting; the Dockerfile already does this. Production session cookies require HTTPS. Leave unset for local HTTP development. |

Data survives restarts only when the storage directory is retained. Back up the entire data directory, including photos. Stop the application before making a simple filesystem copy of SQLite and its associated files. Archiving a shipment is not a backup. Updating the code applies database migrations automatically and does not erase existing data.

For a local production build:

```sh
npm run build
npm start
```

Open http://localhost:3001. The Node server serves both the interface and API. Use one server instance with the current SQLite storage.

## Accounts and security

Initial setup closes once an administrator exists. Administrators create accounts using **User management** and can change names, email addresses, roles, passwords and active status. Password resets, role changes and deactivation revoke existing sessions. At least one active administrator must remain. Accounts can be deactivated or permanently deleted. In **User management**, administrators can select **Delete** beside a user and confirm by typing that account's email address. Deleting yourself or the last active administrator is blocked. Deletion removes the account, password hash, sessions, access assignments, view preferences and that user's undo history. Their shipments transfer to the administrator performing the deletion; contents, photos and tracking stay intact. Recorded transport arrivals and timestamps remain, with user attribution anonymized, including in other users' undo records. Their leaderboard entry disappears and rewards recalculate among remaining participants. Photo files retained solely by the removed user's undo history are cleaned up. This operation is not undoable.

Click your account name to open **Account settings**. You can set an optional **Nickname**, enable or disable **Participate in the Transport Challenge**, or change your password in separate forms. Profile changes do not require a password change and do not affect your real account name, login or shipment permissions. The nickname is used in challenge rankings and reward winners; an empty nickname uses your account name. Nicknames need not be unique and are limited to 40 characters. Participation is off by default, including for existing accounts after the upgrade. Nonparticipating and inactive accounts are excluded from rankings and winning votes; normal tracking still works. Arrivals still count toward the transport distance pool. Recorded checks remain stored, so rejoining restores eligible scores and may change the current winners.

Changing your password signs out your other sessions. Email invitations, email recovery and two-factor authentication are not implemented.

Passwords are stored as salted scrypt hashes. Session tokens are hashed in the database; cookies use HttpOnly, SameSite=Strict and Secure in production. API changes require CSRF protection, and login attempts are limited. Shipment permissions are checked on the server, including for images and exports. These protections are not a substitute for an independent security audit or secure hosting and backups.

## Shipments and access

Administrators can see all shipments. Other users can see shipments they created or were assigned. Every user with shipment access can change all Shipment settings, including names/dates, addresses/distances, logos, access assignments, archiving/restoring and confirmed shipment deletion. Administrators and the shipment owner retain their existing access. Revoking an assignment removes shipment access and management rights immediately. Account administration and global Challenge settings remain administrator-only. There is no separate read-only role.

Shipment settings also include:

- Shipment name and location details.
- Outbound and warehouse display names, outbound/return dates, physical warehouse/return and outbound addresses, and distances in each direction.
- A custom logo and the logo library.
- Archiving, restoring and permanent deletion.

Existing destination data remains the outbound destination. Route details appear on A6 labels. Displayed and exported dates use **dd/mm/yyyy**, with Brussels time for timestamps.

The browser remembers the last opened shipment per account, including archived shipments. If it is deleted or access is revoked, the application selects an available shipment.

## Transport units and equipment

Use **Add unit** or **Add transport units** to add 1 to 200 units of one type at a time. Choose **Pallet**, **Case**, **Suitcase**, or **Other**; Other requires a description of 1–80 characters, such as `Tool box`. The default name prefix follows the chosen type; custom prefixes/postfixes remain available. Existing pallets migrate to type Pallet without changing their identities, contents, photos, tracking or links. All types have the same item assignment, independent tracking, photos, bulk operations, undo/redo, packing lists and A6 QR labels. Unit types are shown in the sidebar/overview and on exports. Filter the overview by type. Types can be corrected through Edit mode or the unit edit dialog; changes are undoable and recalculate challenge scores from the recorded arrivals.

Customize the **Prefix** and **Postfix** around the automatic number, for example `Stage 1 London`. A preview shows the first and last names. Numbers continue for the same prefix/postfix combination within a shipment. The default prefix is `Pallet`; empty prefix and postfix fields produce numeric names.

When an input row has a quantity above 1, its individual items receive stable numbers, for example `LED screen 1` and `LED screen 2`. Quantity 1 keeps the exact name without adding a suffix. Previously numbered items keep their existing names unless they conflict with another visible name. Numbers remain reserved across deletion, duplication and undo; moving or restoring an item does not renumber it.

You can edit or delete items, assign them to units, search by name, number, code or note, and sort by name or order added. Both inline editing and the Edit dialog show the **full visible item name**, including any generated number. You can remove or replace that number. Visible names must be unique across the entire shipment, including different units, ignoring case, repeated whitespace and Unicode compatibility variants. The UI shows duplicate-name warnings and the server/database enforce uniqueness. Quantity-1 additions and imports reject duplicates atomically; generated quantity names skip occupied names. Edits preserve tracking and identity. Existing duplicate names are migrated to unique suffixes such as `(2)` and `(3)` without removing items or changing their tracking. Restore/undo refuses to introduce a conflicting name. API clients can use `displayName` to edit the full visible name; the legacy base-name field remains supported.

Use **Transport overview** to rename or delete pallets. Deleting a pallet requires confirmation. Its items move to **Unassigned** with their tracking preserved. On active shipments, undo can restore the deleted pallet, its photos and pallet checks. Photo files retained solely for undo are removed when their last history reference expires, the owning user account is deleted, or the shipment is archived/deleted.

Each shipment shares up to 12 extra columns. Adding a column through **Add item → Add column**, the item edit dialog or import makes it available on every item in that shipment, including future items. Values stay individual; missing values appear as —. Existing columns are prefilled in manual forms and imports. Clear an item’s value without removing the column from other items. Existing per-item columns migrate automatically, preserving values. Use **Items → Extra columns → Rename** to rename a shared column while preserving values. Use **Items → Extra columns → Delete** to delete a column and its values across the shipment after confirmation. Active shipments support undo/redo of this deletion; archived shipments delete permanently. Column additions participate in undo/redo; undo is blocked if another action has since filled that column.

## Edit mode, recent items and undo

Use **Edit mode** in either Items or Transport overview. Edit item names, codes, notes and extra field values directly in the existing rows; unit names and types are editable in Transport overview. Changes save automatically when leaving an edited field; typing does not trigger requests. Only failed saves show a status below the row. Invalid or duplicate names are not saved. Failed saves retain the draft and offer **Retry**. Wait for saving to finish before leaving the view or starting another operation. Selection checkboxes and **Select all visible** apply to the current search/filter, not hidden rows.

In **Edit mode**, select items and choose a transport unit in any selected row to move the whole selection, or choose **Unassigned** to unassign them. Changing the unit in an unselected row only moves that item. **Delete selected** removes the selection. Multiselect and **Select all visible** work in both Edit mode and drag-and-drop mode. In drag-and-drop mode, the existing left column supports searching and scrolling, including hundreds of units.

On computers, the compact **hand button** beside Edit mode independently toggles **Drag-and-drop mode**. Editing and dragging are separate modes. Hover the item name to get a grab cursor and drag directly by its name; there is no separate grip. Dragging a selected row moves the visible selection; dragging another row moves only that row. The existing left column stays visible while scrolling in this mode, with a searchable, independently scrolling unit list. Drop onto a unit or Unassigned in that column. Selected items can also be moved through a selected row’s unit dropdown. Turn off the mode with the hand toggle. Escape cancels an in-progress drag.

**Dragging is disabled on phones and tablets, including iPads with desktop user agents.** The hand toggle is disabled on touch-capable/coarse-pointer devices. Use **Edit mode → select items → choose a unit in a selected row** there; multiselect and the row dropdowns remain available. Read-only item names do not intercept touch scrolling.

In Pallet overview, selected pallets can be deleted together or have their contents moved to a destination pallet. **Move contents** preserves the source pallets, their photos and independent tracking. Pallets themselves are not nested. Deleting selected pallets moves their items to Unassigned. Bulk operations validate all row revisions and pallet contents before changing anything.

**Duplicate** copies an item's description, code, note, extra columns and pallet assignment. The copy receives an available name such as `Lamp (copy)` or `Lamp (copy 2)`, a new identity and cleared tracking apart from the automatic Out warehouse check when assigned to a unit; the original remains unchanged.

The sidebar includes:

- **Last added**: the latest 200 currently present items, newest first, including imports, manual additions and duplicates. Existing items are included using their stored creation order. Editing or moving does not change this order; restoring keeps the original creation order. The API exposes `lastAdded`; the import-only `lastImported` field remains for older clients.
- **Last deleted**: up to 200 deleted items per shipment, newest first. Restore one or select multiple to recover their identities, tracking and extra columns. If the original pallet no longer exists, restored items go to Unassigned. This list is shared by users with shipment access.

**Undo** and **Redo** show the next action's name and a confirmation after applying it. Each user has their own persistent history of up to 50 item/pallet actions per shipment, including additions/imports, edits, moves, tracking, duplication, deletion and restoration. A bulk operation is one action. A new action clears that user's redo branch. Undo never reuses reserved item numbers and rejects changes if another action has modified affected records or added dependent content. This prevents overwriting colleagues' work. Photo uploads/deletions, logo/account/access/settings changes and shipment deletion/archiving are not undoable. This limited history is not a complete audit log.

**Successful archiving permanently clears the shipment's recycle bin and every user's undo/redo history.** A failed archive preserves them. Restoring a shipment does not bring the bin or history back. Archived shipments do not retain deleted items or new undo actions; deleting from an archive requires explicit permanent-deletion confirmation. The UI also checks for archive-state changes during editing; restore the shipment before making recoverable edits.

The initial page and shipment switches show a single loading screen until the shipment list and selected shipment contents are ready. Session loading uses the same screen; login forms and partially populated workspace panels do not flash during authenticated startup. Failed detail loads show a retry action.

## Import equipment

Import CSV, Excel (`.xlsx` or `.xls`) or a text-based PDF. The first Excel worksheet is used. PDF import recognizes positioned columns, headers, repeated headings, empty cells and wrapped descriptions where possible. Scanned PDFs are not supported; use CSV or Excel for those documents. Familiar source-language column aliases remain supported for existing material lists.

Review column mapping, headers, descriptions and quantities before importing. Fully empty rows are skipped. Invalid rows are identified with a message. Select **Always 1** when the document has no suitable quantity column. Imports are limited to 2,000 items per request. Use **Add column** to map additional source columns or create a manually entered column. Give each extra column a name and review its values. Up to 12 extra columns per item are stored, shown below the item beside its code, editable in Edit mode, and included in CSV/Excel/packing-list exports.

## Tracking and pallet loading

Item and pallet tracking are independent: checking a pallet never checks its items, and moving or deleting an item does not change pallet tracking.

Newly assigning an item to a pallet, case, suitcase or Other unit automatically checks that **item's Out warehouse** stage. This applies to the ordinary selector, desktop dragging, bulk item moves, moving unit contents, and creating/importing/duplicating an assigned item. Existing Out warehouse timestamps and other item stages are preserved. Assigning to Unassigned does not clear tracking. Re-saving the same unit or changing metadata does not override a deliberate manual uncheck. Restore and undo/redo recover the saved tracking exactly; automatic assignment tracking is part of the move's undo action. Unit-level checkboxes and challenge points remain independent.

In **Transport overview**, check **Out warehouse** when a pallet is loaded onto the truck. Search by pallet name and filter loaded or unloaded pallets. **View contents** opens its equipment and photos.

The progress counter follows the first stage that is incomplete for any pallet. Once all pallets complete Out warehouse, it advances to In location, then Out location, then In warehouse. After all four stages, it shows completion. Removing a check or adding a new pallet moves it back to the first incomplete stage. Search filters and column visibility do not change this calculation.

Use **Tracking columns** to show or hide each stage. Item and pallet column preferences are saved separately per user and shipment. Hiding a column preserves its tracking.

## Photos and logos

Save multiple photos per pallet: up to 10 files per upload and 15 MB per file, using JPG, PNG or WebP. The tablet file picker can offer the camera. Click a thumbnail to open the photo viewer, with previous/next buttons. Arrow keys navigate and Escape closes the viewer on a computer. Deleting a photo removes only that image.

In **Shipment settings → Shipment logo**, upload a PNG, JPG or WebP logo of up to 2 MB. New uploads are saved to the logo library; existing shipment logos are migrated into it. Identical files are deduplicated.

**Choose from logo library** opens a popup with saved logos. Users can only list, open and select logos linked to shipments they created or have access to. Administrators can access all logos. Revoking shipment access also revokes that source of logo access. Selecting a logo saves it for that shipment; changing one shipment’s logo does not change others. Library files remain stored after a shipment is deleted, but ordinary users need another accessible shipment association to view them.

The active shipment logo appears at the top left and on labels and packing lists. Without a custom logo, the Palletshipper fallback is used.

## Export and print

Open **Export** to export the entire shipment at once. Searches and the selected pallet do not limit exports.

- **Excel**: an overview and a worksheet per pallet, including empty pallets.
- **CSV**: the entire shipment.
- **All packing lists / PDF**: an A4 landscape section per pallet.
- **All A6 labels / PDF**: one 105 × 148 mm label per pallet.

Unassigned items are listed separately without a pallet label. Equipment lists use your visible item tracking columns. Print pages can be saved as PDF using the browser print dialog.

A6 labels show the logo, shipment name, pallet name and outbound/return route details. A 20 × 20 mm QR code sits at the bottom right within a 9 mm print margin and retains its white scan border. Print at 100% scale without browser headers and footers.

The QR code opens the corresponding shipment and pallet contents. Login and shipment access are required; it contains no access or session token. The link survives login and refreshing the page. By default, labels use the domain on which they are opened. Set `APP_URL` to a fixed public HTTPS address if needed.

## Archive and delete

Archiving moves a shipment to **Archive**, preserving equipment, pallets, tracking, logo and access permissions. It remains editable and exportable. Adding photos requires restoring it first.

On archiving, pallet photos are resized to a maximum of 1600 × 1600 pixels with preserved proportions and orientation, then compressed to WebP at quality 75. Small images are not enlarged. Originals are replaced only when the result is smaller. Processed images are not compressed repeatedly after restoration and rearchiving. The shipment logo is unchanged. If a photo cannot be processed, archiving fails and originals are preserved.

Restoring returns a shipment to the active list but does not restore original photo quality. Archiving is not a backup.

Permanent shipment deletion requires typing its exact name. It removes pallets, items, tracking, photos, the shipment logo, shipment preferences and access assignments. Reusable library files remain stored.

## Collaboration

The active shipment refreshes every five seconds and when returning to the window. Refresh pauses during forms, local changes, Edit mode and drag-and-drop mode to protect drafts. Leaving Edit mode reloads the current data. Item, pallet and shipment edits and deletions send their read version: stale operations are rejected and the current data is retrieved. Review the latest data and try again after a conflict. API clients must send `revision` to enable this check. Pallet checks record the original user and timestamp for challenge credit. A full change audit log and item-check attribution are not implemented.

## Deploy on Railway

1. Create a Railway service from the GitHub repository. The included Dockerfile builds the application.
2. Attach a persistent volume at `/data`. The Dockerfile sets `DATA_DIR=/data`. Without a volume, data is lost on redeployment.
3. Set a long random `SETUP_TOKEN` in service **Variables** before the first deployment and generate an HTTPS domain. You can generate a value locally with `node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"`.
4. Create the first administrator through that domain using the configured setup code, then remove `SETUP_TOKEN` from Railway Variables.
5. Optionally set `ORS_API_KEY` to your own HeiGIT Standard key and `APP_URL` to the public HTTPS domain. Apply the deployment, then use **Transport Challenge → Test route connection** as an administrator.
6. Set the default warehouse address and, if wanted, enable the shared leaderboard in **Transport Challenge → Challenge settings**. Add users and shipment access in the application.
7. Use one replica and configure volume backups. Multiple instances require shared database and image storage.

The committed `.env.example` is a local template, not the Railway configuration. Enter actual values in Railway Variables. The Dockerfile already sets `NODE_ENV=production` and `DATA_DIR=/data`; do not override the data directory with the local template's `./data`. Keep Railway's supplied `PORT`.

The healthcheck is `/api/health`. Production cookies require HTTPS. Repository contents exclude databases, accounts, uploads, environment files and setup codes. A new checkout creates an empty database on first backend startup; existing local data is not deleted.

## Validation

```sh
npm run build
npm test
```

Tests cover migrations, authentication, permissions, imports and extra columns, independent tracking, photos, exports, atomic bulk edits, persistent recycle bins, undo/redo conflicts, reusable logos, challenge attribution, score corrections, calendar periods, route validation and provider failure handling. Route-provider tests use mock responses and do not require a real API key. Browser checks are used during development for tablet layouts and interactive workflows.

## Transport Challenge and route distances

Open **Transport Challenge** using the star button in the page footer for annual or monthly Shipment Finisher (pallet checks), Pallet Champion (arrival confirmations) and Distance Champion (pallet kilometres) leaderboards, badges and personal progress. Only pallet tracking contributes; item tracking does not. Check attribution starts after this upgrade. Rechecking keeps the original user and original date; corrections remove the current credit. Old checks without attribution do not count.

Each shipment has a warehouse/return address and an outbound address, entered directly in **Shipment settings → Transport addresses and distances**. There is no location library. Administrators can set a default warehouse address in Challenge settings; new shipments inherit it. Existing destination names and dates remain available. Labels and reports always use the manually entered location names, never the challenge addresses. Physical addresses are used only for the game distance calculation.

For address search, set `ORS_API_KEY` on the server (Railway service → Variables). Keys come from https://account.heigit.org/. The key stays on the server and is never returned to the browser. Administrators can use **Test route connection** to test geocoding. Search each address and select the correct matches. Shipment settings automatically calculate and save the distance once both matches are confirmed; new shipments save it on creation. Changing and reconfirming an address updates the distance automatically. Manual overrides are preserved when simply opening the settings. If automatic saving fails, the error remains visible and **Retry automatic save** is available. Address lookup uses the HeiGIT Pelias endpoint with OpenStreetMap data. The server calculates the great-circle (straight-line) distance locally from the selected coordinates, rounds to whole kilometres and saves the same distance for outbound and return. These are game estimates, not actual driving, sea or air routes. No external directions endpoint is used, including for intercontinental destinations. Coordinates and distances are persisted; confirmed coordinates continue working without an API key. Manual distance overrides remain available. Addresses are sent to HeiGIT only on an explicit search. Previously saved automatic road distances with valid coordinates migrate to straight-line distances on startup; manual distances remain unchanged. The unused historical road cache is not used for new calculations.

Distance points are signed: pallets, cases and Other use a factor of **+1**; suitcases use **−0.25**. For example, one suitcase arrival on a 100 km outbound leg contributes −25 points to that leg's reward pool; the return leg is calculated separately. A mixed arrival pool of one pallet and one suitcase over 100 km contributes +75 points. The existing winner/tie-sharing rules apply to the signed pool, not separately to the user checking each suitcase. Check counts and arrival counts remain positive normal counts for all unit types. Rankings show negative and zero-net scores and negative provisional rewards. Legacy API/database names such as `pallets`, `palletId` and `palletKm` are retained for compatibility; `palletKm` now represents signed distance points.

Outbound points use Out warehouse + In location checks; return points use Out location + In warehouse checks. The user with the most active checks on a leg receives its distance rewards; tied users split them equally. Only arrival checks with user attribution earn pallet kilometres. Rewards for partial arrivals are provisional and can change as further checks are recorded. The reward is complete when every pallet has an attributed arrival. Year/month filters use the Belgian calendar and original arrival date. Archiving preserves scores; deleting a pallet or shipment removes its scores. Physical pallets are not tracked across shipments.

By default, leaderboards include only shipments visible to the current user. Administrators can enable a shared leaderboard of user names and totals. Shipment details always require access, including in the shared view. This switch affects all users and can be disabled at any time.
