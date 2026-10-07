# Palletshipper

A shipment and pallet management application built with React, Vite, Tailwind CSS, Node.js and Express. Each shipment contains pallets and individual equipment items. Items and pallets have independent tracking for **Out warehouse**, **In location**, **Out location** and **In warehouse**.

## Run locally

Use Node.js 24 or later.

```sh
npm ci
npm run dev
```

Open the Vite address, normally http://localhost:5173. The backend listens on port 3001. SQLite, uploaded photos and installation data are stored in `data/` and survive restarts. An internet or local network connection is required; offline synchronization is not implemented.

For the production build:

```sh
npm run build
npm start
```

The Node server serves both the interface and API. `PORT` controls the listening port and `DATA_DIR` controls the storage directory. Use one server instance with the current SQLite storage.

## Initial setup and accounts

On a new installation, open **Create your administrator account** and enter your name, email address and a password of at least 12 characters.

- Locally, the setup code is generated in `data/setup-token.txt`. The file is deleted after the first administrator account is created.
- On Railway, set a long random `SETUP_TOKEN` before the first deployment. Use its value in the setup form, then remove the variable after installation.

There are no default accounts or passwords and no public registration. Initial setup closes once an administrator exists. Administrators create accounts using **User management** and can change names, email addresses, roles, passwords and active status. Password resets, role changes and deactivation revoke existing sessions. At least one active administrator must remain. Accounts are deactivated rather than deleted.

Click your name to change your own password. Other sessions are signed out. Email invitations, email recovery and two-factor authentication are not implemented.

Passwords are stored as salted scrypt hashes. Session tokens are hashed in the database; cookies use HttpOnly, SameSite=Strict and Secure in production. API changes require CSRF protection, and login attempts are limited. Shipment permissions are checked on the server, including for images and exports. These protections are not a substitute for an independent security audit or secure hosting and backups.

## Shipments and access

Administrators can see all shipments. Other users can see shipments they created or were assigned. In **Shipment settings → User access**, the creator or an administrator selects who may view and update a shipment. There is no separate read-only role.

Shipment settings also include:

- Shipment name and location details.
- **Outbound destination**, **Outbound date**, **Return destination** and **Return date**.
- A custom logo and the logo library.
- Archiving, restoring and permanent deletion.

Existing destination data remains the outbound destination. Route details appear on A6 labels. Displayed and exported dates use **dd/mm/yyyy**, with Brussels time for timestamps.

The browser remembers the last opened shipment per account, including archived shipments. If it is deleted or access is revoked, the application selects an available shipment.

## Pallets and equipment

Add 1 to 200 pallets at a time. Customize the **Prefix** and **Postfix** around the automatic number, for example `Stage 1 London`. A preview shows the first and last names. Numbers continue for the same prefix/postfix combination within a shipment. The default prefix is `Pallet`; empty prefix and postfix fields produce numeric names.

Each item gets a stable number after its description, for example `LED screen 1`. Numbering continues per description across manual additions and imports. Moving an item does not change its number; deleting an item does not reuse its number. Existing records are migrated automatically.

You can edit or delete items, assign them to pallets, search by name, number, code or note, and sort by name or order added. Renaming preserves tracking; if a number conflicts under the new description, the next available number is assigned.

Use **Pallet overview** to rename or delete pallets. Deleting a pallet requires confirmation. Its items move to **Unassigned** with their tracking preserved; the pallet’s photos and pallet tracking are permanently deleted.

## Import equipment

Import CSV, Excel (`.xlsx` or `.xls`) or a text-based PDF. The first Excel worksheet is used. PDF import recognizes positioned columns, headers, repeated headings, empty cells and wrapped descriptions where possible. Scanned PDFs are not supported; use CSV or Excel for those documents. Familiar source-language column aliases remain supported for existing material lists.

Review column mapping, headers, descriptions and quantities before importing. Fully empty rows are skipped. Invalid rows are identified with a message. Select **Always 1** when the document has no suitable quantity column. Imports are limited to 2,000 items per request.

## Tracking and pallet loading

Item and pallet tracking are independent: checking a pallet never checks its items, and moving or deleting an item does not change pallet tracking.

In **Pallet overview**, check **Out warehouse** when a pallet is loaded onto the truck. Search by pallet name and filter loaded or unloaded pallets. **View contents** opens its equipment and photos.

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

The active shipment refreshes every five seconds and when returning to the window. Refresh pauses during forms and local changes. Item, pallet and shipment edits and deletions send their read version: stale operations are rejected and the current data is retrieved. Close and reopen the form to continue after a conflict. API clients must send `revision` to enable this check. There is no audit log of who checked each status.

## Deploy on Railway

1. Create a Railway service from the GitHub repository. The included Dockerfile builds the application.
2. Attach a persistent volume at `/data`. The Dockerfile sets `DATA_DIR=/data`. Without a volume, data is lost on redeployment.
3. Set a random `SETUP_TOKEN` before the first deployment and generate an HTTPS domain.
4. Create the first administrator through that domain, then remove `SETUP_TOKEN`.
5. Use one replica and configure volume backups. Multiple instances require shared database and image storage.

The healthcheck is `/api/health`. Production cookies require HTTPS. Repository contents exclude databases, accounts, uploads, environment files and setup codes. A new checkout creates an empty database on first backend startup; existing local data is not deleted.

## Validation

```sh
npm run build
npm test
```

Integration tests cover migrations, authentication, permissions, imports, tracking, photos, exports, conflicts and reusable logos. Browser checks are used during development for tablet layouts and interactive workflows.

## Transport Challenge and route distances

Open **Transport Challenge** for annual or monthly Shipment Finisher (pallet checks), Pallet Champion (arrival confirmations) and Distance Champion (pallet kilometres) leaderboards, badges and personal progress. Only pallet tracking contributes; item tracking does not. Check attribution starts after this upgrade. Rechecking keeps the original user and original date; corrections remove the current credit. Old checks without attribution do not count.

Each shipment has a warehouse/return address and an outbound address, entered directly in **Shipment settings → Transport addresses and distances**. There is no location library. Administrators can set a default warehouse address in Challenge settings; new shipments inherit it. Existing destination names and dates remain available. Labels use the physical addresses when present.

For automatic distances, set `ORS_API_KEY` on the server (Railway service → Variables). Keys come from https://account.heigit.org/. The key stays on the server and is never returned to the browser. Administrators can use **Test route connection** to check both geocoding and directions. Search each full address and select the correct match, then choose **Calculate and save distances**. The server uses the current HeiGIT Pelias and openrouteservice endpoints. Address matching and routes are based on OpenStreetMap data; distances use driving-car routes, not vehicle-specific truck restrictions or GPS measurements. Selected coordinates and distances are persisted; routes are cached for 30 days. Manual distances and corrections are available when routing is unavailable or not configured. Addresses are sent to HeiGIT only on an explicit search or calculation.

Outbound points use Out warehouse + In location checks; return points use Out location + In warehouse checks. The user with the most active checks on a leg receives its distance rewards; tied users split them equally. Only arrival checks with user attribution earn pallet kilometres. Rewards for partial arrivals are provisional and can change as further checks are recorded. The reward is complete when every pallet has an attributed arrival. Year/month filters use the Belgian calendar and original arrival date. Archiving preserves scores; deleting a pallet or shipment removes its scores. Physical pallets are not tracked across shipments.

By default, leaderboards include only shipments visible to the current user. Administrators can enable a shared leaderboard of user names and totals. Shipment details always require access, including in the shared view. This switch affects all users and can be disabled at any time.
