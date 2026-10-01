# Wallet Counter

A local Scriptable spending countdown for Apple Wallet purchases. Set an editable monthly SEK allowance. The counter resets on the first in Europe/Stockholm time. No money is moved.

Apple Wallet → personal Shortcuts automation → Scriptable → local purchase records and widget.

## Install once

The current release is v0.3.2. The published manifest selects the tested release at an immutable commit.

1. Keep a copy of your existing Wallet Counter script. You can also use Export backup for a readable record of your spending; automatic data import is not implemented.
2. Replace the contents of the existing **Wallet Counter** Scriptable script with `Wallet-Counter-Launcher.js`. Keep the same script name.
3. Open it in Scriptable while online. The launcher downloads the current release and opens the normal menu. Existing allowance and purchase files are reused.
4. Keep your existing Shortcut Dictionary and automation unchanged. Keep Run Immediately on and Run in App off for captures.

This installation needs one last copy-paste. Later program updates use **Check for updates** in the Wallet Counter menu. Install is optional. Updates take effect on the next run. A previous program version is available after the next upgrade; **Restore previous version** switches back without undoing spending. For the first installation, retain the old script as your backup.

## Updates and trust

The launcher reads only `togotago/wallet-counter` on GitHub. A small manifest points to a versioned module at an immutable commit. The launcher checks SHA-256, JavaScript syntax, and the module version and interface before changing the active version. A complete module is saved before the pointer is replaced. Failed downloads or validation leave the active pointer unchanged. There are no automatic update checks during captures or widget rendering.

The checksum detects incomplete or altered files. It is not a publisher signature. Anyone who can change the trusted repository can publish code that runs with Scriptable permissions on the device. Protect the GitHub account and limit repository write access. Public readers cannot push changes merely because the repository is public.

All purchases, merchant names, allowance settings and history stay in local Scriptable storage. Code hosting receives update requests, including normal network metadata such as the device's IP address. The exchange-rate service receives a public SEK rate request, not merchant names or purchase amounts.

A private repository would need separate authenticated downloads and a narrowly scoped read-only token stored in Scriptable Keychain. This launcher deliberately uses public hosting and contains no token.

## SL estimated fares

v0.3.2 treats only the exact merchant name `Sl` (case-insensitive, surrounding spaces ignored) as an SL tap. This name is provisional from Wallet's display and still needs confirmation on the next normal journey. Other merchant names use ordinary capture validation.

The first SL tap deducts an estimated 43 SEK. Further taps inside 75 minutes are saved as zero-cost transfers linked to that first ticket. Transfers never restart the clock. The next tap at or after 75 minutes starts a new ticket; expiry alone never creates a charge. The window is read from existing event history, persists across app restarts, and spans midnight/month boundaries. The fare belongs to the month of the first tap. There is no separate timer file, background process or network request.

This is a single-card, single-iPhone estimate, not bank reconciliation. SL Wallet amount and currency values are ignored, including negative or missing values; recorded amounts are the inferred fare, not the issuer's raw amount. Use **Change SL fare** to edit the fare for future tickets. Corrected tickets retain their start time; undone tickets stop acting as anchors. Transfers remain zero-cost records when a ticket is undone. Recent purchases labels estimates and transfers; ordinary correction/undo and export still work.

Keep the existing Shortcut unchanged. If iOS fails to extract transaction fields before Scriptable runs, a script update cannot fix that earlier failure; a merchant-first Shortcut branch may then be needed. Missed/rejected taps, a different merchant name or switching cards/devices can make estimates wrong. Monarch remains the main financial tracker. A later Wallet display update is not assumed to trigger another automation.

For other merchants, zero Wallet amounts remain pending with no deduction. Negative/missing/malformed amounts still fail validation. Failed earlier taps were not stored; add an actual fare manually if needed. No old SL entries are reclassified automatically.

## Exchange rates

Foreign purchases use free ECB daily estimates from Frankfurter, not card settlement rates. Cache refresh is normally no more than once per 12 hours while foreign purchases occur; retries may happen when a usable rate is missing. Cached rates expire after seven days. The purchase is saved before rates are requested. Without a usable rate, it stays pending for manual SEK correction. SEK capture and widget rendering do not use the network.

## Release a tested update

1. Keep storage schema compatible, or provide an explicit migration and rollback plan.
2. Update the engine version in `WalletCounter.js`.
3. Copy it to `releases/WalletCounter-VERSION.js`. Never change an already published release file.
4. Run `node test-counter.cjs` and `node test-updater.cjs`.
5. Commit the release file. Generate `manifest.json` with `node publish-manifest.cjs VERSION COMMIT_SHA` using that exact commit SHA. Publish the manifest only after the release is readable at that commit.

The launcher stays fixed. A future change to the launcher itself can require another manual installation; routine features are released as engine updates.

## Verification limits

Automated tests use a Scriptable API mock. They cover the real engine's capture and data compatibility, updater failure cases, and rollback. They cannot certify native iOS execution or Wallet delivery. The first launcher installation still needs an on-device smoke check. You can use a test capture without making a purchase.

See START-HERE.md for the original Wallet automation and widget setup.
